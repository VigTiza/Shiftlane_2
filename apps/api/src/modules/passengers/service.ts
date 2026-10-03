import { randomToken } from '../../lib/crypto.ts';
import type { CredentialSigner } from '../../lib/credential-signer.ts';
import type { DbClient, DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import type { ImportRowError, ParsedRow } from '../../lib/excel.ts';
import { findDuplicates } from '../../lib/excel.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type {
  CredentialKind,
  Passenger,
  PassengerCredential,
  PassengerImport,
  Prisma,
  ProvisionalBadge,
} from '../../generated/prisma/client.ts';
import type { PassengerRow } from './schemas.ts';

type Optional<T> = T | null | undefined;
type BadgeCredentialKind = Exclude<CredentialKind, 'shiftlane_qr'>;

const MAX_PREVIEW_CHANGES = 1000;

function clean<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function mapCredential(credential: PassengerCredential) {
  return {
    id: credential.id,
    kind: credential.kind,
    value: credential.kind === 'shiftlane_qr' ? null : credential.value,
    issuedAt: credential.issuedAt,
    revokedAt: credential.revokedAt,
  };
}

function mapPassenger(passenger: Passenger & { credentials: PassengerCredential[] }) {
  return {
    id: passenger.id,
    clientOrgId: passenger.clientOrgId,
    plantId: passenger.plantId,
    employeeNumber: passenger.employeeNumber,
    fullName: passenger.fullName,
    shiftName: passenger.shiftName,
    phone: passenger.phone,
    status: passenger.status,
    activated: passenger.activatedAt !== null,
    credentials: passenger.credentials.filter((c) => !c.revokedAt).map(mapCredential),
  };
}

function mapProvisional(badge: ProvisionalBadge) {
  return {
    id: badge.id,
    plantId: badge.plantId,
    value: badge.value,
    kind: badge.kind,
    status: badge.status,
    seenCount: badge.seenCount,
    firstSeenAt: badge.firstSeenAt,
    lastSeenAt: badge.lastSeenAt,
    resolvedPassengerId: badge.resolvedPassengerId,
  };
}

interface ImportChange {
  row: number | null;
  employeeNumber: string;
  fullName: string;
  action: 'create' | 'update' | 'deactivate' | 'reactivate';
  changes?: Record<string, { from: string | null; to: string | null }>;
}

interface ImportPlan {
  totalRows: number;
  errors: ImportRowError[];
  changes: ImportChange[];
  unchanged: number;
  operations: {
    create: { row: PassengerRow }[];
    update: { id: string; row: PassengerRow; reactivate: boolean }[];
    deactivate: string[];
  };
}

interface StoredSummary {
  totalRows: number;
  created: number;
  updated: number;
  deactivated: number;
  reactivated: number;
  unchanged: number;
  errors: ImportRowError[];
  changes: ImportChange[];
}

export function createPassengersService(deps: { signer: CredentialSigner }) {
  const { signer } = deps;
  const include = { credentials: { orderBy: { issuedAt: 'desc' } } } as const;

  async function findPassenger(tx: DbTransaction, id: string) {
    const passenger = await tx.passenger.findFirst({ where: { id, deletedAt: null }, include });
    if (!passenger) throw new NotFoundError('No se encontró el pasajero.');
    return passenger;
  }

  async function assertPlant(tx: DbTransaction, clientOrgId: string, plantId: string) {
    const plant = await tx.plant.findFirst({
      where: { id: plantId, clientOrgId, deletedAt: null },
    });
    if (!plant) throw new BadRequestError('La planta no pertenece a tu empresa.');
    return plant;
  }

  /** Asigna un gafete de la planta; si estaba dado de baja se reactiva para este pasajero. */
  async function assignBadge(
    tx: DbTransaction,
    passenger: Pick<Passenger, 'id' | 'clientOrgId'>,
    kind: BadgeCredentialKind,
    value: string,
  ) {
    const existing = await tx.passengerCredential.findUnique({
      where: { clientOrgId_kind_value: { clientOrgId: passenger.clientOrgId, kind, value } },
      include: { passenger: true },
    });
    if (existing && !existing.revokedAt && existing.passengerId !== passenger.id) {
      throw new ConflictError(`Ese gafete ya pertenece a ${existing.passenger.fullName}.`);
    }
    if (existing) {
      return tx.passengerCredential.update({
        where: { id: existing.id },
        data: { passengerId: passenger.id, revokedAt: null, issuedAt: new Date() },
      });
    }
    return tx.passengerCredential.create({
      data: { clientOrgId: passenger.clientOrgId, passengerId: passenger.id, kind, value },
    });
  }

  /** Compara las filas del archivo contra la lista actual y arma el plan de cambios. */
  async function planImport(
    tx: DbTransaction,
    clientOrgId: string,
    plantId: string,
    mode: 'changes' | 'full',
    rows: ParsedRow<PassengerRow>[],
    baseErrors: ImportRowError[],
    totalRows: number,
  ): Promise<ImportPlan> {
    const errors = [
      ...baseErrors,
      ...findDuplicates(rows, (r) => r.employeeNumber, 'Número de empleado'),
      ...findDuplicates(rows, (r) => r.badge, 'Gafete'),
    ];
    const existing = await tx.passenger.findMany({
      where: { clientOrgId, deletedAt: null },
      include: { credentials: { where: { revokedAt: null, kind: { not: 'shiftlane_qr' } } } },
    });
    const byNumber = new Map(existing.map((p) => [p.employeeNumber.toUpperCase(), p]));
    const badgeOwner = new Map<string, (typeof existing)[number]>();
    for (const passenger of existing) {
      for (const credential of passenger.credentials)
        badgeOwner.set(credential.value.toUpperCase(), passenger);
    }

    const plan: ImportPlan = {
      totalRows,
      errors,
      changes: [],
      unchanged: 0,
      operations: { create: [], update: [], deactivate: [] },
    };
    const seen = new Set<string>();

    for (const { row, data } of rows) {
      const key = data.employeeNumber.toUpperCase();
      seen.add(key);
      const current = byNumber.get(key);
      if (data.badge) {
        const owner = badgeOwner.get(data.badge.toUpperCase());
        if (owner && owner.employeeNumber.toUpperCase() !== key) {
          errors.push({
            row,
            column: 'Gafete',
            message: `El gafete ya pertenece a ${owner.employeeNumber} (${owner.fullName}).`,
          });
          continue;
        }
      }
      if (!current) {
        if (data.status === 'inactive') continue; // Baja de alguien que no existe: nada que hacer.
        plan.operations.create.push({ row: data });
        plan.changes.push({
          row,
          employeeNumber: data.employeeNumber,
          fullName: data.fullName,
          action: 'create',
        });
        continue;
      }
      if (data.status === 'inactive') {
        if (current.status === 'active') {
          plan.operations.deactivate.push(current.id);
          plan.changes.push({
            row,
            employeeNumber: current.employeeNumber,
            fullName: current.fullName,
            action: 'deactivate',
          });
        } else {
          plan.unchanged += 1;
        }
        continue;
      }
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      const compare = (field: string, from: string | null, to: string | null | undefined) => {
        const next = to ?? null;
        if ((from ?? null) !== next) changes[field] = { from: from ?? null, to: next };
      };
      compare('Nombre completo', current.fullName, data.fullName);
      compare('Turno', current.shiftName, data.shiftName ?? current.shiftName);
      compare('Teléfono', current.phone, data.phone ?? current.phone);
      if (current.plantId !== plantId) changes['Planta'] = { from: current.plantId, to: plantId };
      if (
        data.badge &&
        !current.credentials.some((c) => c.value.toUpperCase() === data.badge!.toUpperCase())
      ) {
        changes['Gafete'] = { from: current.credentials[0]?.value ?? null, to: data.badge };
      }
      const reactivate = current.status === 'inactive';
      if (Object.keys(changes).length === 0 && !reactivate) {
        plan.unchanged += 1;
        continue;
      }
      plan.operations.update.push({ id: current.id, row: data, reactivate });
      plan.changes.push({
        row,
        employeeNumber: current.employeeNumber,
        fullName: data.fullName,
        action: reactivate ? 'reactivate' : 'update',
        ...(Object.keys(changes).length > 0 ? { changes } : {}),
      });
    }

    if (mode === 'full') {
      for (const passenger of existing) {
        if (
          passenger.plantId === plantId &&
          passenger.status === 'active' &&
          !seen.has(passenger.employeeNumber.toUpperCase())
        ) {
          plan.operations.deactivate.push(passenger.id);
          plan.changes.push({
            row: null,
            employeeNumber: passenger.employeeNumber,
            fullName: passenger.fullName,
            action: 'deactivate',
          });
        }
      }
    }
    return plan;
  }

  /** Emite la credencial QR de Shiftlane; la anterior deja de servir. */
  async function issueCredential(tx: DbTransaction | DbClient, passengerId: string) {
    const passenger = await tx.passenger.findFirst({ where: { id: passengerId, deletedAt: null } });
    if (!passenger) throw new NotFoundError('No se encontró el pasajero.');
    if (passenger.status !== 'active') throw new BadRequestError('El pasajero está dado de baja.');
    await tx.passengerCredential.updateMany({
      where: { passengerId, kind: 'shiftlane_qr', revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const credential = await tx.passengerCredential.create({
      data: {
        clientOrgId: passenger.clientOrgId,
        passengerId,
        kind: 'shiftlane_qr',
        value: randomToken(12),
      },
    });
    return {
      credentialId: credential.id,
      qrPayload: signer.sign({
        c: credential.id,
        p: passengerId,
        o: passenger.clientOrgId,
        v: credential.value,
      }),
      issuedAt: credential.issuedAt,
    };
  }

  function summarize(plan: ImportPlan): StoredSummary {
    const count = (action: ImportChange['action']) =>
      plan.changes.filter((c) => c.action === action).length;
    return {
      totalRows: plan.totalRows,
      created: count('create'),
      updated: count('update'),
      deactivated: count('deactivate'),
      reactivated: count('reactivate'),
      unchanged: plan.unchanged,
      errors: plan.errors.sort((a, b) => a.row - b.row),
      changes: plan.changes.slice(0, MAX_PREVIEW_CHANGES),
    };
  }

  function mapImport(record: PassengerImport) {
    const summary = record.summary as unknown as StoredSummary;
    return {
      id: record.id,
      plantId: record.plantId,
      fileName: record.fileName,
      mode: record.mode,
      status: record.status,
      ...summary,
      createdAt: record.createdAt,
      appliedAt: record.appliedAt,
    };
  }

  return {
    async list(
      tx: DbTransaction,
      query: {
        search?: string | undefined;
        status?: Passenger['status'] | undefined;
        plantId?: string | undefined;
        page: number;
        pageSize: number;
      },
    ) {
      const where: Prisma.PassengerWhereInput = {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.plantId ? { plantId: query.plantId } : {}),
        ...(query.search
          ? {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                { employeeNumber: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [total, passengers] = await Promise.all([
        tx.passenger.count({ where }),
        tx.passenger.findMany({
          where,
          include,
          orderBy: { fullName: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return {
        items: passengers.map(mapPassenger),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async get(tx: DbTransaction, id: string) {
      return mapPassenger(await findPassenger(tx, id));
    },

    async create(
      tx: DbTransaction,
      clientOrgId: string,
      input: {
        plantId: string;
        employeeNumber: string;
        fullName: string;
        shiftName?: Optional<string>;
        phone?: Optional<string>;
        status: Passenger['status'];
      },
    ) {
      await assertPlant(tx, clientOrgId, input.plantId);
      try {
        const passenger = await tx.passenger.create({
          data: {
            ...input,
            shiftName: input.shiftName ?? null,
            phone: input.phone ?? null,
            clientOrgId,
          },
        });
        return mapPassenger(await findPassenger(tx, passenger.id));
      } catch (error) {
        if (isUniqueViolation(error, 'employee_number')) {
          throw new ConflictError('Ya existe un empleado con ese número.');
        }
        throw error;
      }
    },

    async update(
      tx: DbTransaction,
      id: string,
      input: {
        plantId?: string | undefined;
        employeeNumber?: string | undefined;
        fullName?: string | undefined;
        shiftName?: Optional<string>;
        phone?: Optional<string>;
        status?: Passenger['status'] | undefined;
      },
    ) {
      const passenger = await findPassenger(tx, id);
      if (input.plantId) await assertPlant(tx, passenger.clientOrgId, input.plantId);
      try {
        await tx.passenger.update({ where: { id }, data: clean(input) });
      } catch (error) {
        if (isUniqueViolation(error, 'employee_number')) {
          throw new ConflictError('Ya existe un empleado con ese número.');
        }
        throw error;
      }
      return mapPassenger(await findPassenger(tx, id));
    },

    issueCredential,

    /** Credencial vigente del pasajero (la crea si no tiene). Usa db.system con el id del token. */
    async currentCredential(system: DbClient, passengerId: string) {
      const credential = await system.passengerCredential.findFirst({
        where: { passengerId, kind: 'shiftlane_qr', revokedAt: null },
        orderBy: { issuedAt: 'desc' },
        include: { passenger: true },
      });
      if (!credential) return issueCredential(system, passengerId);
      return {
        credentialId: credential.id,
        qrPayload: signer.sign({
          c: credential.id,
          p: passengerId,
          o: credential.passenger.clientOrgId,
          v: credential.value,
        }),
        issuedAt: credential.issuedAt,
      };
    },

    async addBadge(
      tx: DbTransaction,
      passengerId: string,
      input: { kind: BadgeCredentialKind; value: string },
    ) {
      const passenger = await findPassenger(tx, passengerId);
      await assignBadge(tx, passenger, input.kind, input.value);
      return mapPassenger(await findPassenger(tx, passengerId));
    },

    async revokeCredential(tx: DbTransaction, credentialId: string) {
      const credential = await tx.passengerCredential.findFirst({
        where: { id: credentialId, revokedAt: null },
      });
      if (!credential) throw new NotFoundError('No se encontró la credencial.');
      await tx.passengerCredential.update({
        where: { id: credentialId },
        data: { revokedAt: new Date() },
      });
    },

    /**
     * Identifica a un pasajero por su QR de Shiftlane (firma) o por un gafete de la planta.
     * Corre con el contexto del chofer: solo encuentra pasajeros de plantas que atiende.
     */
    async verify(tx: DbTransaction, code: string) {
      const isShiftlane = code.startsWith('SL1.');
      let credential: (PassengerCredential & { passenger: Passenger }) | null;
      if (isShiftlane) {
        const claims = signer.verify(code);
        if (!claims) {
          return {
            valid: false as const,
            reason: 'invalid_signature' as const,
            message: 'El código QR no es una credencial válida de Shiftlane.',
          };
        }
        credential = await tx.passengerCredential.findFirst({
          where: { id: claims.c, value: claims.v },
          include: { passenger: true },
        });
      } else {
        credential = await tx.passengerCredential.findFirst({
          where: { kind: { in: ['badge_barcode', 'badge_qr'] }, value: code },
          include: { passenger: true },
          orderBy: { revokedAt: { sort: 'desc', nulls: 'first' } },
        });
      }
      if (!credential) {
        return {
          valid: false as const,
          reason: 'unknown' as const,
          message: 'Gafete no registrado.',
        };
      }
      if (credential.revokedAt) {
        return {
          valid: false as const,
          reason: 'revoked' as const,
          message: 'La credencial ya no es válida.',
        };
      }
      if (credential.passenger.status !== 'active' || credential.passenger.deletedAt) {
        return {
          valid: false as const,
          reason: 'inactive' as const,
          message: 'El empleado está dado de baja.',
        };
      }
      const { passenger } = credential;
      return {
        valid: true as const,
        source: isShiftlane ? ('shiftlane_qr' as const) : ('badge' as const),
        passenger: {
          id: passenger.id,
          fullName: passenger.fullName,
          employeeNumber: passenger.employeeNumber,
          plantId: passenger.plantId,
        },
      };
    },

    /** El chofer escaneó un gafete desconocido: se registra como provisional (db.system). */
    async registerProvisional(
      system: DbClient,
      tenantId: string,
      input: { plantId: string; value: string; kind: 'barcode' | 'qr' },
    ) {
      const agreement = await system.serviceAgreement.findFirst({
        where: { tenantId, plantId: input.plantId, status: 'active', deletedAt: null },
      });
      if (!agreement) throw new NotFoundError('No se encontró la planta.');
      const badge = await system.provisionalBadge.upsert({
        where: { clientOrgId_value: { clientOrgId: agreement.clientOrgId, value: input.value } },
        update: { seenCount: { increment: 1 }, lastSeenAt: new Date() },
        create: {
          clientOrgId: agreement.clientOrgId,
          plantId: input.plantId,
          tenantId,
          value: input.value,
          kind: input.kind,
        },
      });
      return mapProvisional(badge);
    },

    async listProvisional(
      tx: DbTransaction,
      query: { status: ProvisionalBadge['status']; plantId?: string | undefined },
    ) {
      const badges = await tx.provisionalBadge.findMany({
        where: { status: query.status, ...(query.plantId ? { plantId: query.plantId } : {}) },
        orderBy: { lastSeenAt: 'desc' },
      });
      return badges.map(mapProvisional);
    },

    /** RH asigna el gafete provisional a un empleado: queda como su gafete. */
    async resolveProvisional(
      tx: DbTransaction,
      userId: string,
      badgeId: string,
      passengerId: string,
    ) {
      const badge = await tx.provisionalBadge.findFirst({
        where: { id: badgeId, status: 'pending' },
      });
      if (!badge) throw new NotFoundError('No se encontró el gafete pendiente.');
      const passenger = await findPassenger(tx, passengerId);
      if (passenger.clientOrgId !== badge.clientOrgId)
        throw new BadRequestError('El empleado no es de esta empresa.');
      await assignBadge(
        tx,
        passenger,
        badge.kind === 'qr' ? 'badge_qr' : 'badge_barcode',
        badge.value,
      );
      const updated = await tx.provisionalBadge.update({
        where: { id: badgeId },
        data: {
          status: 'resolved',
          resolvedPassengerId: passengerId,
          resolvedByUserId: userId,
          resolvedAt: new Date(),
        },
      });
      return mapProvisional(updated);
    },

    async dismissProvisional(tx: DbTransaction, userId: string, badgeId: string) {
      const badge = await tx.provisionalBadge.findFirst({
        where: { id: badgeId, status: 'pending' },
      });
      if (!badge) throw new NotFoundError('No se encontró el gafete pendiente.');
      const updated = await tx.provisionalBadge.update({
        where: { id: badgeId },
        data: { status: 'dismissed', resolvedByUserId: userId, resolvedAt: new Date() },
      });
      return mapProvisional(updated);
    },

    /** Paso 1 de la carga: guarda las filas y devuelve la vista previa de diferencias. */
    async previewImport(
      tx: DbTransaction,
      input: {
        clientOrgId: string;
        plantId: string;
        userId: string;
        fileName: string;
        mode: 'changes' | 'full';
        rows: ParsedRow<PassengerRow>[];
        errors: ImportRowError[];
        totalRows: number;
      },
    ) {
      await assertPlant(tx, input.clientOrgId, input.plantId);
      const plan = await planImport(
        tx,
        input.clientOrgId,
        input.plantId,
        input.mode,
        input.rows,
        input.errors,
        input.totalRows,
      );
      const record = await tx.passengerImport.create({
        data: {
          clientOrgId: input.clientOrgId,
          plantId: input.plantId,
          uploadedByUserId: input.userId,
          fileName: input.fileName,
          mode: input.mode,
          rows: input.rows as unknown as Prisma.InputJsonValue,
          summary: summarize(plan) as unknown as Prisma.InputJsonValue,
        },
      });
      return mapImport(record);
    },

    /** Paso 2: vuelve a comparar con la lista actual y aplica todo o nada. */
    async applyImport(tx: DbTransaction, importId: string) {
      const record = await tx.passengerImport.findFirst({ where: { id: importId } });
      if (!record) throw new NotFoundError('No se encontró la carga.');
      if (record.status !== 'previewed' || !record.rows) {
        throw new ConflictError('Esta carga ya se aplicó o se descartó.');
      }
      const stored = record.summary as unknown as StoredSummary;
      if (stored.errors.length > 0) {
        throw new ConflictError('La carga tiene errores; corrige el archivo y súbelo de nuevo.');
      }
      const rows = record.rows as unknown as ParsedRow<PassengerRow>[];
      // La lista pudo cambiar desde la vista previa: se vuelve a comparar antes de aplicar.
      const plan = await planImport(
        tx,
        record.clientOrgId,
        record.plantId,
        record.mode,
        rows,
        [],
        stored.totalRows,
      );
      if (plan.errors.length > 0) {
        throw new ConflictError(
          'La lista cambió desde la vista previa y ahora hay conflictos; sube el archivo de nuevo.',
        );
      }

      for (const { row } of plan.operations.create) {
        const passenger = await tx.passenger.create({
          data: {
            clientOrgId: record.clientOrgId,
            plantId: record.plantId,
            employeeNumber: row.employeeNumber,
            fullName: row.fullName,
            shiftName: row.shiftName ?? null,
            phone: row.phone ?? null,
          },
        });
        if (row.badge && row.badgeKind) await assignBadge(tx, passenger, row.badgeKind, row.badge);
      }
      for (const { id, row } of plan.operations.update) {
        const passenger = await tx.passenger.update({
          where: { id },
          data: {
            fullName: row.fullName,
            plantId: record.plantId,
            status: 'active',
            ...(row.shiftName !== undefined ? { shiftName: row.shiftName } : {}),
            ...(row.phone !== undefined ? { phone: row.phone } : {}),
          },
        });
        if (row.badge && row.badgeKind) await assignBadge(tx, passenger, row.badgeKind, row.badge);
      }
      if (plan.operations.deactivate.length > 0) {
        await tx.passenger.updateMany({
          where: { id: { in: plan.operations.deactivate } },
          data: { status: 'inactive' },
        });
        await tx.passengerCredential.updateMany({
          where: {
            passengerId: { in: plan.operations.deactivate },
            kind: 'shiftlane_qr',
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }

      const updated = await tx.passengerImport.update({
        where: { id: importId },
        data: {
          status: 'applied',
          appliedAt: new Date(),
          rows: undefined,
          summary: summarize(plan) as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.$executeRaw`UPDATE passenger_imports SET rows = NULL WHERE id = ${importId}::uuid`;
      return mapImport({ ...updated, rows: null });
    },

    async discardImport(tx: DbTransaction, importId: string) {
      const record = await tx.passengerImport.findFirst({
        where: { id: importId, status: 'previewed' },
      });
      if (!record) throw new NotFoundError('No se encontró la carga pendiente.');
      await tx.passengerImport.update({ where: { id: importId }, data: { status: 'discarded' } });
      await tx.$executeRaw`UPDATE passenger_imports SET rows = NULL WHERE id = ${importId}::uuid`;
    },

    async listImports(tx: DbTransaction) {
      const records = await tx.passengerImport.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return records.map(mapImport);
    },
  };
}

export type PassengersService = ReturnType<typeof createPassengersService>;
