import { fromCents, toCents, tripCharge } from '@shiftlane/shared';
import type { PenaltyRule, RateRule, TripForPricing, TripOutcome } from '@shiftlane/shared';

import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, NotFoundError } from '../../lib/errors.ts';
import { fromDbDate, toDbDate, toDbDateOrNull } from '../../lib/http-schemas.ts';
import type { Contract, ClientOrg, Penalty, Prisma, Rate } from '../../generated/prisma/client.ts';

type Optional<T> = T | null | undefined;

function clean<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function mapRate(rate: Rate) {
  return {
    id: rate.id,
    name: rate.name,
    basis: rate.basis,
    amount: Number(rate.amount),
    routeId: rate.routeId,
    weekdays: rate.weekdays,
    startTime: rate.startTime,
    endTime: rate.endTime,
    holidays: rate.holidays,
    minCapacity: rate.minCapacity,
    maxCapacity: rate.maxCapacity,
    validFrom: fromDbDate(rate.validFrom),
    validTo: fromDbDate(rate.validTo),
    minimumCharge: rate.minimumCharge === null ? null : Number(rate.minimumCharge),
    priority: rate.priority,
  };
}

function mapPenalty(penalty: Penalty) {
  return {
    id: penalty.id,
    type: penalty.type,
    description: penalty.description,
    amountType: penalty.amountType,
    amount: Number(penalty.amount),
    graceMinutes: penalty.graceMinutes,
  };
}

/** Convierte las tarifas guardadas a las reglas del motor de packages/shared. */
export function toRateRule(rate: Rate): RateRule {
  return {
    id: rate.id,
    basis: rate.basis,
    amountCents: toCents(rate.amount.toString()),
    routeId: rate.routeId,
    weekdays: rate.weekdays,
    startTime: rate.startTime,
    endTime: rate.endTime,
    holidays: rate.holidays,
    minCapacity: rate.minCapacity,
    maxCapacity: rate.maxCapacity,
    validFrom: fromDbDate(rate.validFrom),
    validTo: fromDbDate(rate.validTo),
    minimumChargeCents: rate.minimumCharge === null ? null : toCents(rate.minimumCharge.toString()),
    priority: rate.priority,
  };
}

export function toPenaltyRule(penalty: Penalty): PenaltyRule {
  return {
    id: penalty.id,
    type: penalty.type,
    amountType: penalty.amountType,
    amount:
      penalty.amountType === 'fixed' ? toCents(penalty.amount.toString()) : Number(penalty.amount),
    graceMinutes: penalty.graceMinutes,
  };
}

type RateInput = {
  name?: Optional<string>;
  basis?: Rate['basis'] | undefined;
  amount?: number | undefined;
  routeId?: Optional<string>;
  weekdays?: number[] | undefined;
  startTime?: Optional<string>;
  endTime?: Optional<string>;
  holidays?: boolean | null | undefined;
  minCapacity?: number | null | undefined;
  maxCapacity?: number | null | undefined;
  validFrom?: Optional<string>;
  validTo?: Optional<string>;
  minimumCharge?: number | null | undefined;
  priority?: number | undefined;
};

function rateData(input: RateInput) {
  return clean({
    name: input.name,
    basis: input.basis,
    amount: input.amount,
    routeId: input.routeId,
    weekdays: input.weekdays ? [...new Set(input.weekdays)].sort() : undefined,
    startTime: input.startTime,
    endTime: input.endTime,
    holidays: input.holidays,
    minCapacity: input.minCapacity,
    maxCapacity: input.maxCapacity,
    validFrom: toDbDateOrNull(input.validFrom),
    validTo: toDbDateOrNull(input.validTo),
    minimumCharge: input.minimumCharge,
    priority: input.priority,
  });
}

export function createContractsService() {
  function mapContract(contract: Contract & { clientOrg: ClientOrg }) {
    return {
      id: contract.id,
      clientOrgId: contract.clientOrgId,
      clientOrgName: contract.clientOrg.name,
      plantId: contract.plantId,
      name: contract.name,
      number: contract.number,
      status: contract.status,
      startsOn: fromDbDate(contract.startsOn)!,
      endsOn: fromDbDate(contract.endsOn),
      notes: contract.notes,
    };
  }

  async function findContract(tx: DbTransaction, id: string) {
    const contract = await tx.contract.findFirst({
      where: { id, deletedAt: null },
      include: {
        clientOrg: true,
        rates: {
          where: { deletedAt: null },
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        },
        penalties: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!contract) throw new NotFoundError('No se encontró el contrato.');
    return contract;
  }

  async function assertPlant(tx: DbTransaction, clientOrgId: string, plantId: Optional<string>) {
    if (!plantId) return;
    const plant = await tx.plant.findFirst({ where: { id: plantId, deletedAt: null } });
    if (!plant || plant.clientOrgId !== clientOrgId) {
      throw new BadRequestError('La planta no pertenece a la empresa del contrato.');
    }
  }

  function detail(contract: Awaited<ReturnType<typeof findContract>>) {
    return {
      ...mapContract(contract),
      rates: contract.rates.map(mapRate),
      penalties: contract.penalties.map(mapPenalty),
    };
  }

  return {
    async list(
      tx: DbTransaction,
      query: { clientOrgId?: string | undefined; status?: Contract['status'] | undefined },
    ) {
      const contracts = await tx.contract.findMany({
        where: { deletedAt: null, ...clean(query) },
        include: { clientOrg: true },
        orderBy: [{ status: 'asc' }, { startsOn: 'desc' }],
      });
      return contracts.map(mapContract);
    },

    async get(tx: DbTransaction, id: string) {
      return detail(await findContract(tx, id));
    },

    async create(
      tx: DbTransaction,
      tenantId: string,
      input: {
        clientOrgId: string;
        plantId?: Optional<string>;
        name: string;
        number?: Optional<string>;
        status: Contract['status'];
        startsOn: string;
        endsOn?: Optional<string>;
        notes?: Optional<string>;
      },
    ) {
      const org = await tx.clientOrg.findFirst({
        where: { id: input.clientOrgId, deletedAt: null },
      });
      if (!org) throw new BadRequestError('La empresa cliente no existe.');
      await assertPlant(tx, input.clientOrgId, input.plantId);
      const contract = await tx.contract.create({
        data: {
          tenantId,
          clientOrgId: input.clientOrgId,
          plantId: input.plantId ?? null,
          name: input.name,
          number: input.number ?? null,
          status: input.status,
          startsOn: toDbDate(input.startsOn),
          endsOn: toDbDateOrNull(input.endsOn) ?? null,
          notes: input.notes ?? null,
        },
      });
      return detail(await findContract(tx, contract.id));
    },

    async update(
      tx: DbTransaction,
      id: string,
      input: {
        plantId?: Optional<string>;
        name?: string | undefined;
        number?: Optional<string>;
        status?: Contract['status'] | undefined;
        startsOn?: string | undefined;
        endsOn?: Optional<string>;
        notes?: Optional<string>;
      },
    ) {
      const contract = await findContract(tx, id);
      await assertPlant(tx, contract.clientOrgId, input.plantId);
      const startsOn = input.startsOn ?? fromDbDate(contract.startsOn)!;
      const endsOn = input.endsOn === undefined ? fromDbDate(contract.endsOn) : input.endsOn;
      if (endsOn && endsOn < startsOn) {
        throw new BadRequestError('La fecha de fin no puede ser anterior a la de inicio.');
      }
      await tx.contract.update({
        where: { id },
        data: clean({
          plantId: input.plantId,
          name: input.name,
          number: input.number,
          status: input.status,
          startsOn: input.startsOn ? toDbDate(input.startsOn) : undefined,
          endsOn: toDbDateOrNull(input.endsOn),
          notes: input.notes,
        }),
      });
      return detail(await findContract(tx, id));
    },

    async remove(tx: DbTransaction, id: string) {
      await findContract(tx, id);
      await tx.contract.update({ where: { id }, data: { deletedAt: new Date(), status: 'ended' } });
    },

    async addRate(
      tx: DbTransaction,
      contractId: string,
      input: RateInput & { basis: Rate['basis']; amount: number },
    ) {
      const contract = await findContract(tx, contractId);
      const rate = await tx.rate.create({
        data: {
          ...rateData(input),
          tenantId: contract.tenantId,
          contractId,
        } as Prisma.RateUncheckedCreateInput,
      });
      return mapRate(rate);
    },

    async updateRate(tx: DbTransaction, id: string, input: RateInput) {
      const rate = await tx.rate.findFirst({ where: { id, deletedAt: null } });
      if (!rate) throw new NotFoundError('No se encontró la tarifa.');
      const merged = { ...mapRate(rate), ...clean(input) };
      if (Boolean(merged.startTime) !== Boolean(merged.endTime)) {
        throw new BadRequestError('Indica hora de inicio y de fin del horario.');
      }
      if (merged.basis === 'per_route' && !merged.routeId) {
        throw new BadRequestError('Una tarifa por ruta necesita la ruta.');
      }
      return mapRate(await tx.rate.update({ where: { id }, data: rateData(input) }));
    },

    async removeRate(tx: DbTransaction, id: string) {
      const rate = await tx.rate.findFirst({ where: { id, deletedAt: null } });
      if (!rate) throw new NotFoundError('No se encontró la tarifa.');
      await tx.rate.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    async addPenalty(
      tx: DbTransaction,
      contractId: string,
      input: {
        type: Penalty['type'];
        description?: Optional<string>;
        amountType: Penalty['amountType'];
        amount: number;
        graceMinutes?: number | null | undefined;
      },
    ) {
      const contract = await findContract(tx, contractId);
      const penalty = await tx.penalty.create({
        data: {
          tenantId: contract.tenantId,
          contractId,
          type: input.type,
          description: input.description ?? null,
          amountType: input.amountType,
          amount: input.amount,
          graceMinutes: input.graceMinutes ?? null,
        },
      });
      return mapPenalty(penalty);
    },

    async updatePenalty(
      tx: DbTransaction,
      id: string,
      input: {
        description?: Optional<string>;
        amountType?: Penalty['amountType'] | undefined;
        amount?: number | undefined;
        graceMinutes?: number | null | undefined;
      },
    ) {
      const penalty = await tx.penalty.findFirst({ where: { id, deletedAt: null } });
      if (!penalty) throw new NotFoundError('No se encontró la penalización.');
      const amountType = input.amountType ?? penalty.amountType;
      const amount = input.amount ?? Number(penalty.amount);
      if (amountType === 'percent' && amount > 100)
        throw new BadRequestError('El porcentaje no puede ser mayor a 100.');
      return mapPenalty(await tx.penalty.update({ where: { id }, data: clean(input) }));
    },

    async removePenalty(tx: DbTransaction, id: string) {
      const penalty = await tx.penalty.findFirst({ where: { id, deletedAt: null } });
      if (!penalty) throw new NotFoundError('No se encontró la penalización.');
      await tx.penalty.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    /** Cotiza un viaje con las tarifas y penalizaciones del contrato. */
    async quote(
      tx: DbTransaction,
      contractId: string,
      trip: TripForPricing & { outcome: TripOutcome },
    ) {
      const contract = await findContract(tx, contractId);
      const charge = tripCharge(
        contract.rates.map(toRateRule),
        contract.penalties.map(toPenaltyRule),
        trip,
        trip.outcome,
      );
      const rate = charge.price
        ? contract.rates.find((r) => r.id === charge.price!.ruleId)
        : undefined;
      return {
        rate: rate ? mapRate(rate) : null,
        quantity: charge.price?.quantity ?? 0,
        minimumApplied: charge.price?.minimumApplied ?? false,
        price: fromCents(charge.price?.amountCents ?? 0),
        base: fromCents(charge.baseCents),
        penalties: charge.penalties.map((p) => ({
          penaltyId: p.penaltyId,
          type: p.type,
          amount: fromCents(p.amountCents),
        })),
        total: fromCents(charge.totalCents),
      };
    },
  };
}
