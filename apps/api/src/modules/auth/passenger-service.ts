import type { DbClient } from '../../lib/db.ts';
import { UnauthorizedError } from '../../lib/errors.ts';
import type { IssuedTokens } from './service.ts';
import type { RequestMeta, SessionService } from './sessions.ts';
import type { TokenService } from './tokens.ts';

const NOT_FOUND =
  'No encontramos tu número de empleado en esta planta. Revisa los datos o acude a Recursos Humanos.';

export function normalizeActivationCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Activación de la app del pasajero con el código de la planta y su número de empleado,
 * validado contra la lista que carga la planta. Solo un celular a la vez: activar en otro
 * cierra la sesión anterior, así el empleado nota si alguien más usó sus datos.
 */
export function createPassengerAuthService(deps: {
  db: DbClient;
  sessions: SessionService;
  tokens: TokenService;
}) {
  const { db, sessions, tokens } = deps;

  return {
    async activate(
      input: { plantCode: string; employeeNumber: string },
      meta: RequestMeta,
    ): Promise<IssuedTokens & { passenger: { id: string; fullName: string } }> {
      const plant = await db.plant.findUnique({
        where: { passengerActivationCode: normalizeActivationCode(input.plantCode) },
      });
      if (!plant || plant.deletedAt) throw new UnauthorizedError(NOT_FOUND);

      const passenger = await db.passenger.findUnique({
        where: {
          clientOrgId_employeeNumber: {
            clientOrgId: plant.clientOrgId,
            employeeNumber: input.employeeNumber.trim(),
          },
        },
      });
      if (
        !passenger ||
        passenger.plantId !== plant.id ||
        passenger.status !== 'active' ||
        passenger.deletedAt
      ) {
        throw new UnauthorizedError(NOT_FOUND);
      }

      await sessions.revokeAll({ passengerId: passenger.id });
      await db.passenger.update({ where: { id: passenger.id }, data: { activatedAt: new Date() } });
      const { session, refreshToken } = await sessions.start(
        { principal: 'passenger', passengerId: passenger.id, clientOrgId: passenger.clientOrgId },
        meta,
      );
      const accessToken = await tokens.signAccess({
        kind: 'passenger',
        sub: passenger.id,
        sid: session.id,
        clientOrgId: passenger.clientOrgId,
        plantId: passenger.plantId,
      });
      return {
        accessToken,
        expiresIn: tokens.accessTtlSeconds,
        refreshToken,
        passenger: { id: passenger.id, fullName: passenger.fullName },
      };
    },
  };
}
