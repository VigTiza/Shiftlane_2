-- CreateEnum
CREATE TYPE "SessionPrincipal" AS ENUM ('user', 'driver', 'passenger');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "PassengerStatus" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "plants" ADD COLUMN     "passenger_activation_code" TEXT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "device_id" UUID,
ADD COLUMN     "driver_id" UUID,
ADD COLUMN     "passenger_id" UUID,
ADD COLUMN     "principal" "SessionPrincipal" NOT NULL,
ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMPTZ(3),
ADD COLUMN     "password_changed_at" TIMESTAMPTZ(3),
ADD COLUMN     "totp_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "totp_last_step" INTEGER,
ADD COLUMN     "totp_secret" TEXT;

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "employee_number" TEXT,
    "phone" TEXT,
    "status" "DriverStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_pins" (
    "driver_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pin_hash" TEXT,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_pins_pkey" PRIMARY KEY ("driver_id")
);

-- CreateTable
CREATE TABLE "driver_enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "platform" TEXT,
    "model" TEXT,
    "app_version" TEXT,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_devices" (
    "driver_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enrolled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "driver_devices_pkey" PRIMARY KEY ("driver_id","device_id")
);

-- CreateTable
CREATE TABLE "passengers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_org_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "employee_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "status" "PassengerStatus" NOT NULL DEFAULT 'active',
    "activated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "passengers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "drivers_tenant_id_idx" ON "drivers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_id_tenant_id_key" ON "drivers"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_tenant_id_employee_number_key" ON "drivers"("tenant_id", "employee_number");

-- CreateIndex
CREATE INDEX "driver_pins_tenant_id_idx" ON "driver_pins"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_pins_driver_id_tenant_id_key" ON "driver_pins"("driver_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_enrollments_code_hash_key" ON "driver_enrollments"("code_hash");

-- CreateIndex
CREATE INDEX "driver_enrollments_tenant_id_idx" ON "driver_enrollments"("tenant_id");

-- CreateIndex
CREATE INDEX "driver_enrollments_driver_id_idx" ON "driver_enrollments"("driver_id");

-- CreateIndex
CREATE INDEX "devices_tenant_id_idx" ON "devices"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_id_tenant_id_key" ON "devices"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "driver_devices_tenant_id_idx" ON "driver_devices"("tenant_id");

-- CreateIndex
CREATE INDEX "driver_devices_device_id_idx" ON "driver_devices"("device_id");

-- CreateIndex
CREATE INDEX "passengers_plant_id_idx" ON "passengers"("plant_id");

-- CreateIndex
CREATE UNIQUE INDEX "passengers_client_org_id_employee_number_key" ON "passengers"("client_org_id", "employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "plants_passenger_activation_code_key" ON "plants"("passenger_activation_code");

-- CreateIndex
CREATE INDEX "sessions_driver_id_idx" ON "sessions"("driver_id");

-- CreateIndex
CREATE INDEX "sessions_passenger_id_idx" ON "sessions"("passenger_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_pins" ADD CONSTRAINT "driver_pins_driver_id_tenant_id_fkey" FOREIGN KEY ("driver_id", "tenant_id") REFERENCES "drivers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_pins" ADD CONSTRAINT "driver_pins_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_enrollments" ADD CONSTRAINT "driver_enrollments_driver_id_tenant_id_fkey" FOREIGN KEY ("driver_id", "tenant_id") REFERENCES "drivers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_enrollments" ADD CONSTRAINT "driver_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_devices" ADD CONSTRAINT "driver_devices_driver_id_tenant_id_fkey" FOREIGN KEY ("driver_id", "tenant_id") REFERENCES "drivers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_devices" ADD CONSTRAINT "driver_devices_device_id_tenant_id_fkey" FOREIGN KEY ("device_id", "tenant_id") REFERENCES "devices"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_devices" ADD CONSTRAINT "driver_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_plant_id_client_org_id_fkey" FOREIGN KEY ("plant_id", "client_org_id") REFERENCES "plants"("id", "client_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Seguridad de las tablas de acceso (ver docs/decisiones/0003)
-- ===========================================================================

-- Cada sesión pertenece a exactamente un tipo de usuario; la del chofer, a un celular.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_principal_check" CHECK (
  (principal = 'user' AND user_id IS NOT NULL AND driver_id IS NULL AND passenger_id IS NULL)
  OR (principal = 'driver' AND driver_id IS NOT NULL AND device_id IS NOT NULL
      AND user_id IS NULL AND passenger_id IS NULL)
  OR (principal = 'passenger' AND passenger_id IS NOT NULL
      AND user_id IS NULL AND driver_id IS NULL)
);

-- updated_at automático en las tablas nuevas.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger tg
        WHERE tg.tgrelid = format('public.%I', c.table_name)::regclass
          AND tg.tgname = c.table_name || '_touch_updated_at'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  END LOOP;
END
$$;

-- Tokens de recuperación: solo el sistema (sin políticas para el rol de la API).
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "password_reset_tokens" FROM shiftlane_app;

-- Choferes, PIN, códigos QR y celulares: aislados por transportista.
ALTER TABLE "drivers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY drivers_isolation ON "drivers" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));

ALTER TABLE "driver_pins" ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_pins_isolation ON "driver_pins" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));

ALTER TABLE "driver_enrollments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_enrollments_isolation ON "driver_enrollments" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));

ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY devices_isolation ON "devices" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));

ALTER TABLE "driver_devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_devices_isolation ON "driver_devices" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));

-- Pasajeros: la planta administra su lista; las transportistas con acuerdo solo la leen.
ALTER TABLE "passengers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY passengers_select ON "passengers" FOR SELECT TO shiftlane_app
  USING (
    client_org_id = (SELECT app.current_client_org_id())
    OR plant_id IN (SELECT app.agreement_plant_ids())
  );
CREATE POLICY passengers_write ON "passengers" FOR ALL TO shiftlane_app
  USING (client_org_id = (SELECT app.current_client_org_id()))
  WITH CHECK (client_org_id = (SELECT app.current_client_org_id()));
