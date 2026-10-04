import type { DbTransaction } from '../../lib/db.ts';
import { NotFoundError } from '../../lib/errors.ts';
import { contentTypeOf } from '../../lib/files.ts';
import type { ObjectStorage } from '../../lib/storage.ts';
import type { UploadedFile } from '../../lib/uploads.ts';
import { storageKey } from '../../lib/uploads.ts';
import { ONBOARDING_STEPS } from './schemas.ts';
import type { OnboardingStep } from './schemas.ts';

// `type` (no `interface`) para que Prisma lo acepte como JSON.
type OnboardingState = {
  done?: Partial<Record<OnboardingStep, boolean>>;
  dismissedAt?: string | null;
};

function stateOf(value: unknown): OnboardingState {
  return value && typeof value === 'object' ? value : {};
}

/** Datos de la empresa (transportista) y avance del asistente de configuración inicial. */
export function createCompanyService(deps: { storage: ObjectStorage }) {
  async function tenant(tx: DbTransaction, tenantId: string) {
    const found = await tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!found) throw new NotFoundError('No se encontró la empresa.');
    return found;
  }

  function summary(found: Awaited<ReturnType<typeof tenant>>) {
    return {
      id: found.id,
      name: found.name,
      legalName: found.legalName,
      rfc: found.rfc,
      hasLogo: found.logoKey !== null,
    };
  }

  /** Lo que ya existe en la cuenta para cada paso (así el avance no depende de marcarlo). */
  async function counts(tx: DbTransaction, tenantId: string) {
    const company = await tenant(tx, tenantId);
    const [customRules, shifts, vehicles, drivers, plants, routes, invitations, passengers] = [
      await tx.alertRule.count({ where: { tenantId } }),
      await tx.shift.count({ where: { tenantId, deletedAt: null } }),
      await tx.vehicle.count({ where: { tenantId, deletedAt: null } }),
      await tx.driver.count({ where: { tenantId, deletedAt: null } }),
      await tx.serviceAgreement.count({ where: { tenantId, deletedAt: null } }),
      await tx.route.count({ where: { tenantId, deletedAt: null } }),
      await tx.plantInvitation.count({}),
      await tx.passenger.count({ where: { deletedAt: null } }),
    ];
    const [devices, completedTrips] = [
      await tx.device.count({ where: { tenantId, revokedAt: null } }),
      await tx.trip.count({ where: { tenantId, status: 'completed' } }),
    ];
    const companyFields = [company.legalName, company.rfc, company.logoKey].filter(Boolean).length;
    return {
      company,
      values: {
        company: { count: companyFields, done: !!company.legalName && !!company.rfc },
        operation: { count: customRules + shifts, done: customRules > 0 || shifts > 0 },
        fleet: { count: vehicles + drivers, done: vehicles > 0 && drivers > 0 },
        clients: { count: plants, done: plants > 0 },
        routes: { count: routes, done: routes > 0 },
        plant_invite: {
          count: invitations + passengers,
          done: invitations > 0 || passengers > 0,
        },
        devices: { count: devices, done: devices > 0 },
        test_trip: { count: completedTrips, done: completedTrips > 0 },
      } satisfies Record<OnboardingStep, { count: number; done: boolean }>,
    };
  }

  return {
    async get(tx: DbTransaction, tenantId: string) {
      return summary(await tenant(tx, tenantId));
    },

    async update(
      tx: DbTransaction,
      tenantId: string,
      input: { name?: string | undefined; legalName?: string | null; rfc?: string | null },
    ) {
      await tenant(tx, tenantId);
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
          ...(input.rfc !== undefined ? { rfc: input.rfc } : {}),
        },
      });
      return summary(updated);
    },

    async setLogo(tx: DbTransaction, tenantId: string, file: UploadedFile) {
      const found = await tenant(tx, tenantId);
      const key = storageKey(tenantId, 'empresa', file.extension);
      await deps.storage.put(key, file.buffer, file.contentType);
      await tx.tenant.update({ where: { id: tenantId }, data: { logoKey: key } });
      if (found.logoKey) await deps.storage.delete(found.logoKey);
    },

    async getLogo(tx: DbTransaction, tenantId: string) {
      const found = await tenant(tx, tenantId);
      const body = found.logoKey ? await deps.storage.get(found.logoKey) : null;
      if (!found.logoKey || !body) throw new NotFoundError('La empresa no tiene logo.');
      return { body, contentType: contentTypeOf(found.logoKey) };
    },

    async deleteLogo(tx: DbTransaction, tenantId: string) {
      const found = await tenant(tx, tenantId);
      if (!found.logoKey) return;
      await tx.tenant.update({ where: { id: tenantId }, data: { logoKey: null } });
      await deps.storage.delete(found.logoKey);
    },

    async onboarding(tx: DbTransaction, tenantId: string) {
      const { company, values } = await counts(tx, tenantId);
      const state = stateOf(company.onboarding);
      const steps = ONBOARDING_STEPS.map((key) => {
        const markedManually = state.done?.[key] === true;
        return {
          key,
          done: values[key].done || markedManually,
          count: values[key].count,
          markedManually,
        };
      });
      return {
        steps,
        completed: steps.filter((step) => step.done).length,
        total: steps.length,
        dismissed: !!state.dismissedAt,
      };
    },

    async markStep(tx: DbTransaction, tenantId: string, step: OnboardingStep, done: boolean) {
      const found = await tenant(tx, tenantId);
      const state = stateOf(found.onboarding);
      const next: OnboardingState = { ...state, done: { ...state.done, [step]: done } };
      await tx.tenant.update({ where: { id: tenantId }, data: { onboarding: next } });
      return this.onboarding(tx, tenantId);
    },

    async dismiss(tx: DbTransaction, tenantId: string, dismissed: boolean) {
      const found = await tenant(tx, tenantId);
      const next: OnboardingState = {
        ...stateOf(found.onboarding),
        dismissedAt: dismissed ? new Date().toISOString() : null,
      };
      await tx.tenant.update({ where: { id: tenantId }, data: { onboarding: next } });
      return this.onboarding(tx, tenantId);
    },
  };
}
