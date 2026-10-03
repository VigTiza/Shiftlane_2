-- CreateEnum
CREATE TYPE "SyncEventStatus" AS ENUM ('applied', 'rejected');

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "clock_offset_ms" INTEGER,
ADD COLUMN     "last_sync_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "device_sync_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "sequence" INTEGER,
    "trip_id" UUID,
    "device_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SyncEventStatus" NOT NULL,
    "message" TEXT,
    "result" JSONB,

    CONSTRAINT "device_sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_sync_events_tenant_id_received_at_idx" ON "device_sync_events"("tenant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_sync_events_device_id_event_id_key" ON "device_sync_events"("device_id", "event_id");

-- AddForeignKey
ALTER TABLE "device_sync_events" ADD CONSTRAINT "device_sync_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sync_events" ADD CONSTRAINT "device_sync_events_device_id_tenant_id_fkey" FOREIGN KEY ("device_id", "tenant_id") REFERENCES "devices"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Sincronización: bitácora inmutable y auditoría sin ruido (docs/decisiones/0003)
-- ===========================================================================

ALTER TABLE "device_sync_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_sync_events_isolation ON "device_sync_events" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
CREATE TRIGGER device_sync_events_immutable BEFORE UPDATE OR DELETE ON "device_sync_events"
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();
REVOKE UPDATE, DELETE ON TABLE "device_sync_events" FROM shiftlane_app;

-- Cada sincronización actualiza la hora y el desfase del celular: no se audita ese cambio.
DROP TRIGGER audit_row ON "devices";
SELECT app.enable_audit('devices', ARRAY['last_seen_at', 'last_sync_at', 'clock_offset_ms', 'updated_at']);
