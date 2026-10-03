import { randomBytes, randomUUID } from 'node:crypto';

import { todayIn } from '@shiftlane/shared';

import type { DbClient } from '../../src/lib/db.ts';
import { hashSecret } from '../../src/modules/auth/passwords.ts';
import type { TokenService } from '../../src/modules/auth/tokens.ts';
import { LATE_START_MINUTES, PLANT } from './plan.ts';
import type { UnitPlan } from './plan.ts';

export interface SimUnit {
  plan: UnitPlan;
  tripId: string;
  driverAuth: string;
  driverName: string;
  vehicleNumber: string;
  /** Números de empleado por parada (para escanear al llegar). */
  employeesByStop: string[][];
}

export interface SimFleet {
  tenantId: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerAuth: string;
  gateCode: string;
  units: SimUnit[];
  startsAt: Date;
  endsAt: Date;
}

export async function api<T = unknown>(
  baseUrl: string,
  method: string,
  path: string,
  options: { auth?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.auth ? { authorization: options.auth } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : null,
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ?? response.statusText;
    throw new Error(`${method} ${path} → ${response.status}: ${message}`);
  }
  return data as T;
}

/**
 * Crea una empresa de simulación nueva (para no mezclarse con datos reales): planta con su
 * puerta, rutas, unidades, choferes con celular, pasajeros por parada y un viaje por unidad.
 */
export async function setupFleet(options: {
  db: DbClient;
  tokens: TokenService;
  baseUrl: string;
  plans: UnitPlan[];
  durationMs: number;
  log?: (message: string) => void;
}): Promise<SimFleet> {
  const { db, plans } = options;
  const log = options.log ?? (() => undefined);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  const timeZone = 'America/Ciudad_Juarez';
  const today = todayIn(timeZone);

  const tenant = await db.tenant.create({ data: { name: `Simulación ${stamp}` } });
  const org = await db.clientOrg.create({
    data: { name: `Planta simulada ${stamp}`, createdByTenantId: tenant.id, claimedAt: new Date() },
  });
  const plant = await db.plant.create({
    data: {
      name: 'Parque Industrial (simulación)',
      clientOrgId: org.id,
      passengerActivationCode: `SIM${stamp.slice(-8)}`,
      timezone: timeZone,
    },
  });
  await db.$executeRaw`
    UPDATE plants SET location = ST_SetSRID(ST_MakePoint(${PLANT.lng}, ${PLANT.lat}), 4326)::geography
    WHERE id = ${plant.id}::uuid`;
  await db.serviceAgreement.create({
    data: { tenantId: tenant.id, plantId: plant.id, clientOrgId: org.id },
  });
  const gateCode = `SIMGATE${stamp}`;
  await db.plantGate.create({
    data: { clientOrgId: org.id, plantId: plant.id, name: 'Puerta principal', qrCode: gateCode },
  });

  // Dueño para ver el turno en el panel (contraseña aleatoria, se muestra al terminar).
  const ownerEmail = `simulacion+${stamp}@shiftlane.example`;
  const ownerPassword = randomBytes(9).toString('base64url');
  const owner = await db.user.create({
    data: {
      kind: 'carrier',
      tenantId: tenant.id,
      email: ownerEmail,
      fullName: 'Despacho de simulación',
      passwordHash: await hashSecret(ownerPassword),
    },
  });
  const ownerRole = await db.role.findUniqueOrThrow({ where: { key: 'owner' } });
  await db.userRole.create({ data: { userId: owner.id, roleId: ownerRole.id } });
  const login = await api<{ accessToken: string }>(options.baseUrl, 'POST', '/auth/login', {
    body: { email: ownerEmail, password: ownerPassword },
  });
  const ownerAuth = `Bearer ${login.accessToken}`;
  log(`Empresa «${tenant.name}» creada; panel: ${ownerEmail}`);

  const startsAt = new Date(Date.now() + 60_000);
  const endsAt = new Date(startsAt.getTime() + options.durationMs);
  const units: SimUnit[] = [];
  for (const plan of plans) {
    const route = await api<{ id: string; current: { id: string } }>(
      options.baseUrl,
      'POST',
      '/routes',
      {
        auth: ownerAuth,
        body: {
          plantId: plant.id,
          code: plan.code,
          name: `Ruta simulada ${plan.code}`,
          direction: 'inbound',
          version: {
            validFrom: today,
            stops: plan.stops.map((stop, i) => ({
              name: `${plan.code} parada ${i + 1}`,
              location: stop,
              times: [{ time: `0${5 + Math.floor(i / 2)}:${i % 2 === 0 ? '00' : '30'}` }],
            })),
          },
        },
      },
    );
    const version = await api<{ stops: { stopKey: string }[] }>(
      options.baseUrl,
      'GET',
      `/routes/${route.id}/versions/${route.current.id}`,
      { auth: ownerAuth },
    );

    const employeesByStop: string[][] = [];
    for (const [stopIndex, count] of plan.passengersPerStop.entries()) {
      const employees: string[] = [];
      for (let p = 0; p < count; p += 1) {
        const employeeNumber = `${plan.code}-${stopIndex + 1}${p + 1}-${stamp.slice(-4)}`;
        const passenger = await db.passenger.create({
          data: {
            clientOrgId: org.id,
            plantId: plant.id,
            employeeNumber,
            fullName: `Empleado ${plan.code} ${stopIndex + 1}.${p + 1}`,
          },
        });
        await db.routePassenger.create({
          data: {
            tenantId: tenant.id,
            routeId: route.id,
            passengerId: passenger.id,
            stopKey: version.stops[stopIndex]!.stopKey,
          },
        });
        employees.push(employeeNumber);
      }
      employeesByStop.push(employees);
    }

    const vehicleNumber = `U-${plan.code.slice(4)}`;
    const vehicle = await db.vehicle.create({
      data: {
        tenantId: tenant.id,
        economicNumber: vehicleNumber,
        plates: `SIM-${stamp.slice(-4)}${plan.code.slice(4)}`,
        model: 'Sprinter 516',
        year: 2024,
        capacity: 24,
      },
    });
    const driverName = `Chofer ${plan.code}`;
    const driver = await db.driver.create({
      data: { tenantId: tenant.id, fullName: driverName, habitualVehicleId: vehicle.id },
    });
    const device = await db.device.create({
      data: {
        tenantId: tenant.id,
        secretHash: 'simulador',
        platform: 'android',
        model: 'Simulador',
      },
    });
    const driverToken = await options.tokens.signAccess({
      kind: 'driver',
      sub: driver.id,
      sid: randomUUID(),
      tenantId: tenant.id,
      deviceId: device.id,
    });
    // La unidad que salió tarde tenía que haber salido hace 25 minutos.
    const late = plan.behavior === 'delayed' ? LATE_START_MINUTES * 60_000 : 0;
    const trip = await db.trip.create({
      data: {
        tenantId: tenant.id,
        plantId: plant.id,
        routeId: route.id,
        routeVersionId: route.current.id,
        kind: 'extra',
        extraReason: 'shift_change',
        notes: 'Simulación de flota',
        direction: 'inbound',
        serviceDate: new Date(`${today}T00:00:00Z`),
        scheduledStartAt: new Date(startsAt.getTime() - late),
        scheduledEndAt: new Date(endsAt.getTime() - late),
        driverId: driver.id,
        vehicleId: vehicle.id,
        assignmentSource: 'manual',
      },
    });
    units.push({
      plan,
      tripId: trip.id,
      driverAuth: `Bearer ${driverToken}`,
      driverName,
      vehicleNumber,
      employeesByStop,
    });
  }
  log(`${units.length} unidades listas (rutas, choferes, pasajeros y viajes).`);
  return {
    tenantId: tenant.id,
    ownerEmail,
    ownerPassword,
    ownerAuth,
    gateCode,
    units,
    startsAt,
    endsAt,
  };
}
