-- AlterTable
ALTER TABLE "temporary_changes" ADD COLUMN     "suspends_service" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "route_version_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "route_passengers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "stop_key" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "route_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "route_passengers_passenger_id_idx" ON "route_passengers"("passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_passengers_route_id_passenger_id_key" ON "route_passengers"("route_id", "passenger_id");

-- AddForeignKey
ALTER TABLE "route_passengers" ADD CONSTRAINT "route_passengers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_passengers" ADD CONSTRAINT "route_passengers_route_id_tenant_id_fkey" FOREIGN KEY ("route_id", "tenant_id") REFERENCES "routes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_passengers" ADD CONSTRAINT "route_passengers_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Cambios temporales con suspensión y pasajeros por parada (docs/decisiones/0003)
-- ===========================================================================

ALTER TABLE "temporary_changes" ADD CONSTRAINT "temporary_changes_kind_check"
  CHECK (suspends_service = (route_version_id IS NULL));

CREATE TRIGGER route_passengers_touch_updated_at BEFORE UPDATE ON "route_passengers"
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE "route_passengers" ENABLE ROW LEVEL SECURITY;
SELECT app.enable_audit('route_passengers');

-- La transportista asigna a pasajeros que puede ver (de plantas que atiende); la planta ve las
-- asignaciones de las rutas que la atienden.
CREATE POLICY route_passengers_select ON "route_passengers" FOR SELECT TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()) OR route_id IN (SELECT r.id FROM routes r));
CREATE POLICY route_passengers_write ON "route_passengers" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    AND passenger_id IN (SELECT p.id FROM passengers p)
  );
