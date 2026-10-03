import type { DbTransaction } from '../../lib/db.ts';
import type { DomainEvents } from '../../lib/domain-events.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import type { Alert, Prisma } from '../../generated/prisma/client.ts';
import { summarizeAlert } from './engine.ts';
import { ALERT_TYPE_LABELS, ALERT_TYPES, RULE_PARAMS, rulesFor } from './rules.ts';
import type { AlertSeverity, AlertType } from './rules.ts';

type AlertStatus = 'open' | 'acknowledged' | 'resolved';

/** Lo que hace el panel con las alertas: verlas, atenderlas, resolverlas y configurarlas. */
export function createAlertsService(deps: { events: DomainEvents }) {
  function announce(alert: Alert) {
    deps.events.publish({
      type: 'alert.updated',
      tenantId: alert.tenantId,
      plantId: alert.plantId,
      notifyPlant: alert.notifyPlant,
      alert: summarizeAlert(alert),
    });
  }

  async function find(tx: DbTransaction, id: string) {
    const alert = await tx.alert.findFirst({ where: { id } });
    if (!alert) throw new NotFoundError('No se encontró la alerta.');
    return alert;
  }

  return {
    async list(
      tx: DbTransaction,
      query: {
        status?: AlertStatus | undefined;
        type?: AlertType | undefined;
        tripId?: string | undefined;
        from?: Date | undefined;
        to?: Date | undefined;
        limit: number;
      },
    ) {
      const where: Prisma.AlertWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.tripId ? { tripId: query.tripId } : {}),
        ...(query.from || query.to
          ? {
              openedAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      };
      const alerts = await tx.alert.findMany({
        where,
        // Primero las críticas y las más recientes.
        orderBy: [{ severity: 'desc' }, { openedAt: 'desc' }],
        take: query.limit,
      });
      return alerts.map(summarizeAlert);
    },

    async get(tx: DbTransaction, id: string) {
      const alert = await find(tx, id);
      const actions = await tx.alertAction.findMany({
        where: { alertId: id },
        orderBy: { createdAt: 'asc' },
      });
      return {
        ...summarizeAlert(alert),
        actions: actions.map((a) => ({
          action: a.action,
          userId: a.userId,
          note: a.note,
          at: a.createdAt,
        })),
      };
    },

    /** Alguien toma la alerta: queda registrado quién y cuánto tardó. */
    async acknowledge(tx: DbTransaction, userId: string, id: string, note?: string | null) {
      const alert = await find(tx, id);
      if (alert.status !== 'open') {
        throw new ConflictError(
          alert.status === 'resolved'
            ? 'La alerta ya está resuelta.'
            : 'Alguien ya la está atendiendo.',
        );
      }
      const updated = await tx.alert.update({
        where: { id },
        data: { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedByUserId: userId },
      });
      await tx.alertAction.create({
        data: {
          tenantId: alert.tenantId,
          alertId: id,
          action: 'acknowledged',
          userId,
          note: note ?? null,
        },
      });
      // Atender un pánico también lo marca como atendido.
      const panicId = (alert.data as { panicEventId?: string } | null)?.panicEventId;
      if (alert.type === 'panic' && panicId) {
        await tx.panicEvent.updateMany({
          where: { id: panicId, acknowledgedAt: null },
          data: { acknowledgedAt: new Date(), acknowledgedByUserId: userId },
        });
      }
      announce(updated);
      return summarizeAlert(updated);
    },

    async resolve(tx: DbTransaction, userId: string, id: string, resolution: string) {
      const alert = await find(tx, id);
      if (alert.status === 'resolved') throw new ConflictError('La alerta ya está resuelta.');
      const now = new Date();
      const updated = await tx.alert.update({
        where: { id },
        data: {
          status: 'resolved',
          resolvedAt: now,
          resolvedByUserId: userId,
          resolution,
          // Resolver sin haberla tomado cuenta como atenderla en ese momento.
          ...(alert.acknowledgedAt ? {} : { acknowledgedAt: now, acknowledgedByUserId: userId }),
        },
      });
      await tx.alertAction.create({
        data: {
          tenantId: alert.tenantId,
          alertId: id,
          action: 'resolved',
          userId,
          note: resolution,
        },
      });
      announce(updated);
      return summarizeAlert(updated);
    },

    async addNote(tx: DbTransaction, userId: string, id: string, note: string) {
      const alert = await find(tx, id);
      await tx.alertAction.create({
        data: { tenantId: alert.tenantId, alertId: id, action: 'note', userId, note },
      });
      return this.get(tx, id);
    },

    async rules(tx: DbTransaction, tenantId: string) {
      const set = await rulesFor(tx, tenantId);
      return ALERT_TYPES.map((type) => ({ ...set[type], label: ALERT_TYPE_LABELS[type] }));
    },

    async saveRule(
      tx: DbTransaction,
      tenantId: string,
      type: AlertType,
      input: {
        enabled?: boolean | undefined;
        severity?: AlertSeverity | undefined;
        params?: Record<string, unknown> | undefined;
        escalateAfterMinutes?: number | undefined;
        notifyPlant?: boolean | undefined;
      },
    ) {
      const current = (await rulesFor(tx, tenantId))[type];
      const parsed = RULE_PARAMS[type].safeParse({ ...current.params, ...(input.params ?? {}) });
      if (!parsed.success) {
        throw new BadRequestError(
          'Los valores de la regla no son válidos.',
          parsed.error.issues.map((issue) => ({
            path: `params.${issue.path.join('.')}`,
            message: issue.message,
          })),
        );
      }
      const data = {
        enabled: input.enabled ?? current.enabled,
        severity: input.severity ?? current.severity,
        params: parsed.data as Prisma.InputJsonValue,
        escalateAfterMinutes: input.escalateAfterMinutes ?? current.escalateAfterMinutes,
        notifyPlant: input.notifyPlant ?? current.notifyPlant,
      };
      await tx.alertRule.upsert({
        where: { tenantId_type: { tenantId, type } },
        update: data,
        create: { tenantId, type, ...data },
      });
      return (await this.rules(tx, tenantId)).find((r) => r.type === type)!;
    },
  };
}
