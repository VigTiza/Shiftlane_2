-- AlterTable
ALTER TABLE "route_versions" ADD COLUMN     "routing_source" TEXT;

-- CreateTable
CREATE TABLE "routing_cache" (
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_cache_pkey" PRIMARY KEY ("key")
);


-- Caché de rutas por calles: solo el sistema (RLS activa sin políticas para el rol de la API).
ALTER TABLE "routing_cache" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "routing_cache" FROM shiftlane_app;
ALTER TABLE "route_versions" ADD CONSTRAINT "route_versions_routing_source_check"
  CHECK (routing_source IS NULL OR routing_source IN ('osrm', 'straight_line', 'manual'));
