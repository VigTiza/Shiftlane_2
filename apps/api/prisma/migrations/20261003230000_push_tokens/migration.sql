-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "push_token" TEXT,
ADD COLUMN     "push_token_updated_at" TIMESTAMPTZ(3);

-- Un token por celular; se reemplaza al renovarse. Los cambios de token no van a la bitácora
-- (se renuevan solos y no son decisiones de nadie).
DROP TRIGGER audit_row ON "devices";
SELECT app.enable_audit('devices', ARRAY['last_seen_at', 'last_sync_at', 'clock_offset_ms', 'push_token', 'push_token_updated_at', 'updated_at']);
