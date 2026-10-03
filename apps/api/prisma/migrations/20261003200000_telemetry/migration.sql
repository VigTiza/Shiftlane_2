-- ===========================================================================
-- Historial de posiciones GPS (F05-P03)
-- ===========================================================================
-- Vive en el esquema telemetry, fuera de Prisma: es una tabla particionada por día que la API
-- lee y escribe con SQL. Solo se guardan posiciones durante los viajes.

CREATE SCHEMA telemetry;
GRANT USAGE ON SCHEMA telemetry TO shiftlane_app;

CREATE TABLE telemetry.trip_positions (
  tenant_id   uuid NOT NULL,
  trip_id     uuid NOT NULL,
  driver_id   uuid,
  device_id   uuid,
  -- Hora corregida con el desfase del reloj del celular, y hora de llegada al servidor.
  recorded_at timestamptz(3) NOT NULL,
  received_at timestamptz(3) NOT NULL DEFAULT now(),
  lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  speed_kmh   real CHECK (speed_kmh IS NULL OR speed_kmh BETWEEN 0 AND 300),
  heading     real CHECK (heading IS NULL OR heading BETWEEN 0 AND 360),
  accuracy_m  real CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  battery     smallint CHECK (battery IS NULL OR battery BETWEEN 0 AND 100),
  -- Un punto por viaje e instante: los reenvíos no se duplican.
  PRIMARY KEY (trip_id, recorded_at),
  FOREIGN KEY (trip_id, tenant_id) REFERENCES public.trips (id, tenant_id) ON DELETE RESTRICT
) PARTITION BY RANGE (recorded_at);

CREATE INDEX trip_positions_tenant_recorded_idx ON telemetry.trip_positions (tenant_id, recorded_at);

ALTER TABLE telemetry.trip_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY trip_positions_isolation ON telemetry.trip_positions FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
-- La planta ve el recorrido de los viajes de sus transportistas (evidencia).
CREATE POLICY trip_positions_plant_select ON telemetry.trip_positions FOR SELECT TO shiftlane_app
  USING (trip_id IN (
    SELECT id FROM public.trips
    WHERE plant_id IN (SELECT app.current_org_plant_ids())
      AND tenant_id IN (SELECT app.agreement_tenant_ids())
  ));
-- El historial no se edita ni se borra desde la API.
GRANT SELECT, INSERT ON telemetry.trip_positions TO shiftlane_app;

-- Crea la partición de un día (UTC) si no existe. La usan la ingesta (para datos que llegan
-- tarde) y la tarea diaria (crea los próximos días por adelantado).
CREATE FUNCTION app.ensure_trip_positions_partition(day date) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    partition_name text := format('trip_positions_p%s', to_char(day, 'YYYYMMDD'));
    starts timestamptz := (day::timestamp AT TIME ZONE 'UTC');
    ends timestamptz := ((day + 1)::timestamp AT TIME ZONE 'UTC');
  BEGIN
    IF to_regclass(format('telemetry.%I', partition_name)) IS NOT NULL THEN
      RETURN;
    END IF;
    BEGIN
      EXECUTE format(
        'CREATE TABLE telemetry.%I PARTITION OF telemetry.trip_positions FOR VALUES FROM (%L) TO (%L)',
        partition_name, starts, ends
      );
      -- Solo se accede por la tabla principal (con su RLS), nunca a la partición directo.
      EXECUTE format('ALTER TABLE telemetry.%I ENABLE ROW LEVEL SECURITY', partition_name);
      EXECUTE format('REVOKE ALL ON telemetry.%I FROM shiftlane_app', partition_name);
    EXCEPTION WHEN duplicate_table THEN
      -- Otra conexión la creó al mismo tiempo.
      NULL;
    END;
  END
  $$;
REVOKE ALL ON FUNCTION app.ensure_trip_positions_partition(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ensure_trip_positions_partition(date) TO shiftlane_app;
