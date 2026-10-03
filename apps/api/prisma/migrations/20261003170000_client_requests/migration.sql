-- CreateEnum
CREATE TYPE "ExtraTripReason" AS ENUM ('overtime', 'shift_change', 'event', 'other');

-- CreateEnum
CREATE TYPE "ClientRequestType" AS ENUM ('extra_trip', 'schedule_change', 'route_change', 'other');

-- CreateEnum
CREATE TYPE "ClientRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "client_request_id" UUID,
ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "extra_reason" "ExtraTripReason",
ADD COLUMN     "requested_passengers" INTEGER;

-- CreateTable
CREATE TABLE "client_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_org_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "type" "ClientRequestType" NOT NULL,
    "status" "ClientRequestStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "service_date" DATE,
    "direction" "RouteDirection",
    "plant_time" TEXT,
    "passengers" INTEGER,
    "route_id" UUID,
    "extra_reason" "ExtraTripReason",
    "requested_by_user_id" UUID,
    "response" TEXT,
    "responded_by_user_id" UUID,
    "responded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_requests_tenant_id_status_idx" ON "client_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "client_requests_client_org_id_status_idx" ON "client_requests"("client_org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "client_requests_id_tenant_id_key" ON "client_requests"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_client_request_id_tenant_id_fkey" FOREIGN KEY ("client_request_id", "tenant_id") REFERENCES "client_requests"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_plant_id_client_org_id_fkey" FOREIGN KEY ("plant_id", "client_org_id") REFERENCES "plants"("id", "client_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_route_id_tenant_id_fkey" FOREIGN KEY ("route_id", "tenant_id") REFERENCES "routes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Seguridad e integridad de solicitudes y viajes extra (docs/decisiones/0003)
-- ===========================================================================

ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_extra_trip_check" CHECK (
  type <> 'extra_trip'
  OR (service_date IS NOT NULL AND direction IS NOT NULL AND plant_time IS NOT NULL)
);
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_passengers_check"
  CHECK (passengers IS NULL OR passengers BETWEEN 1 AND 500);
ALTER TABLE "trips" ADD CONSTRAINT "trips_requested_passengers_check"
  CHECK (requested_passengers IS NULL OR requested_passengers BETWEEN 1 AND 500);

CREATE TRIGGER client_requests_touch_updated_at BEFORE UPDATE ON "client_requests"
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE "client_requests" ENABLE ROW LEVEL SECURITY;
SELECT app.enable_audit('client_requests');

-- La transportista ve las solicitudes dirigidas a ella; la planta, las suyas mientras exista
-- el acuerdo con esa transportista.
CREATE POLICY client_requests_select ON "client_requests" FOR SELECT TO shiftlane_app
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    OR (
      client_org_id = (SELECT app.current_client_org_id())
      AND tenant_id IN (SELECT app.agreement_tenant_ids())
    )
  );
-- Solo la planta crea solicitudes, para sus plantas y transportistas con acuerdo.
CREATE POLICY client_requests_insert ON "client_requests" FOR INSERT TO shiftlane_app
  WITH CHECK (
    client_org_id = (SELECT app.current_client_org_id())
    AND tenant_id IN (SELECT app.agreement_tenant_ids())
    AND plant_id IN (SELECT app.current_org_plant_ids())
  );
-- La transportista responde y la planta cancela.
CREATE POLICY client_requests_update ON "client_requests" FOR UPDATE TO shiftlane_app
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  )
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  );
REVOKE DELETE ON TABLE "client_requests" FROM shiftlane_app;
