import { addDays, todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';
const TZ = 'America/Ciudad_Juarez';
const TODAY = todayIn(TZ);

function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function mondayAfter(date: string) {
  let day = addDays(date, 1);
  while (weekday(day) !== 1) day = addDays(day, 1);
  return day;
}

const MON = mondayAfter(TODAY);
const TUE = addDays(MON, 1);
const NEXT_MON = addDays(MON, 7);

const STOPS = [
  {
    name: 'Plaza de la Mexicanidad',
    location: { lat: 31.7445, lng: -106.4605 },
    times: [{ time: '05:00' }],
  },
  { name: 'Waterfill', location: { lat: 31.7101, lng: -106.4081 }, times: [{ time: '05:30' }] },
];

interface Trip {
  id: string;
  serviceDate: string;
  driverId: string | null;
  vehicleId: string | null;
  driverName: string | null;
  vehicleNumber: string | null;
  assignmentSource: string | null;
}

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let plantId: string;
let clientOrgId: string;
let shiftId: string;
let counter = 0;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

/** Chofer activo con licencia y documentos vigentes. */
async function newDriver(input: { licenseType?: string; habitualVehicleId?: string } = {}) {
  counter += 1;
  return app.db.system.driver.create({
    data: {
      tenantId,
      fullName: `Chofer ${String(counter).padStart(2, '0')}`,
      licenseType: input.licenseType ?? 'Federal B',
      habitualVehicleId: input.habitualVehicleId ?? null,
      documents: {
        create: [
          { type: 'license', expiresOn: new Date('2030-01-01T00:00:00Z') },
          { type: 'medical_exam', expiresOn: new Date('2030-01-01T00:00:00Z') },
        ],
      },
    },
  });
}

async function newVehicle(input: { capacity?: number; requiredLicenseType?: string } = {}) {
  counter += 1;
  return app.db.system.vehicle.create({
    data: {
      tenantId,
      economicNumber: `U-${String(counter).padStart(3, '0')}`,
      plates: `ABC-${String(1000 + counter)}`,
      model: 'Sprinter',
      year: 2023,
      capacity: input.capacity ?? 19,
      requiredLicenseType: input.requiredLicenseType ?? null,
      documents: {
        create: [{ type: 'insurance', expiresOn: new Date('2030-01-01T00:00:00Z') }],
      },
    },
  });
}

async function newRoute(input: { habitualDriverId?: string; habitualVehicleId?: string } = {}) {
  const created = await request(app.server)
    .post('/routes')
    .set('authorization', ownerAuth)
    .send({
      plantId,
      shiftId,
      code: `A-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Ruta con asignación',
      direction: 'inbound',
      version: { validFrom: TODAY, stops: STOPS },
      ...input,
    })
    .expect(201);
  return created.body as { id: string };
}

async function tripsOf(routeId: string, from = MON, to = addDays(MON, 6)) {
  const response = await request(app.server)
    .get('/trips')
    .query({ routeId, from, to, pageSize: 500 })
    .set('authorization', ownerAuth)
    .expect(200);
  return new Map((response.body.items as Trip[]).map((trip) => [trip.serviceDate, trip]));
}

function assign(tripId: string, body: Record<string, unknown>) {
  return request(app.server)
    .put(`/trips/${tripId}/assignment`)
    .set('authorization', ownerAuth)
    .send(body);
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  ownerAuth = await tokenFor(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] })).email,
  );
  const created = await fx.clientOrgWithPlant({ tenantId });
  plantId = created.plant.id;
  clientOrgId = created.org.id;
  const shift = await request(app.server)
    .post('/shifts')
    .set('authorization', ownerAuth)
    .send({ plantId, name: 'Primer turno', startsAt: '06:00', endsAt: '14:00' })
    .expect(201);
  shiftId = shift.body.id as string;
});

afterAll(async () => {
  await app.close();
});

describe('asignación habitual', () => {
  it('los viajes nuevos reciben el chofer y la unidad habituales de la ruta', async () => {
    const driver = await newDriver();
    const vehicle = await newVehicle();
    const route = await newRoute({ habitualDriverId: driver.id, habitualVehicleId: vehicle.id });
    const monday = (await tripsOf(route.id)).get(MON)!;
    expect(monday).toMatchObject({
      driverId: driver.id,
      vehicleId: vehicle.id,
      driverName: driver.fullName,
      vehicleNumber: vehicle.economicNumber,
      assignmentSource: 'habitual',
    });
  });

  it('sin unidad habitual en la ruta usa la unidad habitual del chofer', async () => {
    const vehicle = await newVehicle();
    const driver = await newDriver({ habitualVehicleId: vehicle.id });
    const route = await newRoute({ habitualDriverId: driver.id });
    expect((await tripsOf(route.id)).get(MON)).toMatchObject({
      driverId: driver.id,
      vehicleId: vehicle.id,
    });
  });

  it('al cambiar el chofer habitual se actualizan los viajes habituales, no los manuales', async () => {
    const first = await newDriver();
    const second = await newDriver();
    const vehicle = await newVehicle();
    const route = await newRoute({ habitualDriverId: first.id, habitualVehicleId: vehicle.id });
    const trips = await tripsOf(route.id);
    const manualDriver = await newDriver();
    await assign(trips.get(TUE)!.id, { driverId: manualDriver.id }).expect(200);

    await request(app.server)
      .patch(`/routes/${route.id}`)
      .set('authorization', ownerAuth)
      .send({ habitualDriverId: second.id })
      .expect(200);
    const after = await tripsOf(route.id);
    expect(after.get(MON)).toMatchObject({ driverId: second.id, assignmentSource: 'habitual' });
    expect(after.get(TUE)).toMatchObject({ driverId: manualDriver.id, assignmentSource: 'manual' });
  });

  it('no asigna la habitual si crea un conflicto y lo reporta', async () => {
    const driver = await newDriver();
    const vehicle = await newVehicle();
    // El chofer ya tiene un viaje a la misma hora con otra ruta.
    const busy = await newRoute();
    const busyTrip = (await tripsOf(busy.id)).get(MON)!;
    await assign(busyTrip.id, { driverId: driver.id, vehicleId: (await newVehicle()).id }).expect(
      200,
    );

    const route = await newRoute();
    await request(app.server)
      .patch(`/routes/${route.id}`)
      .set('authorization', ownerAuth)
      .send({ habitualDriverId: driver.id, habitualVehicleId: vehicle.id })
      .expect(200);
    const trips = await tripsOf(route.id);
    expect(trips.get(MON)).toMatchObject({ driverId: null, assignmentSource: null });
    expect(trips.get(TUE)).toMatchObject({ driverId: driver.id, assignmentSource: 'habitual' });

    const report = await request(app.server)
      .post('/schedule/auto-assign')
      .set('authorization', ownerAuth)
      .send({ from: MON, to: addDays(MON, 4), routeId: route.id })
      .expect(200);
    expect(report.body).toMatchObject({ assigned: 0, unchanged: 4 });
    expect(report.body.skipped).toEqual([
      expect.objectContaining({
        serviceDate: MON,
        reasons: [expect.stringMatching(/tiene otro viaje a la misma hora/)],
      }),
    ]);

    // Al liberar al chofer, la asignación automática completa el día.
    await assign(busyTrip.id, { driverId: null }).expect(200);
    const retry = await request(app.server)
      .post('/schedule/auto-assign')
      .set('authorization', ownerAuth)
      .send({ from: MON, to: MON, routeId: route.id })
      .expect(200);
    expect(retry.body).toMatchObject({ assigned: 1, skipped: [] });
  });
});

describe('asignación manual y conflictos', () => {
  it('bloquea un chofer en dos viajes a la vez, salvo que se confirme', async () => {
    const driver = await newDriver();
    const first = (await tripsOf((await newRoute()).id)).get(MON)!;
    const second = (await tripsOf((await newRoute()).id)).get(MON)!;
    await assign(first.id, { driverId: driver.id, vehicleId: (await newVehicle()).id }).expect(200);
    const vehicle = await newVehicle();

    const blocked = await assign(second.id, { driverId: driver.id, vehicleId: vehicle.id }).expect(
      409,
    );
    expect(blocked.body.error.code).toBe('ASSIGNMENT_CONFLICTS');
    expect(blocked.body.error.details).toEqual([
      expect.objectContaining({ path: 'driver_double_booked' }),
    ]);

    const forced = await assign(second.id, {
      driverId: driver.id,
      vehicleId: vehicle.id,
      force: true,
    }).expect(200);
    expect(forced.body.trip).toMatchObject({ driverId: driver.id, assignmentSource: 'manual' });
    expect(forced.body.conflicts[0]).toMatchObject({
      type: 'driver_double_booked',
      otherTripId: first.id,
    });

    const conflicts = await request(app.server)
      .get('/schedule/conflicts')
      .query({ from: MON, to: MON, severity: 'error' })
      .set('authorization', ownerAuth)
      .expect(200);
    const listed = (conflicts.body.items as { tripId: string; type: string }[]).filter(
      (c) => c.tripId === second.id,
    );
    expect(listed).toEqual([
      expect.objectContaining({
        type: 'driver_double_booked',
        suggestion: expect.objectContaining({
          message: expect.stringMatching(/^Asigna otro chofer/),
        }),
      }),
    ]);
  });

  it('bloquea una unidad en dos viajes a la vez', async () => {
    const vehicle = await newVehicle();
    const first = (await tripsOf((await newRoute()).id)).get(MON)!;
    const second = (await tripsOf((await newRoute()).id)).get(MON)!;
    await assign(first.id, { driverId: (await newDriver()).id, vehicleId: vehicle.id }).expect(200);
    const blocked = await assign(second.id, {
      driverId: (await newDriver()).id,
      vehicleId: vehicle.id,
    }).expect(409);
    expect(blocked.body.error.details[0].path).toBe('vehicle_double_booked');
  });

  it('bloquea una unidad en mantenimiento y sugiere otra', async () => {
    const vehicle = await newVehicle();
    await app.db.system.vehicle.update({
      where: { id: vehicle.id },
      data: { status: 'maintenance' },
    });
    const trip = (await tripsOf((await newRoute()).id)).get(MON)!;
    const blocked = await assign(trip.id, { vehicleId: vehicle.id }).expect(409);
    expect(blocked.body.error.details).toEqual([
      {
        path: 'vehicle_unavailable',
        message: `La unidad ${vehicle.economicNumber} está en mantenimiento.`,
      },
    ]);
    const spare = await newVehicle();
    const forced = await assign(trip.id, { vehicleId: vehicle.id, force: true }).expect(200);
    const unavailable = (
      forced.body.conflicts as { type: string; suggestion: { options: { id: string }[] } }[]
    ).find((c) => c.type === 'vehicle_unavailable')!;
    expect(unavailable.suggestion.options.map((o) => o.id)).toContain(spare.id);
  });

  it('bloquea documentos vencidos de la unidad y del chofer', async () => {
    const vehicle = await newVehicle();
    await app.db.system.vehicleDocument.updateMany({
      where: { vehicleId: vehicle.id },
      data: { expiresOn: new Date(`${addDays(MON, -1)}T00:00:00Z`) },
    });
    const driver = await newDriver();
    await app.db.system.driverDocument.updateMany({
      where: { driverId: driver.id, type: 'medical_exam' },
      data: { expiresOn: new Date(`${addDays(MON, -2)}T00:00:00Z`) },
    });
    const trip = (await tripsOf((await newRoute()).id)).get(MON)!;
    const blocked = await assign(trip.id, { driverId: driver.id, vehicleId: vehicle.id }).expect(
      409,
    );
    expect(blocked.body.error.details).toEqual([
      {
        path: 'driver_documents_expired',
        message: `Examen médico de ${driver.fullName}: venció el ${addDays(MON, -2)}.`,
      },
      {
        path: 'vehicle_documents_expired',
        message: `Seguro de la unidad ${vehicle.economicNumber}: venció el ${addDays(MON, -1)}.`,
      },
    ]);
  });

  it('bloquea un chofer sin la licencia que exige la unidad', async () => {
    const vehicle = await newVehicle({ requiredLicenseType: 'Federal B' });
    const driver = await newDriver({ licenseType: 'C' });
    const trip = (await tripsOf((await newRoute()).id)).get(MON)!;
    const blocked = await assign(trip.id, { driverId: driver.id, vehicleId: vehicle.id }).expect(
      409,
    );
    expect(blocked.body.error.details).toEqual([
      {
        path: 'driver_license_invalid',
        message: `La unidad ${vehicle.economicNumber} requiere licencia Federal B y ${driver.fullName} tiene C.`,
      },
    ]);
    const unlicensed = await newDriver();
    await app.db.system.driverDocument.deleteMany({
      where: { driverId: unlicensed.id, type: 'license' },
    });
    const noLicense = await assign(trip.id, { driverId: unlicensed.id }).expect(409);
    expect(noLicense.body.error.details[0].message).toBe(
      `${unlicensed.fullName} no tiene licencia registrada.`,
    );
  });

  it('avisa sin bloquear cuando la unidad tiene menos asientos que pasajeros', async () => {
    const route = await newRoute();
    for (let i = 0; i < 3; i += 1) {
      const passenger = await fx.passenger({ clientOrgId, plantId });
      await app.db.system.routePassenger.create({
        data: {
          tenantId,
          routeId: route.id,
          passengerId: passenger.id,
          stopKey: '00000000-0000-4000-8000-000000000000',
        },
      });
    }
    const vehicle = await newVehicle({ capacity: 2 });
    const trip = (await tripsOf(route.id)).get(MON)!;
    const response = await assign(trip.id, {
      driverId: (await newDriver()).id,
      vehicleId: vehicle.id,
    }).expect(200);
    expect(response.body.conflicts).toEqual([
      expect.objectContaining({
        type: 'capacity_exceeded',
        severity: 'warning',
        message: `La unidad ${vehicle.economicNumber} tiene 2 asientos y la ruta tiene 3 pasajeros asignados.`,
      }),
    ]);
  });

  it('valida el viaje, el chofer y los permisos', async () => {
    const trip = (await tripsOf((await newRoute()).id)).get(MON)!;
    await assign(trip.id, {}).expect(400);
    await assign(trip.id, { driverId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    await app.db.system.trip.update({ where: { id: trip.id }, data: { status: 'in_progress' } });
    await assign(trip.id, { driverId: null }).expect(409);

    const rival = (await fx.tenant()).id;
    const rivalAuth = await tokenFor(
      (await fx.carrierUser({ tenantId: rival, password: PASSWORD, roles: ['owner'] })).email,
    );
    await request(app.server)
      .put(`/trips/${trip.id}/assignment`)
      .set('authorization', rivalAuth)
      .send({ driverId: null })
      .expect(404);
    const plantUser = await fx.plantUser({
      clientOrgId,
      password: PASSWORD,
      roles: ['plant_logistics'],
    });
    const plantAuth = await tokenFor(plantUser.email);
    await request(app.server)
      .put(`/trips/${trip.id}/assignment`)
      .set('authorization', plantAuth)
      .send({ driverId: null })
      .expect(403);
  });
});

describe('copiar la semana anterior', () => {
  it('copia la asignación por ruta y día, respeta las manuales y avisa lo que no copió', async () => {
    const route = await newRoute();
    const week = await tripsOf(route.id);
    const driver = await newDriver();
    const vehicle = await newVehicle();
    for (const date of [MON, TUE]) {
      await assign(week.get(date)!.id, { driverId: driver.id, vehicleId: vehicle.id }).expect(200);
    }
    // La semana siguiente ya tiene un martes asignado a mano.
    await request(app.server)
      .post('/schedule/generate')
      .set('authorization', ownerAuth)
      .send({ from: NEXT_MON, to: addDays(NEXT_MON, 6) })
      .expect(200);
    const nextWeek = await tripsOf(route.id, NEXT_MON, addDays(NEXT_MON, 6));
    const manual = await newDriver();
    await assign(nextWeek.get(addDays(NEXT_MON, 1))!.id, { driverId: manual.id }).expect(200);

    const copied = await request(app.server)
      .post('/schedule/copy-week')
      .set('authorization', ownerAuth)
      .send({ sourceWeekStart: MON, routeId: route.id })
      .expect(200);
    expect(copied.body).toMatchObject({ targetWeekStart: NEXT_MON, copied: 1 });
    expect(copied.body.skipped).toEqual([
      expect.objectContaining({ reasons: ['Ya tiene una asignación manual.'] }),
    ]);
    let after = await tripsOf(route.id, NEXT_MON, addDays(NEXT_MON, 6));
    expect(after.get(NEXT_MON)).toMatchObject({
      driverId: driver.id,
      vehicleId: vehicle.id,
      assignmentSource: 'copied',
    });
    expect(after.get(addDays(NEXT_MON, 1))).toMatchObject({ driverId: manual.id });

    const overwritten = await request(app.server)
      .post('/schedule/copy-week')
      .set('authorization', ownerAuth)
      .send({ sourceWeekStart: MON, routeId: route.id, overwrite: true })
      .expect(200);
    expect(overwritten.body).toMatchObject({ copied: 1, unchanged: 1, skipped: [] });
    after = await tripsOf(route.id, NEXT_MON, addDays(NEXT_MON, 6));
    expect(after.get(addDays(NEXT_MON, 1))).toMatchObject({ driverId: driver.id });

    await request(app.server)
      .post('/schedule/copy-week')
      .set('authorization', ownerAuth)
      .send({ sourceWeekStart: TUE })
      .expect(400);
  });

  it('la simulación de un cambio muestra los choferes afectados', async () => {
    const driver = await newDriver();
    const route = await newRoute({
      habitualDriverId: driver.id,
      habitualVehicleId: (await newVehicle()).id,
    });
    const simulation = await request(app.server)
      .post(`/routes/${route.id}/simulate`)
      .set('authorization', ownerAuth)
      .send({ kind: 'temporary', startsOn: MON, endsOn: TUE, suspendService: true })
      .expect(200);
    expect(simulation.body.trips).toEqual([
      expect.objectContaining({ date: MON, driverName: driver.fullName }),
      expect.objectContaining({ date: TUE, driverName: driver.fullName }),
    ]);
    expect(simulation.body.drivers).toEqual([{ id: driver.id, fullName: driver.fullName }]);
  });
});
