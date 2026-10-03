-- CreateEnum
CREATE TYPE "CredentialKind" AS ENUM ('shiftlane_qr', 'badge_barcode', 'badge_qr');

-- CreateEnum
CREATE TYPE "BadgeKind" AS ENUM ('barcode', 'qr');

-- CreateEnum
CREATE TYPE "ProvisionalBadgeStatus" AS ENUM ('pending', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "PassengerImportMode" AS ENUM ('changes', 'full');

-- CreateEnum
CREATE TYPE "PassengerImportStatus" AS ENUM ('previewed', 'applied', 'discarded');

-- AlterTable
ALTER TABLE "passengers" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "shift_name" TEXT;

-- CreateTable
CREATE TABLE "passenger_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_org_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "kind" "CredentialKind" NOT NULL,
    "value" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passenger_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provisional_badges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_org_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "tenant_id" UUID,
    "value" TEXT NOT NULL,
    "kind" "BadgeKind" NOT NULL,
    "status" "ProvisionalBadgeStatus" NOT NULL DEFAULT 'pending',
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_passenger_id" UUID,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provisional_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_org_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID,
    "file_name" TEXT NOT NULL,
    "mode" "PassengerImportMode" NOT NULL,
    "status" "PassengerImportStatus" NOT NULL DEFAULT 'previewed',
    "rows" JSONB,
    "summary" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(3),

    CONSTRAINT "passenger_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "passenger_credentials_passenger_id_idx" ON "passenger_credentials"("passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_credentials_client_org_id_kind_value_key" ON "passenger_credentials"("client_org_id", "kind", "value");

-- CreateIndex
CREATE INDEX "provisional_badges_plant_id_status_idx" ON "provisional_badges"("plant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "provisional_badges_client_org_id_value_key" ON "provisional_badges"("client_org_id", "value");

-- CreateIndex
CREATE INDEX "passenger_imports_client_org_id_created_at_idx" ON "passenger_imports"("client_org_id", "created_at");

-- AddForeignKey
ALTER TABLE "passenger_credentials" ADD CONSTRAINT "passenger_credentials_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_credentials" ADD CONSTRAINT "passenger_credentials_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisional_badges" ADD CONSTRAINT "provisional_badges_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisional_badges" ADD CONSTRAINT "provisional_badges_plant_id_client_org_id_fkey" FOREIGN KEY ("plant_id", "client_org_id") REFERENCES "plants"("id", "client_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisional_badges" ADD CONSTRAINT "provisional_badges_resolved_passenger_id_fkey" FOREIGN KEY ("resolved_passenger_id") REFERENCES "passengers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_imports" ADD CONSTRAINT "passenger_imports_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_imports" ADD CONSTRAINT "passenger_imports_plant_id_client_org_id_fkey" FOREIGN KEY ("plant_id", "client_org_id") REFERENCES "plants"("id", "client_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Seguridad, auditoría e integridad de pasajeros y credenciales (docs/decisiones/0003)
-- ===========================================================================

ALTER TABLE "passenger_credentials" ADD CONSTRAINT "passenger_credentials_value_check"
  CHECK (length(value) BETWEEN 3 AND 200);
ALTER TABLE "provisional_badges" ADD CONSTRAINT "provisional_badges_value_check"
  CHECK (length(value) BETWEEN 3 AND 200 AND seen_count >= 1);

-- La credencial pertenece a la misma empresa que el pasajero.
CREATE FUNCTION app.passenger_credentials_same_org() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM passengers WHERE id = NEW.passenger_id AND client_org_id = NEW.client_org_id
    ) THEN
      RAISE EXCEPTION 'El pasajero no pertenece a la empresa de la credencial.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER passenger_credentials_same_org BEFORE INSERT OR UPDATE ON "passenger_credentials"
  FOR EACH ROW EXECUTE FUNCTION app.passenger_credentials_same_org();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['passenger_credentials', 'provisional_badges'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  END LOOP;
  FOREACH t IN ARRAY ARRAY['passenger_credentials', 'provisional_badges', 'passenger_imports'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

SELECT app.enable_audit('passenger_credentials');
SELECT app.enable_audit('provisional_badges', ARRAY['seen_count', 'last_seen_at']);
-- passenger_imports no se audita: es su propio registro y guardaría datos personales de más.

-- Credenciales: la planta las administra; las transportistas que atienden al pasajero las leen
-- (el chofer valida al pasajero al abordar).
CREATE POLICY passenger_credentials_select ON "passenger_credentials" FOR SELECT TO shiftlane_app
  USING (
    client_org_id = (SELECT app.current_client_org_id())
    OR passenger_id IN (SELECT p.id FROM passengers p)
  );
CREATE POLICY passenger_credentials_write ON "passenger_credentials" FOR ALL TO shiftlane_app
  USING (client_org_id = (SELECT app.current_client_org_id()))
  WITH CHECK (client_org_id = (SELECT app.current_client_org_id()));

-- Gafetes provisionales: los registra el sistema cuando un chofer escanea; los ve la planta y
-- la transportista que los escaneó; solo la planta los resuelve.
CREATE POLICY provisional_badges_select ON "provisional_badges" FOR SELECT TO shiftlane_app
  USING (
    client_org_id = (SELECT app.current_client_org_id())
    OR tenant_id = (SELECT app.current_tenant_id())
  );
CREATE POLICY provisional_badges_update ON "provisional_badges" FOR UPDATE TO shiftlane_app
  USING (client_org_id = (SELECT app.current_client_org_id()))
  WITH CHECK (client_org_id = (SELECT app.current_client_org_id()));

CREATE POLICY passenger_imports_isolation ON "passenger_imports" FOR ALL TO shiftlane_app
  USING (client_org_id = (SELECT app.current_client_org_id()))
  WITH CHECK (client_org_id = (SELECT app.current_client_org_id()));
