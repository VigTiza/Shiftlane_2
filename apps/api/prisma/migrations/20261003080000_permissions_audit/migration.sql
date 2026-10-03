-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('grant', 'revoke');

-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_client_org_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_tenant_id_fkey";

-- AlterTable
ALTER TABLE "audit_log" RENAME COLUMN "actor_user_id" TO "actor_id";
ALTER TABLE "audit_log" ADD COLUMN "actor_type" TEXT NOT NULL DEFAULT 'system';
UPDATE "audit_log" SET "actor_type" = 'user' WHERE "actor_id" IS NOT NULL;

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "effect" "PermissionEffect" NOT NULL,
    "tenant_id" UUID,
    "client_org_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_permission_overrides_tenant_id_idx" ON "user_permission_overrides"("tenant_id");

-- CreateIndex
CREATE INDEX "user_permission_overrides_client_org_id_idx" ON "user_permission_overrides"("client_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_overrides_user_id_permission_key" ON "user_permission_overrides"("user_id", "permission");

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Permisos por usuario y auditoría automática (ver docs/api.md)
-- ===========================================================================

-- Los ajustes de permisos copian el ámbito del usuario, como user_roles.
CREATE FUNCTION app.copy_user_scope() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    user_kind text;
  BEGIN
    SELECT kind::text, tenant_id, client_org_id
      INTO user_kind, NEW.tenant_id, NEW.client_org_id
      FROM users WHERE id = NEW.user_id;
    IF user_kind IS NULL THEN
      RAISE EXCEPTION 'El usuario no existe o no es visible.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER user_permission_overrides_copy_scope
  BEFORE INSERT OR UPDATE ON "user_permission_overrides"
  FOR EACH ROW EXECUTE FUNCTION app.copy_user_scope();

ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_check"
  CHECK (permission ~ '^[a-z_]+\.[a-z_]+$');

ALTER TABLE "user_permission_overrides" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_permission_overrides_isolation ON "user_permission_overrides" FOR ALL TO shiftlane_app
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  )
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    OR client_org_id = (SELECT app.current_client_org_id())
  );

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------

-- Registra creación, edición y borrado de una fila. Recibe como argumento las columnas que
-- no cuentan como cambio (por ejemplo, la fecha del último acceso). Nunca guarda secretos:
-- si cambia uno, solo anota su nombre en "_secretos_cambiados".
CREATE FUNCTION app.audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    ignored text[] := COALESCE(NULLIF(TG_ARGV[0], '')::text[], '{}') || ARRAY['updated_at'];
    secret_keys text[] := ARRAY[
      'password_hash', 'totp_secret', 'secret_hash', 'pin_hash', 'code_hash', 'token_hash',
      'refresh_token_hash'
    ];
    old_full jsonb;
    new_full jsonb;
    old_row jsonb;
    new_row jsonb;
    row_data jsonb;
    secrets_changed text[] := '{}';
    v_action text;
    v_tenant uuid;
    v_org uuid;
  BEGIN
    IF TG_OP <> 'INSERT' THEN old_full := to_jsonb(OLD); old_row := old_full - secret_keys; END IF;
    IF TG_OP <> 'DELETE' THEN new_full := to_jsonb(NEW); new_row := new_full - secret_keys; END IF;

    IF TG_OP = 'UPDATE' THEN
      SELECT COALESCE(array_agg(key ORDER BY key), '{}') INTO secrets_changed
        FROM unnest(secret_keys) AS key
        WHERE new_full ? key AND (new_full -> key) IS DISTINCT FROM (old_full -> key);
      IF (old_row - ignored) = (new_row - ignored) AND cardinality(secrets_changed) = 0 THEN
        RETURN NULL;
      END IF;
      IF cardinality(secrets_changed) > 0 THEN
        new_row := new_row || jsonb_build_object('_secretos_cambiados', to_jsonb(secrets_changed));
      END IF;
    END IF;

    row_data := COALESCE(new_row, old_row);
    v_action := CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
    v_tenant := CASE TG_TABLE_NAME
      WHEN 'tenants' THEN (row_data ->> 'id')::uuid
      ELSE COALESCE((row_data ->> 'tenant_id')::uuid, app.current_tenant_id())
    END;
    v_org := CASE TG_TABLE_NAME
      WHEN 'client_orgs' THEN (row_data ->> 'id')::uuid
      ELSE COALESCE((row_data ->> 'client_org_id')::uuid, app.current_client_org_id())
    END;

    INSERT INTO audit_log (
      tenant_id, client_org_id, actor_type, actor_id, action, entity_type, entity_id,
      before, after, request_id, ip
    ) VALUES (
      v_tenant,
      v_org,
      COALESCE(NULLIF(current_setting('app.actor_type', true), ''), 'system'),
      NULLIF(current_setting('app.actor_id', true), '')::uuid,
      v_action,
      TG_TABLE_NAME,
      COALESCE(row_data ->> 'id', row_data ->> 'driver_id', row_data ->> 'user_id'),
      old_row,
      new_row,
      NULLIF(current_setting('app.request_id', true), ''),
      NULLIF(current_setting('app.ip', true), '')
    );
    RETURN NULL;
  END
  $$;

REVOKE ALL ON FUNCTION app.audit_row() FROM PUBLIC;

-- Activa la auditoría en una tabla. Uso en migraciones futuras:
--   SELECT app.enable_audit('vehicles');
--   SELECT app.enable_audit('trips', ARRAY['last_position_at']);
CREATE FUNCTION app.enable_audit(target regclass, ignored_columns text[] DEFAULT '{}')
  RETURNS void
  LANGUAGE plpgsql
  AS $$
  BEGIN
    EXECUTE format(
      'CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON %s '
      'FOR EACH ROW EXECUTE FUNCTION app.audit_row(%L)',
      target, ignored_columns::text
    );
  END
  $$;

REVOKE ALL ON FUNCTION app.enable_audit(regclass, text[]) FROM PUBLIC;

SELECT app.enable_audit('tenants');
SELECT app.enable_audit('users', ARRAY['last_login_at', 'failed_login_count', 'locked_until', 'totp_last_step']);
SELECT app.enable_audit('user_roles');
SELECT app.enable_audit('user_permission_overrides');
SELECT app.enable_audit('client_orgs');
SELECT app.enable_audit('plants');
SELECT app.enable_audit('service_agreements');
SELECT app.enable_audit('drivers');
SELECT app.enable_audit('driver_pins', ARRAY['failed_attempts', 'locked_until']);
SELECT app.enable_audit('driver_enrollments');
SELECT app.enable_audit('devices', ARRAY['last_seen_at']);
SELECT app.enable_audit('driver_devices');
SELECT app.enable_audit('passengers');
