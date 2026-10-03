-- CreateEnum
CREATE TYPE "TripEventType" AS ENUM ('checklist_submitted', 'checklist_exception', 'started', 'stop_arrived', 'passenger_scanned', 'incident_reported', 'panic', 'gate_arrived', 'finished', 'cancelled');

-- CreateEnum
CREATE TYPE "TripPhotoKind" AS ENUM ('checklist', 'incident', 'evidence');

-- CreateEnum
CREATE TYPE "BoardingMethod" AS ENUM ('shiftlane_qr', 'badge', 'manual');

-- CreateEnum
CREATE TYPE "BoardingResult" AS ENUM ('ok', 'other_route', 'unregistered');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('traffic', 'mechanical', 'accident', 'passenger', 'forced_detour', 'other');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'resolved');

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "actual_end_at" TIMESTAMPTZ(3),
ADD COLUMN     "actual_start_at" TIMESTAMPTZ(3),
ADD COLUMN     "arrival_gate_id" UUID,
ADD COLUMN     "arrived_at" TIMESTAMPTZ(3),
ADD COLUMN     "checklist_exception_at" TIMESTAMPTZ(3),
ADD COLUMN     "checklist_exception_by_user_id" UUID,
ADD COLUMN     "checklist_exception_reason" TEXT;

-- CreateTable
CREATE TABLE "trip_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "type" "TripEventType" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "client_event_id" UUID,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "data" JSONB,

    CONSTRAINT "trip_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "items" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "client_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "driver_id" UUID,
    "kind" "TripPhotoKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boardings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "passenger_id" UUID,
    "provisional_badge_id" UUID,
    "stop_id" UUID,
    "method" "BoardingMethod" NOT NULL,
    "result" "BoardingResult" NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "client_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boardings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "driver_id" UUID,
    "type" "IncidentType" NOT NULL,
    "description" TEXT,
    "photo_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_user_id" UUID,
    "client_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "panic_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "trip_id" UUID,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_user_id" UUID,
    "client_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "panic_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_events_trip_id_occurred_at_idx" ON "trip_events"("trip_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "trip_events_trip_id_client_event_id_key" ON "trip_events"("trip_id", "client_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_tenant_id_key" ON "checklist_templates"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_results_client_event_id_key" ON "checklist_results"("client_event_id");

-- CreateIndex
CREATE INDEX "checklist_results_vehicle_id_service_date_idx" ON "checklist_results"("vehicle_id", "service_date");

-- CreateIndex
CREATE INDEX "trip_photos_trip_id_idx" ON "trip_photos"("trip_id");

-- CreateIndex
CREATE INDEX "boardings_trip_id_scanned_at_idx" ON "boardings"("trip_id", "scanned_at");

-- CreateIndex
CREATE UNIQUE INDEX "boardings_trip_id_passenger_id_key" ON "boardings"("trip_id", "passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "boardings_trip_id_provisional_badge_id_key" ON "boardings"("trip_id", "provisional_badge_id");

-- CreateIndex
CREATE UNIQUE INDEX "boardings_trip_id_client_event_id_key" ON "boardings"("trip_id", "client_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_client_event_id_key" ON "incidents"("client_event_id");

-- CreateIndex
CREATE INDEX "incidents_tenant_id_status_idx" ON "incidents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "incidents_trip_id_idx" ON "incidents"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "panic_events_client_event_id_key" ON "panic_events"("client_event_id");

-- CreateIndex
CREATE INDEX "panic_events_tenant_id_acknowledged_at_idx" ON "panic_events"("tenant_id", "acknowledged_at");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_arrival_gate_id_fkey" FOREIGN KEY ("arrival_gate_id") REFERENCES "plant_gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_trip_id_tenant_id_fkey" FOREIGN KEY ("trip_id", "tenant_id") REFERENCES "trips"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_trip_id_tenant_id_fkey" FOREIGN KEY ("trip_id", "tenant_id") REFERENCES "trips"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_driver_id_tenant_id_fkey" FOREIGN KEY ("driver_id", "tenant_id") REFERENCES "drivers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_vehicle_id_tenant_id_fkey" FOREIGN KEY ("vehicle_id", "tenant_id") REFERENCES "vehicles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_trip_id_tenant_id_fkey" FOREIGN KEY ("trip_id", "tenant_id") REFERENCES "trips"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boardings" ADD CONSTRAINT "boardings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boardings" ADD CONSTRAINT "boardings_trip_id_tenant_id_fkey" FOREIGN KEY ("trip_id", "tenant_id") REFERENCES "trips"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boardings" ADD CONSTRAINT "boardings_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boardings" ADD CONSTRAINT "boardings_provisional_badge_id_fkey" FOREIGN KEY ("provisional_badge_id") REFERENCES "provisional_badges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boardings" ADD CONSTRAINT "boardings_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_trip_id_tenant_id_fkey" FOREIGN KEY ("trip_id", "tenant_id") REFERENCES "trips"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_driver_id_tenant_id_fkey" FOREIGN KEY ("driver_id", "tenant_id") REFERENCES "drivers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panic_events" ADD CONSTRAINT "panic_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panic_events" ADD CONSTRAINT "panic_events_driver_id_tenant_id_fkey" FOREIGN KEY ("driver_id", "tenant_id") REFERENCES "drivers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panic_events" ADD CONSTRAINT "panic_events_trip_id_tenant_id_fkey" FOREIGN KEY ("trip_id", "tenant_id") REFERENCES "trips"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Seguridad e integridad de la ejecución de viajes (docs/decisiones/0003)
-- ===========================================================================

-- Historial inmutable: ni la aplicación ni un error de código pueden reescribirlo.
CREATE FUNCTION app.reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Este registro es parte del historial del viaje y no se puede modificar.'
      USING ERRCODE = 'insufficient_privilege';
  END
  $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trip_events', 'checklist_results', 'trip_photos', 'boardings'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.reject_change()',
      t || '_immutable', t
    );
    EXECUTE format('REVOKE UPDATE, DELETE ON TABLE %I FROM shiftlane_app', t);
  END LOOP;
END
$$;
REVOKE DELETE ON TABLE "incidents" FROM shiftlane_app;
REVOKE DELETE ON TABLE "panic_events" FROM shiftlane_app;

CREATE TRIGGER checklist_templates_touch_updated_at BEFORE UPDATE ON "checklist_templates"
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER incidents_touch_updated_at BEFORE UPDATE ON "incidents"
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Auditoría de lo que se edita a mano; el historial del viaje ya es trip_events.
SELECT app.enable_audit('checklist_templates');
SELECT app.enable_audit('incidents');
SELECT app.enable_audit('panic_events');

-- Cada transportista ve y escribe solo lo suyo.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trip_events', 'checklist_templates', 'checklist_results', 'trip_photos',
                           'boardings', 'incidents', 'panic_events'] LOOP
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

-- La planta ve la evidencia de los viajes de sus transportistas (historial, abordajes,
-- incidentes y fotos).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trip_events', 'trip_photos', 'boardings', 'incidents'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO shiftlane_app
         USING (trip_id IN (
           SELECT id FROM trips
           WHERE plant_id IN (SELECT app.current_org_plant_ids())
             AND tenant_id IN (SELECT app.agreement_tenant_ids())
         ))',
      t || '_plant_select', t
    );
  END LOOP;
END
$$;
