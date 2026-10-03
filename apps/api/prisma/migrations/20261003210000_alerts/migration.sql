-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('trip_not_started', 'delay', 'off_route', 'speeding', 'unscheduled_stop', 'overcapacity', 'panic', 'checklist_failed', 'device_silent', 'expired_documents_on_assign');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" "AlertType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" "AlertSeverity" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "escalate_after_minutes" INTEGER NOT NULL,
    "notify_plant" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID,
    "trip_id" UUID,
    "driver_id" UUID,
    "vehicle_id" UUID,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "cause" TEXT NOT NULL,
    "suggested_action" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "data" JSONB,
    "dedupe_key" TEXT NOT NULL,
    "notify_plant" BOOLEAN NOT NULL DEFAULT false,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_user_id" UUID,
    "resolution" TEXT,
    "auto_resolved" BOOLEAN NOT NULL DEFAULT false,
    "escalated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alert_rules_tenant_id_type_key" ON "alert_rules"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "alerts_tenant_id_status_idx" ON "alerts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "alerts_tenant_id_dedupe_key_idx" ON "alerts"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "alerts_trip_id_idx" ON "alerts"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_id_tenant_id_key" ON "alerts"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "alert_actions_alert_id_idx" ON "alert_actions"("alert_id");

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_trip_id_tenant_id_fkey" FOREIGN KEY ("trip_id", "tenant_id") REFERENCES "trips"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_actions" ADD CONSTRAINT "alert_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_actions" ADD CONSTRAINT "alert_actions_alert_id_tenant_id_fkey" FOREIGN KEY ("alert_id", "tenant_id") REFERENCES "alerts"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Seguridad de alertas (docs/decisiones/0003)
-- ===========================================================================

CREATE TRIGGER alert_rules_touch_updated_at BEFORE UPDATE ON "alert_rules"
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER alerts_touch_updated_at BEFORE UPDATE ON "alerts"
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- La configuración se audita; las alertas llevan su propio historial (alert_actions).
SELECT app.enable_audit('alert_rules');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['alert_rules', 'alerts', 'alert_actions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO shiftlane_app
         USING (tenant_id = (SELECT app.current_tenant_id()))
         WITH CHECK (tenant_id = (SELECT app.current_tenant_id()))',
      t || '_isolation', t
    );
  END LOOP;
END
$$;

-- La planta ve las alertas que la regla le comparte, de sus plantas y transportistas.
CREATE POLICY alerts_plant_select ON "alerts" FOR SELECT TO shiftlane_app
  USING (
    notify_plant
    AND plant_id IN (SELECT app.current_org_plant_ids())
    AND tenant_id IN (SELECT app.agreement_tenant_ids())
  );

-- El historial de una alerta no se edita ni se borra.
CREATE TRIGGER alert_actions_immutable BEFORE UPDATE OR DELETE ON "alert_actions"
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();
REVOKE UPDATE, DELETE ON TABLE "alert_actions" FROM shiftlane_app;
REVOKE DELETE ON TABLE "alerts" FROM shiftlane_app;
