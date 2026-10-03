-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('available', 'on_route', 'maintenance', 'out_of_service');

-- CreateEnum
CREATE TYPE "VehicleDocumentType" AS ENUM ('permit', 'insurance', 'registration_card', 'emissions_verification', 'other');

-- CreateEnum
CREATE TYPE "DriverDocumentType" AS ENUM ('license', 'medical_exam', 'drug_test', 'training', 'other');

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_phone" TEXT,
ADD COLUMN     "habitual_vehicle_id" UUID,
ADD COLUMN     "license_number" TEXT,
ADD COLUMN     "license_type" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "photo_key" TEXT;

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "economic_number" TEXT NOT NULL,
    "plates" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'available',
    "odometer_km" INTEGER NOT NULL DEFAULT 0,
    "photo_key" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "type" "VehicleDocumentType" NOT NULL,
    "number" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "file_key" TEXT,
    "file_name" TEXT,
    "file_type" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "type" "DriverDocumentType" NOT NULL,
    "number" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "file_key" TEXT,
    "file_name" TEXT,
    "file_type" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicles_tenant_id_status_idx" ON "vehicles"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_id_tenant_id_key" ON "vehicles"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenant_id_economic_number_key" ON "vehicles"("tenant_id", "economic_number");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenant_id_plates_key" ON "vehicles"("tenant_id", "plates");

-- CreateIndex
CREATE INDEX "vehicle_documents_tenant_id_expires_on_idx" ON "vehicle_documents"("tenant_id", "expires_on");

-- CreateIndex
CREATE INDEX "vehicle_documents_vehicle_id_idx" ON "vehicle_documents"("vehicle_id");

-- CreateIndex
CREATE INDEX "driver_documents_tenant_id_expires_on_idx" ON "driver_documents"("tenant_id", "expires_on");

-- CreateIndex
CREATE INDEX "driver_documents_driver_id_idx" ON "driver_documents"("driver_id");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_habitual_vehicle_id_tenant_id_fkey" FOREIGN KEY ("habitual_vehicle_id", "tenant_id") REFERENCES "vehicles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_tenant_id_fkey" FOREIGN KEY ("vehicle_id", "tenant_id") REFERENCES "vehicles"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_tenant_id_fkey" FOREIGN KEY ("driver_id", "tenant_id") REFERENCES "drivers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Seguridad, auditoría e integridad de la flota (docs/decisiones/0003)
-- ===========================================================================

ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_capacity_check" CHECK (capacity BETWEEN 1 AND 120);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_year_check" CHECK (year BETWEEN 1980 AND 2100);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_odometer_check" CHECK (odometer_km >= 0);
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_dates_check"
  CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on);
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_dates_check"
  CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles', 'vehicle_documents', 'driver_documents'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t || '_touch_updated_at', t
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO shiftlane_app
         USING (tenant_id = (SELECT app.current_tenant_id()))
         WITH CHECK (tenant_id = (SELECT app.current_tenant_id()))',
      t || '_isolation', t
    );
    PERFORM app.enable_audit(t::regclass);
  END LOOP;
END
$$;
