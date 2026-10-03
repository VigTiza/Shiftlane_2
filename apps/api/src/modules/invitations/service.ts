import { randomToken, sha256 } from '../../lib/crypto.ts';
import type { DbClient, DbTransaction } from '../../lib/db.ts';
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.ts';
import type { Mailer } from '../../lib/mailer.ts';
import type { PlantInvitation } from '../../generated/prisma/client.ts';
import { hashSecret } from '../auth/passwords.ts';
import type { AuthService } from '../auth/service.ts';
import type { RequestMeta } from '../auth/sessions.ts';
import type { ClientsService } from '../clients/service.ts';

const INVITATION_DAYS = 7;
export const PLANT_INVITATION_ROLES = ['plant_logistics', 'plant_hr'] as const;
type PlantRole = (typeof PLANT_INVITATION_ROLES)[number];

const INVALID = 'La invitación no es válida o ya venció. Pide una nueva a tu transportista.';

function invitationStatus(
  invitation: PlantInvitation,
): 'pending' | 'accepted' | 'revoked' | 'expired' {
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.revokedAt) return 'revoked';
  if (invitation.expiresAt <= new Date()) return 'expired';
  return 'pending';
}

export function mapInvitation(invitation: PlantInvitation) {
  return {
    id: invitation.id,
    plantId: invitation.plantId,
    email: invitation.email,
    fullName: invitation.fullName,
    role: invitation.roleKey,
    status: invitationStatus(invitation),
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
  };
}

/**
 * Invitaciones a usuarios de planta. La transportista invita a la planta que registró; al
 * aceptar, la empresa cliente pasa a administrar sus propios datos. Si la planta ya usa
 * Shiftlane con otra transportista, su administrador acepta desde su cuenta y los datos que
 * capturó la transportista se mueven a la empresa real (sin duplicar empresas).
 */
export function createInvitationsService(deps: {
  system: DbClient;
  clients: ClientsService;
  auth: AuthService;
  mailer: Mailer;
  appUrl: string;
}) {
  const { system, clients, mailer } = deps;

  async function findValid(token: string) {
    const invitation = await system.plantInvitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { plant: true, tenant: true },
    });
    if (!invitation || invitationStatus(invitation) !== 'pending')
      throw new BadRequestError(INVALID);
    return invitation;
  }

  return {
    async create(
      tx: DbTransaction,
      tenantId: string,
      plantId: string,
      input: { email: string; fullName: string; role: PlantRole },
      createdByUserId: string,
    ) {
      const plant = await clients.findManagedPlant(tx, tenantId, plantId);
      const token = randomToken();
      const invitation = await tx.plantInvitation.create({
        data: {
          tenantId,
          clientOrgId: plant.clientOrgId,
          plantId,
          email: input.email.trim().toLowerCase(),
          fullName: input.fullName,
          roleKey: input.role,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60_000),
          createdByUserId,
        },
      });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const link = `${deps.appUrl}/invitacion?token=${encodeURIComponent(token)}`;
      await mailer.send({
        to: invitation.email,
        subject: `${tenant.name} te invita a Shiftlane`,
        text:
          `Hola, ${input.fullName}.\n\n` +
          `${tenant.name} te invitó a ver el transporte de ${plant.name} en Shiftlane: viajes en vivo, ` +
          `evidencia, solicitudes y prefacturas.\n\n` +
          `Acepta la invitación aquí (vence en ${INVITATION_DAYS} días):\n${link}\n\n` +
          'Si tu planta ya usa Shiftlane, entra con tu cuenta y acepta la invitación desde ahí.',
      });
      return { ...mapInvitation(invitation), token };
    },

    async list(tx: DbTransaction, plantId: string) {
      const invitations = await tx.plantInvitation.findMany({
        where: { plantId },
        orderBy: { createdAt: 'desc' },
      });
      return invitations.map(mapInvitation);
    },

    async revoke(tx: DbTransaction, id: string) {
      const invitation = await tx.plantInvitation.findFirst({ where: { id } });
      if (!invitation) throw new NotFoundError('No se encontró la invitación.');
      if (invitation.acceptedAt) throw new BadRequestError('La invitación ya fue aceptada.');
      await tx.plantInvitation.update({ where: { id }, data: { revokedAt: new Date() } });
    },

    /** Alguien sin cuenta acepta: se crea su usuario y la empresa queda con usuarios propios. */
    async accept(input: { token: string; password: string }, meta: RequestMeta) {
      const invitation = await findValid(input.token);
      const existing = await system.user.findUnique({ where: { email: invitation.email } });
      if (existing) {
        throw new AppError(
          409,
          'ACCOUNT_EXISTS',
          'Ya tienes una cuenta en Shiftlane. Inicia sesión y acepta la invitación desde tu cuenta.',
        );
      }
      const passwordHash = await hashSecret(input.password);
      await system.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            kind: 'plant',
            clientOrgId: invitation.clientOrgId,
            email: invitation.email,
            fullName: invitation.fullName,
            passwordHash,
            passwordChangedAt: new Date(),
          },
        });
        const role = await tx.role.findUniqueOrThrow({ where: { key: invitation.roleKey } });
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
        await tx.clientOrg.updateMany({
          where: { id: invitation.clientOrgId, claimedAt: null },
          data: { claimedAt: new Date() },
        });
        await tx.serviceAgreement.upsert({
          where: {
            tenantId_plantId: { tenantId: invitation.tenantId, plantId: invitation.plantId },
          },
          update: { status: 'active', deletedAt: null },
          create: {
            tenantId: invitation.tenantId,
            plantId: invitation.plantId,
            clientOrgId: invitation.clientOrgId,
            status: 'active',
          },
        });
        await tx.plantInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date(), acceptedUserId: user.id },
        });
      });
      return deps.auth.login({ email: invitation.email, password: input.password }, meta);
    },

    /**
     * Un usuario de una planta que ya usa Shiftlane acepta: se crea el acuerdo con su planta y
     * lo que la transportista había capturado (contratos, contactos) se mueve a su empresa.
     */
    async acceptExisting(
      user: { id: string; clientOrgId: string | null },
      input: { token: string; plantId?: string | undefined },
    ) {
      const invitation = await findValid(input.token);
      const account = await system.user.findUniqueOrThrow({ where: { id: user.id } });
      if (account.email !== invitation.email)
        throw new ForbiddenError('Esta invitación es para otro correo.');
      if (account.kind !== 'plant' || !user.clientOrgId) throw new ForbiddenError();

      const sameOrg = user.clientOrgId === invitation.clientOrgId;
      const targetPlantId = sameOrg ? invitation.plantId : input.plantId;
      if (!targetPlantId)
        throw new BadRequestError('Elige la planta de tu empresa que recibirá el servicio.');
      const target = await system.plant.findFirst({
        where: { id: targetPlantId, deletedAt: null },
      });
      if (!target || target.clientOrgId !== user.clientOrgId) {
        throw new BadRequestError('La planta elegida no pertenece a tu empresa.');
      }

      await system.$transaction(async (tx) => {
        await tx.serviceAgreement.upsert({
          where: { tenantId_plantId: { tenantId: invitation.tenantId, plantId: target.id } },
          update: { status: 'active', deletedAt: null },
          create: {
            tenantId: invitation.tenantId,
            plantId: target.id,
            clientOrgId: target.clientOrgId,
            status: 'active',
          },
        });

        if (!sameOrg) {
          const placeholderOrg = invitation.clientOrgId;
          const realOrg = target.clientOrgId;
          // Contratos y contactos de esta transportista pasan a la empresa real.
          await tx.contract.updateMany({
            where: {
              tenantId: invitation.tenantId,
              clientOrgId: placeholderOrg,
              plantId: invitation.plantId,
            },
            data: { clientOrgId: realOrg, plantId: target.id },
          });
          await tx.contract.updateMany({
            where: { tenantId: invitation.tenantId, clientOrgId: placeholderOrg },
            data: { clientOrgId: realOrg, plantId: null },
          });
          await tx.clientContact.updateMany({
            where: {
              tenantId: invitation.tenantId,
              clientOrgId: placeholderOrg,
              plantId: invitation.plantId,
            },
            data: { clientOrgId: realOrg, plantId: target.id },
          });
          await tx.clientContact.updateMany({
            where: { tenantId: invitation.tenantId, clientOrgId: placeholderOrg },
            data: { clientOrgId: realOrg, plantId: null },
          });
          await tx.lead.updateMany({
            where: { tenantId: invitation.tenantId, convertedClientOrgId: placeholderOrg },
            data: { convertedClientOrgId: realOrg },
          });
          // La empresa provisional queda archivada.
          await tx.serviceAgreement.updateMany({
            where: { tenantId: invitation.tenantId, clientOrgId: placeholderOrg },
            data: { status: 'ended', deletedAt: new Date() },
          });
          await tx.plantInvitation.updateMany({
            where: {
              clientOrgId: placeholderOrg,
              acceptedAt: null,
              revokedAt: null,
              id: { not: invitation.id },
            },
            data: { revokedAt: new Date() },
          });
          const stillUsed = await tx.serviceAgreement.count({
            where: { clientOrgId: placeholderOrg, deletedAt: null },
          });
          const orgUsers = await tx.user.count({ where: { clientOrgId: placeholderOrg } });
          if (stillUsed === 0 && orgUsers === 0) {
            await tx.plant.updateMany({
              where: { clientOrgId: placeholderOrg },
              data: { deletedAt: new Date() },
            });
            await tx.clientOrg.update({
              where: { id: placeholderOrg },
              data: { deletedAt: new Date() },
            });
          }
        }

        await tx.plantInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date(), acceptedUserId: user.id },
        });
      });

      return {
        tenantId: invitation.tenantId,
        tenantName: invitation.tenant.name,
        clientOrgId: target.clientOrgId,
        plantId: target.id,
      };
    },
  };
}
