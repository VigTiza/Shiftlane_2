import { documentStatus, todayIn } from '@shiftlane/shared';

import type { DbTransaction } from '../../lib/db.ts';
import { ConflictError, NotFoundError } from '../../lib/errors.ts';
import type { ImportReport, ParsedRow } from '../../lib/excel.ts';
import { findDuplicates } from '../../lib/excel.ts';
import { contentTypeOf } from '../../lib/files.ts';
import { fromDbDate, toDbDateOrNull } from '../../lib/http-schemas.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { ObjectStorage } from '../../lib/storage.ts';
import type { UploadedFile } from '../../lib/uploads.ts';
import { storageKey } from '../../lib/uploads.ts';
import type { Prisma, Vehicle, VehicleDocument } from '../../generated/prisma/client.ts';
import type { VehicleRow } from './schemas.ts';

type VehicleInput = {
  economicNumber?: string | undefined;
  plates?: string | undefined;
  make?: string | null | undefined;
  model?: string | undefined;
  year?: number | undefined;
  capacity?: number | undefined;
  requiredLicenseType?: string | null | undefined;
  status?: Vehicle['status'] | undefined;
  odometerKm?: number | undefined;
  notes?: string | null | undefined;
};

type DocumentInput = {
  type?: VehicleDocument['type'];
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

export function createVehiclesService(deps: { storage: ObjectStorage; timeZone: string }) {
  const { storage } = deps;

  function mapDocument(doc: VehicleDocument, today: string) {
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

  function mapVehicle(vehicle: Vehicle & { documents: VehicleDocument[] }) {
    const today = todayIn(deps.timeZone);
    const documentList = vehicle.documents.map((doc) => mapDocument(doc, today));
    return {
      id: vehicle.id,
      economicNumber: vehicle.economicNumber,
      plates: vehicle.plates,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      capacity: vehicle.capacity,
      requiredLicenseType: vehicle.requiredLicenseType,
      status: vehicle.status,
      odometerKm: vehicle.odometerKm,
      hasPhoto: vehicle.photoKey !== null,
      notes: vehicle.notes,
      documents: {
        expired: documentList.filter((doc) => doc.status === 'expired').length,
        expiring: documentList.filter((doc) => doc.status === 'expiring').length,
      },
      documentList,
    };
  }

  const withDocuments = {
    documents: { where: { deletedAt: null }, orderBy: { type: 'asc' } },
  } as const;

  async function findVehicle(tx: DbTransaction, id: string) {
    const vehicle = await tx.vehicle.findFirst({
      where: { id, deletedAt: null },
      include: withDocuments,
    });
    if (!vehicle) throw new NotFoundError('No se encontró la unidad.');
    return vehicle;
  }

  async function findDocument(tx: DbTransaction, id: string) {
    const doc = await tx.vehicleDocument.findFirst({
      where: { id, deletedAt: null, vehicle: { deletedAt: null } },
    });
    if (!doc) throw new NotFoundError('No se encontró el documento.');
    return doc;
  }

  function translateConflict(error: unknown): never {
    if (isUniqueViolation(error, 'economic_number')) {
      throw new ConflictError('Ya existe una unidad con ese número económico.');
    }
    if (isUniqueViolation(error, 'plates')) {
      throw new ConflictError('Ya existe una unidad con esas placas.');
    }
    throw error;
  }

  return {
    async list(
      tx: DbTransaction,
      query: {
        search?: string | undefined;
        status?: Vehicle['status'] | undefined;
        page: number;
        pageSize: number;
      },
    ) {
      const where: Prisma.VehicleWhereInput = {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { economicNumber: { contains: query.search, mode: 'insensitive' } },
                { plates: { contains: query.search, mode: 'insensitive' } },
                { model: { contains: query.search, mode: 'insensitive' } },
                { make: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [total, vehicles] = await Promise.all([
        tx.vehicle.count({ where }),
        tx.vehicle.findMany({
          where,
          include: withDocuments,
          orderBy: { economicNumber: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return {
        items: vehicles.map((vehicle) => {
          const { documentList: _documentList, ...summary } = mapVehicle(vehicle);
          return summary;
        }),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async get(tx: DbTransaction, id: string) {
      return mapVehicle(await findVehicle(tx, id));
    },

    async create(
      tx: DbTransaction,
      tenantId: string,
      input: VehicleInput & {
        economicNumber: string;
        plates: string;
        model: string;
        year: number;
        capacity: number;
      },
    ) {
      try {
        const vehicle = await tx.vehicle.create({
          data: { ...clean(input), tenantId } as Prisma.VehicleUncheckedCreateInput,
        });
        return mapVehicle({ ...vehicle, documents: [] });
      } catch (error) {
        translateConflict(error);
      }
    },

    async update(tx: DbTransaction, id: string, input: VehicleInput) {
      await findVehicle(tx, id);
      try {
        await tx.vehicle.update({ where: { id }, data: clean(input) });
      } catch (error) {
        translateConflict(error);
      }
      return mapVehicle(await findVehicle(tx, id));
    },

    async remove(tx: DbTransaction, id: string) {
      await findVehicle(tx, id);
      await tx.driver.updateMany({
        where: { habitualVehicleId: id },
        data: { habitualVehicleId: null },
      });
      await tx.route.updateMany({
        where: { habitualVehicleId: id },
        data: { habitualVehicleId: null },
      });
      await tx.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    async setPhoto(tx: DbTransaction, id: string, file: UploadedFile) {
      const vehicle = await findVehicle(tx, id);
      const key = storageKey(vehicle.tenantId, `unidades/${vehicle.id}`, file.extension);
      await storage.put(key, file.buffer, file.contentType);
      await tx.vehicle.update({ where: { id }, data: { photoKey: key } });
      if (vehicle.photoKey) await storage.delete(vehicle.photoKey);
    },

    async getPhoto(tx: DbTransaction, id: string) {
      const vehicle = await findVehicle(tx, id);
      const body = vehicle.photoKey ? await storage.get(vehicle.photoKey) : null;
      if (!vehicle.photoKey || !body) throw new NotFoundError('La unidad no tiene foto.');
      return { body, contentType: contentTypeOf(vehicle.photoKey) };
    },

    async addDocument(
      tx: DbTransaction,
      vehicleId: string,
      input: DocumentInput & { type: VehicleDocument['type'] },
    ) {
      const vehicle = await findVehicle(tx, vehicleId);
      const doc = await tx.vehicleDocument.create({
        data: {
          tenantId: vehicle.tenantId,
          vehicleId,
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
      const doc = await tx.vehicleDocument.update({
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
      await tx.vehicleDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    async attachFile(tx: DbTransaction, id: string, file: UploadedFile) {
      const doc = await findDocument(tx, id);
      const key = storageKey(doc.tenantId, `unidades/${doc.vehicleId}/documentos`, file.extension);
      await storage.put(key, file.buffer, file.contentType);
      const updated = await tx.vehicleDocument.update({
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
      await findVehicle(tx, id);
      const rows = await tx.auditLog.findMany({
        where: {
          OR: [
            { entityType: 'vehicles', entityId: id },
            { entityType: 'vehicle_documents', after: { path: ['vehicle_id'], equals: id } },
            { entityType: 'vehicle_documents', before: { path: ['vehicle_id'], equals: id } },
          ],
        },
        orderBy: { id: 'desc' },
        take: 200,
      });
      return rows.map((row) => ({ ...row, id: row.id.toString() }));
    },

    async exportRows(tx: DbTransaction) {
      const vehicles = await tx.vehicle.findMany({
        where: { deletedAt: null },
        orderBy: { economicNumber: 'asc' },
      });
      return vehicles;
    },

    /** Crea o actualiza unidades por número económico. Si hay un error, no guarda nada. */
    async importRows(
      tx: DbTransaction,
      tenantId: string,
      rows: ParsedRow<VehicleRow>[],
      baseReport: ImportReport,
      dryRun: boolean,
    ): Promise<ImportReport> {
      const errors = [
        ...baseReport.errors,
        ...findDuplicates(rows, (r) => r.economicNumber, 'Número económico'),
        ...findDuplicates(rows, (r) => r.plates, 'Placas'),
      ];
      const existing = await tx.vehicle.findMany({
        select: { id: true, economicNumber: true, plates: true },
      });
      const byNumber = new Map(existing.map((v) => [v.economicNumber.toUpperCase(), v]));
      const byPlates = new Map(existing.map((v) => [v.plates.toUpperCase(), v]));

      let created = 0;
      let updated = 0;
      for (const { row, data } of rows) {
        const match = byNumber.get(data.economicNumber.toUpperCase());
        const platesOwner = byPlates.get(data.plates.toUpperCase());
        if (platesOwner && platesOwner.id !== match?.id) {
          errors.push({
            row,
            column: 'Placas',
            message: `Las placas ya pertenecen a la unidad ${platesOwner.economicNumber}.`,
          });
          continue;
        }
        if (match) updated += 1;
        else created += 1;
      }
      const report = { totalRows: baseReport.totalRows, created, updated, errors, applied: false };
      if (dryRun || errors.length > 0) return report;

      for (const { data } of rows) {
        const match = byNumber.get(data.economicNumber.toUpperCase());
        const values = {
          plates: data.plates,
          make: data.make ?? null,
          model: data.model,
          year: data.year,
          capacity: data.capacity,
          status: data.status,
          ...(data.odometerKm !== undefined ? { odometerKm: data.odometerKm } : {}),
          notes: data.notes ?? null,
        };
        if (match) {
          await tx.vehicle.update({
            where: { id: match.id },
            data: { ...values, deletedAt: null },
          });
        } else {
          await tx.vehicle.create({
            data: { ...values, tenantId, economicNumber: data.economicNumber },
          });
        }
      }
      return { ...report, applied: true };
    },
  };
}

export type VehiclesService = ReturnType<typeof createVehiclesService>;
