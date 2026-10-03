import { documentStatus, todayIn } from '@shiftlane/shared';

import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import type { ImportReport, ParsedRow } from '../../lib/excel.ts';
import { findDuplicates } from '../../lib/excel.ts';
import { fromDbDate, toDbDateOrNull } from '../../lib/http-schemas.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { ObjectStorage } from '../../lib/storage.ts';
import type { UploadedFile } from '../../lib/uploads.ts';
import { storageKey } from '../../lib/uploads.ts';
import type { Driver, DriverDocument, Prisma } from '../../generated/prisma/client.ts';
import type { DriverRow } from './schemas.ts';

type DriverInput = {
  fullName?: string | undefined;
  employeeNumber?: string | null | undefined;
  phone?: string | null | undefined;
  status?: Driver['status'] | undefined;
  licenseNumber?: string | null | undefined;
  licenseType?: string | null | undefined;
  emergencyContactName?: string | null | undefined;
  emergencyContactPhone?: string | null | undefined;
  habitualVehicleId?: string | null | undefined;
  notes?: string | null | undefined;
};

type DocumentInput = {
  type?: DriverDocument['type'];
  number?: string | null | undefined;
  issuedOn?: string | null | undefined;
  expiresOn?: string | null | undefined;
  notes?: string | null | undefined;
};

function clean<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

const driverInclude = {
  documents: { where: { deletedAt: null }, orderBy: { type: 'asc' } },
  habitualVehicle: { select: { id: true, economicNumber: true, deletedAt: true } },
  pin: { select: { pinHash: true } },
  devices: { where: { revokedAt: null }, select: { deviceId: true } },
} as const;

type DriverWithRelations = Prisma.DriverGetPayload<{ include: typeof driverInclude }>;

export function createDriversService(deps: { storage: ObjectStorage; timeZone: string }) {
  const { storage } = deps;

  function mapDocument(doc: DriverDocument, today: string) {
    const expiresOn = fromDbDate(doc.expiresOn);
    return {
      id: doc.id,
      type: doc.type,
      number: doc.number,
      issuedOn: fromDbDate(doc.issuedOn),
      expiresOn,
      status: documentStatus(expiresOn, today),
      hasFile: doc.fileKey !== null,
      fileName: doc.fileName,
      notes: doc.notes,
    };
  }

  function mapDriver(driver: DriverWithRelations) {
    const today = todayIn(deps.timeZone);
    const documentList = driver.documents.map((doc) => mapDocument(doc, today));
    const vehicle = driver.habitualVehicle;
    return {
      id: driver.id,
      fullName: driver.fullName,
      employeeNumber: driver.employeeNumber,
      phone: driver.phone,
      status: driver.status,
      licenseNumber: driver.licenseNumber,
      licenseType: driver.licenseType,
      emergencyContactName: driver.emergencyContactName,
      emergencyContactPhone: driver.emergencyContactPhone,
      habitualVehicle:
        vehicle && !vehicle.deletedAt
          ? { id: vehicle.id, economicNumber: vehicle.economicNumber }
          : null,
      hasPhoto: driver.photoKey !== null,
      notes: driver.notes,
      access: { pinSet: Boolean(driver.pin?.pinHash), devices: driver.devices.length },
      documents: {
        expired: documentList.filter((doc) => doc.status === 'expired').length,
        expiring: documentList.filter((doc) => doc.status === 'expiring').length,
      },
      documentList,
    };
  }

  async function findDriver(tx: DbTransaction, id: string) {
    const driver = await tx.driver.findFirst({
      where: { id, deletedAt: null },
      include: driverInclude,
    });
    if (!driver) throw new NotFoundError('No se encontró el chofer.');
    return driver;
  }

  async function findDocument(tx: DbTransaction, id: string) {
    const doc = await tx.driverDocument.findFirst({
      where: { id, deletedAt: null, driver: { deletedAt: null } },
    });
    if (!doc) throw new NotFoundError('No se encontró el documento.');
    return doc;
  }

  async function assertVehicle(tx: DbTransaction, vehicleId: string | null | undefined) {
    if (!vehicleId) return;
    const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } });
    if (!vehicle) throw new BadRequestError('La unidad habitual no existe.');
  }

  function translateConflict(error: unknown): never {
    if (isUniqueViolation(error, 'employee_number')) {
      throw new ConflictError('Ya existe un chofer con ese número de empleado.');
    }
    throw error;
  }

  return {
    async list(
      tx: DbTransaction,
      query: {
        search?: string | undefined;
        status?: Driver['status'] | undefined;
        page: number;
        pageSize: number;
      },
    ) {
      const where: Prisma.DriverWhereInput = {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                { employeeNumber: { contains: query.search, mode: 'insensitive' } },
                { licenseNumber: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search } },
              ],
            }
          : {}),
      };
      const [total, drivers] = await Promise.all([
        tx.driver.count({ where }),
        tx.driver.findMany({
          where,
          include: driverInclude,
          orderBy: { fullName: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return {
        items: drivers.map((driver) => {
          const { documentList: _documentList, ...summary } = mapDriver(driver);
          return summary;
        }),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async get(tx: DbTransaction, id: string) {
      return mapDriver(await findDriver(tx, id));
    },

    async create(tx: DbTransaction, tenantId: string, input: DriverInput & { fullName: string }) {
      await assertVehicle(tx, input.habitualVehicleId);
      try {
        const driver = await tx.driver.create({
          data: { ...clean(input), tenantId } as Prisma.DriverUncheckedCreateInput,
        });
        return mapDriver(await findDriver(tx, driver.id));
      } catch (error) {
        translateConflict(error);
      }
    },

    async update(tx: DbTransaction, id: string, input: DriverInput) {
      await findDriver(tx, id);
      await assertVehicle(tx, input.habitualVehicleId);
      try {
        await tx.driver.update({ where: { id }, data: clean(input) });
      } catch (error) {
        translateConflict(error);
      }
      return mapDriver(await findDriver(tx, id));
    },

    async remove(tx: DbTransaction, id: string) {
      await findDriver(tx, id);
      await tx.driver.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'inactive' },
      });
      await tx.route.updateMany({
        where: { habitualDriverId: id },
        data: { habitualDriverId: null },
      });
      await tx.driverDevice.updateMany({
        where: { driverId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    async setPhoto(tx: DbTransaction, id: string, file: UploadedFile) {
      const driver = await findDriver(tx, id);
      const key = storageKey(driver.tenantId, `choferes/${driver.id}`, file.extension);
      await storage.put(key, file.buffer, file.contentType);
      await tx.driver.update({ where: { id }, data: { photoKey: key } });
      if (driver.photoKey) await storage.delete(driver.photoKey);
    },

    async getPhoto(tx: DbTransaction, id: string) {
      const driver = await findDriver(tx, id);
      const body = driver.photoKey ? await storage.get(driver.photoKey) : null;
      if (!driver.photoKey || !body) throw new NotFoundError('El chofer no tiene foto.');
      const contentType = driver.photoKey.endsWith('.png')
        ? 'image/png'
        : driver.photoKey.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
      return { body, contentType };
    },

    async addDocument(
      tx: DbTransaction,
      driverId: string,
      input: DocumentInput & { type: DriverDocument['type'] },
    ) {
      const driver = await findDriver(tx, driverId);
      const doc = await tx.driverDocument.create({
        data: {
          tenantId: driver.tenantId,
          driverId,
          type: input.type,
          number: input.number ?? null,
          issuedOn: toDbDateOrNull(input.issuedOn) ?? null,
          expiresOn: toDbDateOrNull(input.expiresOn) ?? null,
          notes: input.notes ?? null,
        },
      });
      return mapDocument(doc, todayIn(deps.timeZone));
    },

    async updateDocument(tx: DbTransaction, id: string, input: DocumentInput) {
      await findDocument(tx, id);
      const doc = await tx.driverDocument.update({
        where: { id },
        data: clean({
          number: input.number,
          issuedOn: toDbDateOrNull(input.issuedOn),
          expiresOn: toDbDateOrNull(input.expiresOn),
          notes: input.notes,
        }),
      });
      return mapDocument(doc, todayIn(deps.timeZone));
    },

    async removeDocument(tx: DbTransaction, id: string) {
      await findDocument(tx, id);
      await tx.driverDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    async attachFile(tx: DbTransaction, id: string, file: UploadedFile) {
      const doc = await findDocument(tx, id);
      const key = storageKey(doc.tenantId, `choferes/${doc.driverId}/documentos`, file.extension);
      await storage.put(key, file.buffer, file.contentType);
      const updated = await tx.driverDocument.update({
        where: { id },
        data: { fileKey: key, fileName: file.fileName, fileType: file.contentType },
      });
      if (doc.fileKey) await storage.delete(doc.fileKey);
      return mapDocument(updated, todayIn(deps.timeZone));
    },

    async getFile(tx: DbTransaction, id: string) {
      const doc = await findDocument(tx, id);
      const body = doc.fileKey ? await storage.get(doc.fileKey) : null;
      if (!doc.fileKey || !body) throw new NotFoundError('El documento no tiene archivo.');
      return {
        body,
        contentType: doc.fileType ?? 'application/octet-stream',
        fileName: doc.fileName ?? 'documento',
      };
    },

    async history(tx: DbTransaction, id: string) {
      await findDriver(tx, id);
      const rows = await tx.auditLog.findMany({
        where: {
          OR: [
            { entityType: 'drivers', entityId: id },
            { entityType: 'driver_pins', entityId: id },
            { entityType: 'driver_documents', after: { path: ['driver_id'], equals: id } },
            { entityType: 'driver_documents', before: { path: ['driver_id'], equals: id } },
          ],
        },
        orderBy: { id: 'desc' },
        take: 200,
      });
      return rows.map((row) => ({ ...row, id: row.id.toString() }));
    },

    async exportRows(tx: DbTransaction) {
      const drivers = await tx.driver.findMany({
        where: { deletedAt: null },
        include: { habitualVehicle: { select: { economicNumber: true } } },
        orderBy: { fullName: 'asc' },
      });
      return drivers.map((driver) => ({
        employeeNumber: driver.employeeNumber,
        fullName: driver.fullName,
        phone: driver.phone,
        licenseNumber: driver.licenseNumber,
        licenseType: driver.licenseType,
        emergencyContactName: driver.emergencyContactName,
        emergencyContactPhone: driver.emergencyContactPhone,
        habitualVehicle: driver.habitualVehicle?.economicNumber ?? null,
        status: driver.status === 'active' ? 'Activo' : 'Inactivo',
        notes: driver.notes,
      }));
    },

    /** Crea o actualiza choferes por número de empleado. Si hay un error, no guarda nada. */
    async importRows(
      tx: DbTransaction,
      tenantId: string,
      rows: ParsedRow<DriverRow>[],
      baseReport: ImportReport,
      dryRun: boolean,
    ): Promise<ImportReport> {
      const errors = [
        ...baseReport.errors,
        ...findDuplicates(rows, (r) => r.employeeNumber, 'Número de empleado'),
      ];
      const [existing, vehicles] = await Promise.all([
        tx.driver.findMany({ select: { id: true, employeeNumber: true } }),
        tx.vehicle.findMany({
          where: { deletedAt: null },
          select: { id: true, economicNumber: true },
        }),
      ]);
      const byNumber = new Map(
        existing.filter((d) => d.employeeNumber).map((d) => [d.employeeNumber!.toUpperCase(), d]),
      );
      const vehicleByNumber = new Map(vehicles.map((v) => [v.economicNumber.toUpperCase(), v.id]));

      let created = 0;
      let updated = 0;
      const vehicleIds = new Map<number, string | null>();
      for (const { row, data } of rows) {
        if (data.habitualVehicle) {
          const vehicleId = vehicleByNumber.get(data.habitualVehicle.toUpperCase());
          if (!vehicleId) {
            errors.push({
              row,
              column: 'Unidad habitual (número económico)',
              message: `No existe la unidad ${data.habitualVehicle}.`,
            });
            continue;
          }
          vehicleIds.set(row, vehicleId);
        } else {
          vehicleIds.set(row, null);
        }
        if (byNumber.has(data.employeeNumber.toUpperCase())) updated += 1;
        else created += 1;
      }
      const report = { totalRows: baseReport.totalRows, created, updated, errors, applied: false };
      if (dryRun || errors.length > 0) return report;

      for (const { row, data } of rows) {
        const values = {
          fullName: data.fullName,
          phone: data.phone ?? null,
          licenseNumber: data.licenseNumber ?? null,
          licenseType: data.licenseType ?? null,
          emergencyContactName: data.emergencyContactName ?? null,
          emergencyContactPhone: data.emergencyContactPhone ?? null,
          habitualVehicleId: vehicleIds.get(row) ?? null,
          status: data.status,
          notes: data.notes ?? null,
        };
        const match = byNumber.get(data.employeeNumber.toUpperCase());
        if (match) {
          await tx.driver.update({ where: { id: match.id }, data: { ...values, deletedAt: null } });
        } else {
          await tx.driver.create({
            data: { ...values, tenantId, employeeNumber: data.employeeNumber },
          });
        }
      }
      return { ...report, applied: true };
    },
  };
}
