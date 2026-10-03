import { randomBytes } from 'node:crypto';

import { randomToken } from '../../lib/crypto.ts';
import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import { fromDbDate } from '../../lib/http-schemas.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { ClientContact, ClientOrg, Plant, PlantGate } from '../../generated/prisma/client.ts';

export interface LatLng {
  lat: number;
  lng: number;
}

type Optional<T> = T | null | undefined;

const ACTIVATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código de 8 caracteres sin letras ni números que se confundan (O/0, I/1). */
export function newActivationCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => ACTIVATION_ALPHABET[byte % ACTIVATION_ALPHABET.length]).join(
    '',
  );
}

export function gateQrPayload(qrCode: string): string {
  return `shiftlane-puerta://${qrCode}`;
}

function clean<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** Lee ubicaciones PostGIS (lat/lng) de varias filas a la vez. */
async function locationsOf(tx: DbTransaction, table: 'plants' | 'plant_gates', ids: string[]) {
  if (ids.length === 0) return new Map<string, LatLng>();
  const rows =
    table === 'plants'
      ? await tx.$queryRaw<{ id: string; lat: number; lng: number }[]>`
          SELECT id::text, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
          FROM plants WHERE id = ANY(${ids}::uuid[]) AND location IS NOT NULL`
      : await tx.$queryRaw<{ id: string; lat: number; lng: number }[]>`
          SELECT id::text, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
          FROM plant_gates WHERE id = ANY(${ids}::uuid[]) AND location IS NOT NULL`;
  return new Map(rows.map((row) => [row.id, { lat: row.lat, lng: row.lng }]));
}

async function setLocation(
  tx: DbTransaction,
  table: 'plants' | 'plant_gates',
  id: string,
  location: LatLng | null,
) {
  if (table === 'plants') {
    await (location
      ? tx.$executeRaw`UPDATE plants SET location = ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography WHERE id = ${id}::uuid`
      : tx.$executeRaw`UPDATE plants SET location = NULL WHERE id = ${id}::uuid`);
  } else {
    await (location
      ? tx.$executeRaw`UPDATE plant_gates SET location = ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography WHERE id = ${id}::uuid`
      : tx.$executeRaw`UPDATE plant_gates SET location = NULL WHERE id = ${id}::uuid`);
  }
}

/**
 * Empresas cliente, plantas, puertas y contactos desde el CRM de la transportista. La
 * seguridad por filas decide qué ve; aquí se valida además qué puede editar.
 */
export function createClientsService() {
  function isManaged(org: Pick<ClientOrg, 'createdByTenantId' | 'claimedAt'>, tenantId: string) {
    return org.createdByTenantId === tenantId && org.claimedAt === null;
  }

  async function findOrg(tx: DbTransaction, id: string) {
    const org = await tx.clientOrg.findFirst({ where: { id, deletedAt: null } });
    if (!org) throw new NotFoundError('No se encontró la empresa cliente.');
    return org;
  }

  async function findManagedOrg(tx: DbTransaction, tenantId: string, id: string) {
    const org = await findOrg(tx, id);
    if (!isManaged(org, tenantId)) {
      throw new ConflictError(
        'Esta empresa administra sus propios datos; pídele a la planta que haga el cambio.',
      );
    }
    return org;
  }

  async function findPlant(tx: DbTransaction, id: string) {
    const plant = await tx.plant.findFirst({
      where: { id, deletedAt: null },
      include: { clientOrg: true },
    });
    if (!plant) throw new NotFoundError('No se encontró la planta.');
    return plant;
  }

  async function findManagedPlant(tx: DbTransaction, tenantId: string, id: string) {
    const plant = await findPlant(tx, id);
    if (!isManaged(plant.clientOrg, tenantId)) {
      throw new ConflictError(
        'Esta empresa administra sus propios datos; pídele a la planta que haga el cambio.',
      );
    }
    return plant;
  }

  async function servedPlantIds(tx: DbTransaction, tenantId: string, plantIds: string[]) {
    const agreements = await tx.serviceAgreement.findMany({
      where: {
        tenantId,
        plantId: { in: plantIds },
        deletedAt: null,
        status: { in: ['active', 'pending'] },
      },
      select: { plantId: true },
    });
    return new Set(agreements.map((agreement) => agreement.plantId));
  }

  function mapPlant(
    plant: Plant & { clientOrg: ClientOrg },
    tenantId: string,
    served: Set<string>,
    locations: Map<string, LatLng>,
  ) {
    return {
      id: plant.id,
      clientOrgId: plant.clientOrgId,
      name: plant.name,
      address: plant.address,
      timezone: plant.timezone,
      location: locations.get(plant.id) ?? null,
      served: served.has(plant.id),
      passengerActivationCode: isManaged(plant.clientOrg, tenantId)
        ? plant.passengerActivationCode
        : null,
    };
  }

  function mapGate(gate: PlantGate, locations: Map<string, LatLng>) {
    return {
      id: gate.id,
      name: gate.name,
      active: gate.active,
      qrPayload: gateQrPayload(gate.qrCode),
      location: locations.get(gate.id) ?? null,
    };
  }

  function mapContact(contact: ClientContact) {
    return {
      id: contact.id,
      clientOrgId: contact.clientOrgId,
      plantId: contact.plantId,
      fullName: contact.fullName,
      area: contact.area,
      position: contact.position,
      email: contact.email,
      phone: contact.phone,
      notes: contact.notes,
    };
  }

  async function orgsWithPlants(tx: DbTransaction, tenantId: string, orgs: ClientOrg[]) {
    const plants = await tx.plant.findMany({
      where: { clientOrgId: { in: orgs.map((org) => org.id) }, deletedAt: null },
      include: { clientOrg: true },
      orderBy: { name: 'asc' },
    });
    const ids = plants.map((plant) => plant.id);
    const [served, locations] = await Promise.all([
      servedPlantIds(tx, tenantId, ids),
      locationsOf(tx, 'plants', ids),
    ]);
    return orgs.map((org) => ({
      id: org.id,
      name: org.name,
      legalName: org.legalName,
      rfc: org.rfc,
      managed: isManaged(org, tenantId),
      plants: plants
        .filter((plant) => plant.clientOrgId === org.id)
        .map((plant) => mapPlant(plant, tenantId, served, locations)),
    }));
  }

  async function createPlantRow(
    tx: DbTransaction,
    clientOrgId: string,
    input: { name: string; address?: Optional<string>; timezone?: string | undefined },
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await tx.plant.create({
          data: {
            clientOrgId,
            name: input.name,
            address: input.address ?? null,
            timezone: input.timezone ?? 'America/Ciudad_Juarez',
            passengerActivationCode: newActivationCode(),
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error, 'passenger_activation_code')) throw error;
      }
    }
    throw new Error('No se pudo generar un código de activación único.');
  }

  async function getPlant(tx: DbTransaction, tenantId: string, id: string) {
    const plant = await findPlant(tx, id);
    const gates = await tx.plantGate.findMany({
      where: { plantId: id, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    const [served, plantLocations, gateLocations] = await Promise.all([
      servedPlantIds(tx, tenantId, [id]),
      locationsOf(tx, 'plants', [id]),
      locationsOf(
        tx,
        'plant_gates',
        gates.map((gate) => gate.id),
      ),
    ]);
    return {
      ...mapPlant(plant, tenantId, served, plantLocations),
      gates: gates.map((gate) => mapGate(gate, gateLocations)),
    };
  }

  return {
    isManaged,
    findManagedPlant,

    async listOrgs(tx: DbTransaction, tenantId: string, search?: string) {
      const orgs = await tx.clientOrg.findMany({
        where: {
          deletedAt: null,
          ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        },
        orderBy: { name: 'asc' },
      });
      return orgsWithPlants(tx, tenantId, orgs);
    },

    async getOrg(tx: DbTransaction, tenantId: string, id: string) {
      const org = await findOrg(tx, id);
      const [summary] = await orgsWithPlants(tx, tenantId, [org]);
      const [contacts, contracts] = await Promise.all([
        tx.clientContact.findMany({
          where: { clientOrgId: id, deletedAt: null },
          orderBy: { fullName: 'asc' },
        }),
        tx.contract.findMany({
          where: { clientOrgId: id, deletedAt: null },
          orderBy: { startsOn: 'desc' },
        }),
      ]);
      return {
        ...summary!,
        contacts: contacts.map(mapContact),
        contracts: contracts.map((contract) => ({
          id: contract.id,
          name: contract.name,
          status: contract.status,
          startsOn: fromDbDate(contract.startsOn)!,
          endsOn: fromDbDate(contract.endsOn),
        })),
      };
    },

    async createOrg(
      tx: DbTransaction,
      tenantId: string,
      input: { name: string; legalName?: Optional<string>; rfc?: Optional<string> },
    ) {
      const org = await tx.clientOrg.create({
        data: {
          name: input.name,
          legalName: input.legalName ?? null,
          rfc: input.rfc ?? null,
          createdByTenantId: tenantId,
        },
      });
      const [summary] = await orgsWithPlants(tx, tenantId, [org]);
      return summary!;
    },

    async updateOrg(
      tx: DbTransaction,
      tenantId: string,
      id: string,
      input: { name?: string | undefined; legalName?: Optional<string>; rfc?: Optional<string> },
    ) {
      await findManagedOrg(tx, tenantId, id);
      const org = await tx.clientOrg.update({ where: { id }, data: clean(input) });
      const [summary] = await orgsWithPlants(tx, tenantId, [org]);
      return summary!;
    },

    /** Crea la planta y el acuerdo de servicio de la transportista que la registra. */
    async createPlant(
      tx: DbTransaction,
      tenantId: string,
      clientOrgId: string,
      input: {
        name: string;
        address?: Optional<string>;
        location?: LatLng | null | undefined;
        timezone?: string | undefined;
      },
    ) {
      await findManagedOrg(tx, tenantId, clientOrgId);
      const plant = await createPlantRow(tx, clientOrgId, input);
      if (input.location) await setLocation(tx, 'plants', plant.id, input.location);
      await tx.serviceAgreement.create({
        data: { tenantId, clientOrgId, plantId: plant.id, status: 'active' },
      });
      return getPlant(tx, tenantId, plant.id);
    },

    getPlant,

    async updatePlant(
      tx: DbTransaction,
      tenantId: string,
      id: string,
      input: {
        name?: string | undefined;
        address?: Optional<string>;
        location?: LatLng | null | undefined;
        timezone?: string | undefined;
      },
    ) {
      await findManagedPlant(tx, tenantId, id);
      const { location, ...fields } = input;
      if (Object.keys(clean(fields)).length > 0)
        await tx.plant.update({ where: { id }, data: clean(fields) });
      if (location !== undefined) await setLocation(tx, 'plants', id, location);
      return getPlant(tx, tenantId, id);
    },

    async createGate(
      tx: DbTransaction,
      tenantId: string,
      plantId: string,
      input: { name: string; location?: LatLng | null | undefined },
    ) {
      const plant = await findManagedPlant(tx, tenantId, plantId);
      const gate = await tx.plantGate.create({
        data: {
          clientOrgId: plant.clientOrgId,
          plantId,
          name: input.name,
          qrCode: randomToken(16),
        },
      });
      if (input.location) await setLocation(tx, 'plant_gates', gate.id, input.location);
      return mapGate(gate, await locationsOf(tx, 'plant_gates', [gate.id]));
    },

    async updateGate(
      tx: DbTransaction,
      tenantId: string,
      id: string,
      input: {
        name?: string | undefined;
        active?: boolean | undefined;
        location?: LatLng | null | undefined;
        rotateQr?: boolean;
      },
    ) {
      const gate = await tx.plantGate.findFirst({ where: { id, deletedAt: null } });
      if (!gate) throw new NotFoundError('No se encontró la puerta.');
      await findManagedPlant(tx, tenantId, gate.plantId);
      const data = clean({
        name: input.name,
        active: input.active,
        qrCode: input.rotateQr ? randomToken(16) : undefined,
      });
      const updated =
        Object.keys(data).length > 0 ? await tx.plantGate.update({ where: { id }, data }) : gate;
      if (input.location !== undefined) await setLocation(tx, 'plant_gates', id, input.location);
      return mapGate(updated, await locationsOf(tx, 'plant_gates', [id]));
    },

    async listContacts(tx: DbTransaction, clientOrgId: string) {
      await findOrg(tx, clientOrgId);
      const contacts = await tx.clientContact.findMany({
        where: { clientOrgId, deletedAt: null },
        orderBy: { fullName: 'asc' },
      });
      return contacts.map(mapContact);
    },

    async createContact(
      tx: DbTransaction,
      tenantId: string,
      clientOrgId: string,
      input: {
        fullName: string;
        area: ClientContact['area'];
        position?: Optional<string>;
        email?: Optional<string>;
        phone?: Optional<string>;
        plantId?: Optional<string>;
        notes?: Optional<string>;
      },
    ) {
      await findOrg(tx, clientOrgId);
      if (input.plantId) {
        const plant = await findPlant(tx, input.plantId);
        if (plant.clientOrgId !== clientOrgId)
          throw new BadRequestError('La planta no pertenece a esta empresa.');
      }
      const contact = await tx.clientContact.create({
        data: {
          tenantId,
          clientOrgId,
          plantId: input.plantId ?? null,
          fullName: input.fullName,
          area: input.area,
          position: input.position ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          notes: input.notes ?? null,
        },
      });
      return mapContact(contact);
    },

    async updateContact(
      tx: DbTransaction,
      id: string,
      input: Partial<
        Record<'fullName' | 'position' | 'email' | 'phone' | 'plantId' | 'notes', Optional<string>>
      > & { area?: ClientContact['area'] | undefined },
    ) {
      const contact = await tx.clientContact.findFirst({ where: { id, deletedAt: null } });
      if (!contact) throw new NotFoundError('No se encontró el contacto.');
      if (input.plantId) {
        const plant = await findPlant(tx, input.plantId);
        if (plant.clientOrgId !== contact.clientOrgId)
          throw new BadRequestError('La planta no pertenece a esta empresa.');
      }
      const updated = await tx.clientContact.update({
        where: { id },
        data: clean(input) as Partial<ClientContact>,
      });
      return mapContact(updated);
    },

    async removeContact(tx: DbTransaction, id: string) {
      const contact = await tx.clientContact.findFirst({ where: { id, deletedAt: null } });
      if (!contact) throw new NotFoundError('No se encontró el contacto.');
      await tx.clientContact.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  };
}

export type ClientsService = ReturnType<typeof createClientsService>;
