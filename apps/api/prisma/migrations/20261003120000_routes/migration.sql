-- CreateEnum
CREATE TYPE "RouteDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "RouteVersionKind" AS ENUM ('regular', 'temporary');

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TEXT NOT NULL,
    "ends_at" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "shift_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "RouteDirection" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "RouteVersionKind" NOT NULL DEFAULT 'regular',
    "valid_from" DATE NOT NULL,
    "path" geography(LineString, 4326),
    "distance_km" DECIMAL(8,2),
    "duration_minutes" INTEGER,
    "notes" TEXT,
    "based_on_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "route_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_version_id" UUID NOT NULL,
    "stop_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "location" geography(Point, 4326) NOT NULL,
    "radius_meters" INTEGER NOT NULL DEFAULT 80,
    "notes" TEXT,

    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stop_times" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "stop_id" UUID NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "time" TEXT NOT NULL,

    CONSTRAINT "route_stop_times_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "route_version_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temporary_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shifts_id_tenant_id_key" ON "shifts"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenant_id_plant_id_name_key" ON "shifts"("tenant_id", "plant_id", "name");

-- CreateIndex
CREATE INDEX "routes_tenant_id_plant_id_idx" ON "routes"("tenant_id", "plant_id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_id_tenant_id_key" ON "routes"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_tenant_id_code_key" ON "routes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "route_versions_route_id_valid_from_idx" ON "route_versions"("route_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "route_versions_id_tenant_id_key" ON "route_versions"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_versions_route_id_number_key" ON "route_versions"("route_id", "number");

-- CreateIndex
CREATE INDEX "stops_route_version_id_idx" ON "stops"("route_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "stops_id_tenant_id_key" ON "stops"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stops_route_version_id_sequence_key" ON "stops"("route_version_id", "sequence");

-- CreateIndex
CREATE INDEX "route_stop_times_stop_id_idx" ON "route_stop_times"("stop_id");

-- CreateIndex
CREATE INDEX "temporary_changes_route_id_starts_on_idx" ON "temporary_changes"("route_id", "starts_on");

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_route_id_tenant_id_fkey" FOREIGN KEY ("route_id", "tenant_id") REFERENCES "routes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_shift_id_tenant_id_fkey" FOREIGN KEY ("shift_id", "tenant_id") REFERENCES "shifts"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_versions" ADD CONSTRAINT "route_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_versions" ADD CONSTRAINT "route_versions_route_id_tenant_id_fkey" FOREIGN KEY ("route_id", "tenant_id") REFERENCES "routes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stops" ADD CONSTRAINT "stops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stops" ADD CONSTRAINT "stops_route_version_id_tenant_id_fkey" FOREIGN KEY ("route_version_id", "tenant_id") REFERENCES "route_versions"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stop_times" ADD CONSTRAINT "route_stop_times_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stop_times" ADD CONSTRAINT "route_stop_times_stop_id_tenant_id_fkey" FOREIGN KEY ("stop_id", "tenant_id") REFERENCES "stops"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_changes" ADD CONSTRAINT "temporary_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_changes" ADD CONSTRAINT "temporary_changes_route_id_tenant_id_fkey" FOREIGN KEY ("route_id", "tenant_id") REFERENCES "routes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_changes" ADD CONSTRAINT "temporary_changes_route_version_id_tenant_id_fkey" FOREIGN KEY ("route_version_id", "tenant_id") REFERENCES "route_versions"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Seguridad, auditoría e integridad de turnos y rutas (docs/decisiones/0003)
-- ===========================================================================

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_time_check" CHECK (
  starts_at ~ '^([01]\d|2[0-3]):[0-5]\d$' AND ends_at ~ '^([01]\d|2[0-3]):[0-5]\d$'
);
ALTER TABLE "route_versions" ADD CONSTRAINT "route_versions_values_check" CHECK (
  number >= 1 AND (distance_km IS NULL OR distance_km >= 0) AND (duration_minutes IS NULL OR duration_minutes >= 0)
);
ALTER TABLE "stops" ADD CONSTRAINT "stops_values_check" CHECK (sequence >= 1 AND radius_meters BETWEEN 10 AND 1000);
ALTER TABLE "route_stop_times" ADD CONSTRAINT "route_stop_times_check" CHECK (
  time ~ '^([01]\d|2[0-3]):[0-5]\d$' AND weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
);
ALTER TABLE "temporary_changes" ADD CONSTRAINT "temporary_changes_dates_check" CHECK (ends_on >= starts_on);

-- Plantas de la empresa cliente de la sesión (para que la planta vea las rutas que la atienden).
CREATE FUNCTION app.current_org_plant_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT id FROM plants WHERE client_org_id = app.current_client_org_id() $$;
REVOKE ALL ON FUNCTION app.current_org_plant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_org_plant_ids() TO shiftlane_app;

-- La auditoría acepta columnas que no se guardan en el antes/después (por ejemplo, trazos
-- PostGIS grandes). Segundo argumento del disparador.
CREATE OR REPLACE FUNCTION app.audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    ignored text[] := COALESCE(NULLIF(TG_ARGV[0], '')::text[], '{}') || ARRAY['updated_at'];
    omitted text[] := COALESCE(NULLIF(TG_ARGV[1], '')::text[], '{}');
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
    IF TG_OP <> 'INSERT' THEN old_full := to_jsonb(OLD); old_row := old_full - secret_keys - omitted; END IF;
    IF TG_OP <> 'DELETE' THEN new_full := to_jsonb(NEW); new_row := new_full - secret_keys - omitted; END IF;

    IF TG_OP = 'UPDATE' THEN
      SELECT COALESCE(array_agg(key ORDER BY key), '{}') INTO secrets_changed
        FROM unnest(secret_keys) AS key
        WHERE new_full ? key AND (new_full -> key) IS DISTINCT FROM (old_full -> key);
      IF (old_full - secret_keys - ignored) = (new_full - secret_keys - ignored) AND cardinality(secrets_changed) = 0 THEN
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

DROP FUNCTION app.enable_audit(regclass, text[]);
CREATE FUNCTION app.enable_audit(
  target regclass,
  ignored_columns text[] DEFAULT '{}',
  omitted_columns text[] DEFAULT '{}'
) RETURNS void
  LANGUAGE plpgsql
  AS $$
  BEGIN
    EXECUTE format(
      'CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON %s '
      'FOR EACH ROW EXECUTE FUNCTION app.audit_row(%L, %L)',
      target, ignored_columns::text, omitted_columns::text
    );
  END
  $$;
REVOKE ALL ON FUNCTION app.enable_audit(regclass, text[], text[]) FROM PUBLIC;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shifts', 'routes', 'temporary_changes'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  END LOOP;
  FOREACH t IN ARRAY ARRAY['shifts', 'routes', 'route_versions', 'stops', 'route_stop_times', 'temporary_changes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

SELECT app.enable_audit('shifts');
SELECT app.enable_audit('routes');
SELECT app.enable_audit('route_versions', '{}', ARRAY['path']);
SELECT app.enable_audit('temporary_changes');
-- stops y route_stop_times son parte de la versión (inmutable una vez vigente); se audita la versión.

-- Turnos y rutas: la transportista las administra para plantas que atiende; la planta ve las
-- de las transportistas con las que tiene acuerdo (nunca las de otra transportista).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shifts', 'routes'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO shiftlane_app
         USING (
           tenant_id = (SELECT app.current_tenant_id())
           OR (tenant_id IN (SELECT app.agreement_tenant_ids())
               AND plant_id IN (SELECT app.current_org_plant_ids()))
         )',
      t || '_select', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO shiftlane_app
         WITH CHECK (tenant_id = (SELECT app.current_tenant_id()) AND plant_id IN (SELECT app.agreement_plant_ids()))',
      t || '_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO shiftlane_app
         USING (tenant_id = (SELECT app.current_tenant_id()))
         WITH CHECK (tenant_id = (SELECT app.current_tenant_id()) AND plant_id IN (SELECT app.agreement_plant_ids()))',
      t || '_update', t
    );
  END LOOP;
END
$$;
REVOKE DELETE ON TABLE "shifts", "routes" FROM shiftlane_app;

CREATE POLICY route_versions_select ON "route_versions" FOR SELECT TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()) OR route_id IN (SELECT r.id FROM routes r));
CREATE POLICY stops_select ON "stops" FOR SELECT TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()) OR route_version_id IN (SELECT v.id FROM route_versions v));
CREATE POLICY route_stop_times_select ON "route_stop_times" FOR SELECT TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()) OR stop_id IN (SELECT s.id FROM stops s));
CREATE POLICY temporary_changes_select ON "temporary_changes" FOR SELECT TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()) OR route_id IN (SELECT r.id FROM routes r));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['route_versions', 'stops', 'route_stop_times', 'temporary_changes'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO shiftlane_app WITH CHECK (tenant_id = (SELECT app.current_tenant_id()))',
      t || '_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO shiftlane_app
         USING (tenant_id = (SELECT app.current_tenant_id()))
         WITH CHECK (tenant_id = (SELECT app.current_tenant_id()))',
      t || '_update', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO shiftlane_app USING (tenant_id = (SELECT app.current_tenant_id()))',
      t || '_delete', t
    );
  END LOOP;
END
$$;
