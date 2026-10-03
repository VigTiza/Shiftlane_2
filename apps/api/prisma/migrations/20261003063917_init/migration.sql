-- PostGIS para datos geográficos (paradas, plantas, recorridos).
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('carrier', 'plant', 'platform');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('invited', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('carrier', 'plant', 'platform');

-- CreateEnum
CREATE TYPE "ServiceAgreementStatus" AS ENUM ('pending', 'active', 'suspended', 'ended');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "rfc" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "UserKind" NOT NULL,
    "tenant_id" UUID,
    "client_org_id" UUID,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "RoleScope" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "tenant_id" UUID,
    "client_org_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "tenant_id" UUID,
    "client_org_id" UUID,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID,
    "client_org_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_orgs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "rfc" TEXT,
    "created_by_tenant_id" UUID,
    "claimed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "client_orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "location" geography(Point, 4326),
    "timezone" TEXT NOT NULL DEFAULT 'America/Ciudad_Juarez',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "plants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_agreements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_org_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "status" "ServiceAgreementStatus" NOT NULL DEFAULT 'active',
    "starts_on" DATE,
    "ends_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "service_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_client_org_id_idx" ON "users"("client_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "user_roles_tenant_id_idx" ON "user_roles"("tenant_id");

-- CreateIndex
CREATE INDEX "user_roles_client_org_id_idx" ON "user_roles"("client_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_client_org_id_created_at_idx" ON "audit_log"("client_org_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "client_orgs_created_by_tenant_id_idx" ON "client_orgs"("created_by_tenant_id");

-- CreateIndex
CREATE INDEX "plants_client_org_id_idx" ON "plants"("client_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "plants_id_client_org_id_key" ON "plants"("id", "client_org_id");

-- CreateIndex
CREATE INDEX "service_agreements_client_org_id_idx" ON "service_agreements"("client_org_id");

-- CreateIndex
CREATE INDEX "service_agreements_plant_id_idx" ON "service_agreements"("plant_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_agreements_tenant_id_plant_id_key" ON "service_agreements"("tenant_id", "plant_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_orgs" ADD CONSTRAINT "client_orgs_created_by_tenant_id_fkey" FOREIGN KEY ("created_by_tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plants" ADD CONSTRAINT "plants_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_agreements" ADD CONSTRAINT "service_agreements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_agreements" ADD CONSTRAINT "service_agreements_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_agreements" ADD CONSTRAINT "service_agreements_plant_id_client_org_id_fkey" FOREIGN KEY ("plant_id", "client_org_id") REFERENCES "plants"("id", "client_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Seguridad multiempresa (ver docs/decisiones/0003-multiempresa-y-seguridad-por-filas.md)
-- ===========================================================================

-- Rol con el que corre la API. No puede saltarse la seguridad por filas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shiftlane_app') THEN
    CREATE ROLE shiftlane_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
GRANT shiftlane_app TO CURRENT_USER;

-- Funciones de contexto: la API fija estos valores con set_config(..., true) al inicio de
-- cada transacción (equivale a SET LOCAL), así que se limpian solos al terminar.
CREATE SCHEMA app;

CREATE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app.current_client_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.client_org_id', true), '')::uuid $$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- Consultas que cruzan tablas dentro de las políticas. Son SECURITY DEFINER para evitar la
-- recursión entre políticas; solo devuelven identificadores del contexto actual.
CREATE FUNCTION app.agreement_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT tenant_id FROM service_agreements
    WHERE client_org_id = app.current_client_org_id() AND deleted_at IS NULL
  $$;

CREATE FUNCTION app.agreement_client_org_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT client_org_id FROM service_agreements
    WHERE tenant_id = app.current_tenant_id() AND deleted_at IS NULL
  $$;

CREATE FUNCTION app.agreement_plant_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT plant_id FROM service_agreements
    WHERE tenant_id = app.current_tenant_id() AND deleted_at IS NULL
  $$;

-- Empresas cliente que la transportista registró y que aún no tienen usuarios propios.
CREATE FUNCTION app.managed_client_org_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT id FROM client_orgs
    WHERE created_by_tenant_id = app.current_tenant_id() AND claimed_at IS NULL
  $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Integridad
-- ---------------------------------------------------------------------------

ALTER TABLE "users" ADD CONSTRAINT "users_scope_check" CHECK (
  (kind = 'carrier' AND tenant_id IS NOT NULL AND client_org_id IS NULL)
  OR (kind = 'plant' AND client_org_id IS NOT NULL AND tenant_id IS NULL)
  OR (kind = 'platform' AND tenant_id IS NULL AND client_org_id IS NULL)
);
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK (email = lower(email));

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at := now();
    RETURN NEW;
  END
  $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  END LOOP;
END
$$;

-- Los roles se asignan solo a usuarios visibles y del mismo ámbito que el rol; el ámbito
-- (tenant o empresa cliente) se copia del usuario para que nadie lo pueda falsear.
CREATE FUNCTION app.user_roles_fill_scope() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    user_kind text;
    role_scope text;
  BEGIN
    SELECT kind::text, tenant_id, client_org_id
      INTO user_kind, NEW.tenant_id, NEW.client_org_id
      FROM users WHERE id = NEW.user_id;
    IF user_kind IS NULL THEN
      RAISE EXCEPTION 'El usuario no existe o no es visible.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT scope::text INTO role_scope FROM roles WHERE id = NEW.role_id;
    IF role_scope IS DISTINCT FROM user_kind THEN
      RAISE EXCEPTION 'El rol no corresponde al tipo de usuario.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER user_roles_fill_scope BEFORE INSERT OR UPDATE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION app.user_roles_fill_scope();

-- Columnas que la API no puede cambiar después de crear la fila.
CREATE FUNCTION app.service_agreements_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.client_org_id IS DISTINCT FROM OLD.client_org_id
      OR NEW.plant_id IS DISTINCT FROM OLD.plant_id THEN
      RAISE EXCEPTION 'No se puede cambiar la transportista ni la planta de un acuerdo.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER service_agreements_immutable BEFORE UPDATE ON "service_agreements"
  FOR EACH ROW EXECUTE FUNCTION app.service_agreements_immutable();

CREATE FUNCTION app.client_orgs_protect_ownership() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF current_user = 'shiftlane_app' AND (
      NEW.created_by_tenant_id IS DISTINCT FROM OLD.created_by_tenant_id
      OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
    ) THEN
      RAISE EXCEPTION 'No se puede cambiar quién administra la empresa cliente.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER client_orgs_protect_ownership BEFORE UPDATE ON "client_orgs"
  FOR EACH ROW EXECUTE FUNCTION app.client_orgs_protect_ownership();

-- ---------------------------------------------------------------------------
-- Permisos del rol de la API
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public, app TO shiftlane_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO shiftlane_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shiftlane_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shiftlane_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shiftlane_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO shiftlane_app;

REVOKE ALL ON TABLE "_prisma_migrations" FROM shiftlane_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE spatial_ref_sys FROM shiftlane_app;
-- La bitácora es inmutable y el catálogo de roles y las cuentas los administra la plataforma.
REVOKE UPDATE, DELETE ON TABLE "audit_log" FROM shiftlane_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE "roles" FROM shiftlane_app;
REVOKE INSERT, DELETE ON TABLE "tenants" FROM shiftlane_app;
-- Empresas cliente, plantas y acuerdos se dan de baja con deleted_at o con su estado.
REVOKE DELETE ON TABLE "client_orgs", "plants", "service_agreements" FROM shiftlane_app;

-- ---------------------------------------------------------------------------
-- Seguridad por filas
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_select ON "tenants" FOR SELECT TO shiftlane_app
  USING (
    id = (SELECT app.current_tenant_id())
    OR id IN (SELECT app.agreement_tenant_ids())
  );
CREATE POLICY tenants_update ON "tenants" FOR UPDATE TO shiftlane_app
  USING (id = (SELECT app.current_tenant_id()))
  WITH CHECK (id = (SELECT app.current_tenant_id()));

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON "users" FOR ALL TO shiftlane_app
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  )
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  );

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_read ON "roles" FOR SELECT TO shiftlane_app USING (true);

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_isolation ON "user_roles" FOR ALL TO shiftlane_app
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  )
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  );

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_own ON "sessions" FOR ALL TO shiftlane_app
  USING (user_id = (SELECT app.current_user_id()))
  WITH CHECK (user_id = (SELECT app.current_user_id()));

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_read ON "audit_log" FOR SELECT TO shiftlane_app
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  );
CREATE POLICY audit_log_insert ON "audit_log" FOR INSERT TO shiftlane_app
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  );

ALTER TABLE "client_orgs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_orgs_select ON "client_orgs" FOR SELECT TO shiftlane_app
  USING (
    id = (SELECT app.current_client_org_id())
    OR (created_by_tenant_id = (SELECT app.current_tenant_id()) AND claimed_at IS NULL)
    OR id IN (SELECT app.agreement_client_org_ids())
  );
CREATE POLICY client_orgs_insert ON "client_orgs" FOR INSERT TO shiftlane_app
  WITH CHECK (created_by_tenant_id = (SELECT app.current_tenant_id()) AND claimed_at IS NULL);
CREATE POLICY client_orgs_update ON "client_orgs" FOR UPDATE TO shiftlane_app
  USING (
    id = (SELECT app.current_client_org_id())
    OR (created_by_tenant_id = (SELECT app.current_tenant_id()) AND claimed_at IS NULL)
  )
  WITH CHECK (
    id = (SELECT app.current_client_org_id())
    OR (created_by_tenant_id = (SELECT app.current_tenant_id()) AND claimed_at IS NULL)
  );

ALTER TABLE "plants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY plants_select ON "plants" FOR SELECT TO shiftlane_app
  USING (
    client_org_id = (SELECT app.current_client_org_id())
    OR client_org_id IN (SELECT app.managed_client_org_ids())
    OR id IN (SELECT app.agreement_plant_ids())
  );
CREATE POLICY plants_insert ON "plants" FOR INSERT TO shiftlane_app
  WITH CHECK (
    client_org_id = (SELECT app.current_client_org_id())
    OR client_org_id IN (SELECT app.managed_client_org_ids())
  );
CREATE POLICY plants_update ON "plants" FOR UPDATE TO shiftlane_app
  USING (
    client_org_id = (SELECT app.current_client_org_id())
    OR client_org_id IN (SELECT app.managed_client_org_ids())
  )
  WITH CHECK (
    client_org_id = (SELECT app.current_client_org_id())
    OR client_org_id IN (SELECT app.managed_client_org_ids())
  );

ALTER TABLE "service_agreements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_agreements_select ON "service_agreements" FOR SELECT TO shiftlane_app
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  );
-- Una transportista solo crea acuerdos con plantas que ella administra. Con una empresa
-- cliente que ya tiene usuarios propios, el acuerdo se crea por invitación (F02-P02).
CREATE POLICY service_agreements_insert ON "service_agreements" FOR INSERT TO shiftlane_app
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    AND client_org_id IN (SELECT app.managed_client_org_ids())
  );
CREATE POLICY service_agreements_update ON "service_agreements" FOR UPDATE TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));

-- ---------------------------------------------------------------------------
-- Catálogo fijo de roles
-- ---------------------------------------------------------------------------

INSERT INTO "roles" (key, name, scope, description) VALUES
  ('owner', 'Dueño', 'carrier', 'Todo: configuración, usuarios, clientes, contratos, operación y facturación.'),
  ('manager', 'Gerente', 'carrier', 'Operación, clientes, reportes y atención de escalamientos.'),
  ('planner', 'Programador de rutas', 'carrier', 'Rutas, paradas, horarios y programación de viajes.'),
  ('dispatcher', 'Despachador', 'carrier', 'Asignación, monitoreo, alertas, incidentes y alta de choferes.'),
  ('billing', 'Administración', 'carrier', 'Conciliación, prefacturas, facturas y cobranza.'),
  ('maintenance', 'Mantenimiento', 'carrier', 'Unidades, servicios, combustible y documentos de unidades.'),
  ('driver', 'Chofer', 'carrier', 'Sus viajes, checklist, escaneo de pasajeros e incidentes.'),
  ('plant_logistics', 'Logística de planta', 'plant', 'Tablero en vivo, evidencia, solicitudes y prefacturas.'),
  ('plant_hr', 'Recursos humanos de planta', 'plant', 'Empleados, asistencia transportada y quejas.'),
  ('passenger', 'Pasajero', 'plant', 'Su ruta, ubicación del camión, credencial y avisos.'),
  ('platform_admin', 'Administrador de plataforma', 'platform', 'Cuentas, suscripciones, salud del sistema y soporte.');
