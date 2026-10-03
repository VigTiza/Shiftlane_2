-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TripKind" AS ENUM ('regular', 'extra');

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "service_runs" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "route_id" UUID,
    "route_version_id" UUID,
    "shift_id" UUID,
    "temporary_change_id" UUID,
    "kind" "TripKind" NOT NULL DEFAULT 'regular',
    "status" "TripStatus" NOT NULL DEFAULT 'scheduled',
    "direction" "RouteDirection" NOT NULL,
    "service_date" DATE NOT NULL,
    "scheduled_start_at" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end_at" TIMESTAMPTZ(3) NOT NULL,
    "is_holiday" BOOLEAN NOT NULL DEFAULT false,
    "generation_key" TEXT,
    "cancel_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holidays_tenant_id_date_idx" ON "holidays"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_tenant_id_plant_id_date_key" ON "holidays"("tenant_id", "plant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "trips_generation_key_key" ON "trips"("generation_key");

-- CreateIndex
CREATE INDEX "trips_tenant_id_service_date_idx" ON "trips"("tenant_id", "service_date");

-- CreateIndex
CREATE INDEX "trips_route_id_service_date_idx" ON "trips"("route_id", "service_date");

-- CreateIndex
CREATE INDEX "trips_plant_id_service_date_idx" ON "trips"("plant_id", "service_date");

-- CreateIndex
CREATE UNIQUE INDEX "trips_id_tenant_id_key" ON "trips"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_tenant_id_fkey" FOREIGN KEY ("route_id", "tenant_id") REFERENCES "routes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_version_id_tenant_id_fkey" FOREIGN KEY ("route_version_id", "tenant_id") REFERENCES "route_versions"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_shift_id_tenant_id_fkey" FOREIGN KEY ("shift_id", "tenant_id") REFERENCES "shifts"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Seguridad e integridad de festivos y viajes (docs/decisiones/0003)
-- ===========================================================================

-- Un solo festivo general (plant_id nulo) por día y transportista.
DROP INDEX "holidays_tenant_id_plant_id_date_key";
CREATE UNIQUE INDEX "holidays_tenant_id_plant_id_date_key" ON "holidays"("tenant_id", "plant_id", "date") NULLS NOT DISTINCT;

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_weekdays_check" CHECK (weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);
ALTER TABLE "trips" ADD CONSTRAINT "trips_times_check" CHECK (scheduled_end_at >= scheduled_start_at);
ALTER TABLE "trips" ADD CONSTRAINT "trips_regular_check" CHECK (kind <> 'regular' OR route_id IS NOT NULL);

CREATE TRIGGER holidays_touch_updated_at BEFORE UPDATE ON "holidays" FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trips_touch_updated_at BEFORE UPDATE ON "trips" FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;
SELECT app.enable_audit('holidays');
-- Los viajes no se auditan fila por fila (volumen alto); su historial son los eventos de viaje (F05).

CREATE POLICY holidays_isolation ON "holidays" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    AND (plant_id IS NULL OR plant_id IN (SELECT app.agreement_plant_ids()))
  );

-- Viajes: de la transportista; la planta ve los de las transportistas con las que tiene acuerdo.
CREATE POLICY trips_select ON "trips" FOR SELECT TO shiftlane_app
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    OR (tenant_id IN (SELECT app.agreement_tenant_ids()) AND plant_id IN (SELECT app.current_org_plant_ids()))
  );
CREATE POLICY trips_insert ON "trips" FOR INSERT TO shiftlane_app
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()) AND plant_id IN (SELECT app.agreement_plant_ids()));
CREATE POLICY trips_update ON "trips" FOR UPDATE TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
REVOKE DELETE ON TABLE "trips" FROM shiftlane_app;
