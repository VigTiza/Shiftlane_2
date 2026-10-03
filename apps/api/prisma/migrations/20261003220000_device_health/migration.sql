-- CreateTable
CREATE TABLE "device_health_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "driver_id" UUID,
    "trip_id" UUID,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "battery_pct" INTEGER,
    "charging" BOOLEAN,
    "network_type" TEXT,
    "signal_level" INTEGER,
    "mobile_data_enabled" BOOLEAN,
    "location_permission" TEXT,
    "gps_enabled" BOOLEAN,
    "background_allowed" BOOLEAN,
    "battery_optimization_ignored" BOOLEAN,
    "camera_permission" BOOLEAN,
    "app_version" TEXT,
    "os_version" TEXT,
    "platform" TEXT,
    "device_model" TEXT,
    "clock_offset_ms" INTEGER,
    "status" TEXT NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "device_health_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_health_reports_device_id_recorded_at_idx" ON "device_health_reports"("device_id", "recorded_at");

-- CreateIndex
CREATE INDEX "device_health_reports_driver_id_recorded_at_idx" ON "device_health_reports"("driver_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "device_health_reports" ADD CONSTRAINT "device_health_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_health_reports" ADD CONSTRAINT "device_health_reports_device_id_tenant_id_fkey" FOREIGN KEY ("device_id", "tenant_id") REFERENCES "devices"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Salud del celular: historial inmutable con RLS (docs/decisiones/0003)
-- ===========================================================================

ALTER TABLE "device_health_reports" ADD CONSTRAINT "device_health_reports_values_check" CHECK (
  (battery_pct IS NULL OR battery_pct BETWEEN 0 AND 100)
  AND (signal_level IS NULL OR signal_level BETWEEN 0 AND 4)
  AND status IN ('ok', 'warning', 'problem')
);
ALTER TABLE "device_health_reports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_health_reports_isolation ON "device_health_reports" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
CREATE TRIGGER device_health_reports_immutable BEFORE UPDATE OR DELETE ON "device_health_reports"
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();
REVOKE UPDATE, DELETE ON TABLE "device_health_reports" FROM shiftlane_app;
