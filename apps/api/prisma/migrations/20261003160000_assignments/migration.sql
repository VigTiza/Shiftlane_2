-- CreateEnum
CREATE TYPE "TripAssignmentSource" AS ENUM ('habitual', 'manual', 'copied');

-- AlterTable
ALTER TABLE "routes" ADD COLUMN     "habitual_driver_id" UUID,
ADD COLUMN     "habitual_vehicle_id" UUID;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "assigned_at" TIMESTAMPTZ(3),
ADD COLUMN     "assigned_by_user_id" UUID,
ADD COLUMN     "assignment_source" "TripAssignmentSource",
ADD COLUMN     "driver_id" UUID,
ADD COLUMN     "vehicle_id" UUID;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "required_license_type" TEXT;

-- CreateIndex
CREATE INDEX "trips_driver_id_scheduled_start_at_idx" ON "trips"("driver_id", "scheduled_start_at");

-- CreateIndex
CREATE INDEX "trips_vehicle_id_scheduled_start_at_idx" ON "trips"("vehicle_id", "scheduled_start_at");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_habitual_driver_id_tenant_id_fkey" FOREIGN KEY ("habitual_driver_id", "tenant_id") REFERENCES "drivers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_habitual_vehicle_id_tenant_id_fkey" FOREIGN KEY ("habitual_vehicle_id", "tenant_id") REFERENCES "vehicles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_tenant_id_fkey" FOREIGN KEY ("driver_id", "tenant_id") REFERENCES "drivers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_tenant_id_fkey" FOREIGN KEY ("vehicle_id", "tenant_id") REFERENCES "vehicles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Asignación de unidad y chofer (F04-P02)
-- ===========================================================================

-- El origen de la asignación existe solo si el viaje tiene chofer o unidad.
ALTER TABLE "trips" ADD CONSTRAINT "trips_assignment_source_check"
  CHECK ((driver_id IS NULL AND vehicle_id IS NULL) = (assignment_source IS NULL));
