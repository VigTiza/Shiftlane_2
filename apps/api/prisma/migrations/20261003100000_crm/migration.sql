-- CreateEnum
CREATE TYPE "ContactArea" AS ENUM ('logistics', 'hr', 'security', 'purchasing', 'finance', 'management', 'other');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'active', 'ended');

-- CreateEnum
CREATE TYPE "RateBasis" AS ENUM ('per_trip', 'per_route', 'per_km', 'per_vehicle', 'per_passenger');

-- CreateEnum
CREATE TYPE "PenaltyType" AS ENUM ('late_arrival', 'missed_trip', 'incomplete_trip', 'other');

-- CreateEnum
CREATE TYPE "PenaltyAmountType" AS ENUM ('fixed', 'percent');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('contacted', 'quoted', 'pilot', 'won', 'lost');

-- CreateTable
CREATE TABLE "plant_gates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_org_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "qr_code" TEXT NOT NULL,
    "location" geography(Point, 4326),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "plant_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_org_id" UUID NOT NULL,
    "plant_id" UUID,
    "full_name" TEXT NOT NULL,
    "area" "ContactArea" NOT NULL DEFAULT 'other',
    "position" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_org_id" UUID NOT NULL,
    "plant_id" UUID,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'draft',
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "name" TEXT,
    "basis" "RateBasis" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "route_id" UUID,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "start_time" TEXT,
    "end_time" TEXT,
    "holidays" BOOLEAN,
    "min_capacity" INTEGER,
    "max_capacity" INTEGER,
    "valid_from" DATE,
    "valid_to" DATE,
    "minimum_charge" DECIMAL(12,2),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "type" "PenaltyType" NOT NULL,
    "description" TEXT,
    "amount_type" "PenaltyAmountType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "grace_minutes" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "stage" "LeadStage" NOT NULL DEFAULT 'contacted',
    "estimated_vehicles" INTEGER,
    "estimated_monthly_value" DECIMAL(12,2),
    "lost_reason" TEXT,
    "notes" TEXT,
    "converted_client_org_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_org_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_user_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plant_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plant_gates_qr_code_key" ON "plant_gates"("qr_code");

-- CreateIndex
CREATE INDEX "plant_gates_plant_id_idx" ON "plant_gates"("plant_id");

-- CreateIndex
CREATE INDEX "client_contacts_tenant_id_client_org_id_idx" ON "client_contacts"("tenant_id", "client_org_id");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_client_org_id_idx" ON "contracts"("tenant_id", "client_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_id_tenant_id_key" ON "contracts"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "rates_contract_id_idx" ON "rates"("contract_id");

-- CreateIndex
CREATE INDEX "penalties_contract_id_idx" ON "penalties"("contract_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_stage_idx" ON "leads"("tenant_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "plant_invitations_token_hash_key" ON "plant_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "plant_invitations_tenant_id_idx" ON "plant_invitations"("tenant_id");

-- CreateIndex
CREATE INDEX "plant_invitations_plant_id_idx" ON "plant_invitations"("plant_id");

-- AddForeignKey
ALTER TABLE "plant_gates" ADD CONSTRAINT "plant_gates_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_gates" ADD CONSTRAINT "plant_gates_plant_id_client_org_id_fkey" FOREIGN KEY ("plant_id", "client_org_id") REFERENCES "plants"("id", "client_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_plant_id_client_org_id_fkey" FOREIGN KEY ("plant_id", "client_org_id") REFERENCES "plants"("id", "client_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_plant_id_client_org_id_fkey" FOREIGN KEY ("plant_id", "client_org_id") REFERENCES "plants"("id", "client_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_contract_id_tenant_id_fkey" FOREIGN KEY ("contract_id", "tenant_id") REFERENCES "contracts"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_contract_id_tenant_id_fkey" FOREIGN KEY ("contract_id", "tenant_id") REFERENCES "contracts"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_invitations" ADD CONSTRAINT "plant_invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_invitations" ADD CONSTRAINT "plant_invitations_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_invitations" ADD CONSTRAINT "plant_invitations_plant_id_client_org_id_fkey" FOREIGN KEY ("plant_id", "client_org_id") REFERENCES "plants"("id", "client_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Seguridad, auditoría e integridad del CRM (docs/decisiones/0003)
-- ===========================================================================

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_dates_check" CHECK (ends_on IS NULL OR ends_on >= starts_on);
ALTER TABLE "rates" ADD CONSTRAINT "rates_amount_check" CHECK (amount >= 0 AND (minimum_charge IS NULL OR minimum_charge >= 0));
ALTER TABLE "rates" ADD CONSTRAINT "rates_time_check" CHECK (
  (start_time IS NULL AND end_time IS NULL)
  OR (start_time ~ '^([01]\d|2[0-3]):[0-5]\d$' AND end_time ~ '^([01]\d|2[0-3]):[0-5]\d$')
);
ALTER TABLE "rates" ADD CONSTRAINT "rates_weekdays_check" CHECK (weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);
ALTER TABLE "rates" ADD CONSTRAINT "rates_capacity_check" CHECK (
  min_capacity IS NULL OR max_capacity IS NULL OR min_capacity <= max_capacity
);
ALTER TABLE "rates" ADD CONSTRAINT "rates_validity_check" CHECK (
  valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to
);
ALTER TABLE "rates" ADD CONSTRAINT "rates_route_check" CHECK (basis <> 'per_route' OR route_id IS NOT NULL);
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_amount_check" CHECK (
  amount >= 0 AND (amount_type <> 'percent' OR amount <= 100)
);
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_grace_check" CHECK (grace_minutes IS NULL OR grace_minutes >= 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_values_check" CHECK (
  (estimated_vehicles IS NULL OR estimated_vehicles >= 0)
  AND (estimated_monthly_value IS NULL OR estimated_monthly_value >= 0)
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['plant_gates', 'client_contacts', 'contracts', 'rates', 'penalties', 'leads'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  END LOOP;
  FOREACH t IN ARRAY ARRAY['plant_gates', 'client_contacts', 'contracts', 'rates', 'penalties', 'leads', 'plant_invitations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    PERFORM app.enable_audit(t::regclass);
  END LOOP;
END
$$;

-- Puertas: las administra la planta (o la transportista mientras administra a la empresa);
-- las ven también las transportistas con acuerdo, porque el chofer escanea su QR.
CREATE POLICY plant_gates_select ON "plant_gates" FOR SELECT TO shiftlane_app
  USING (
    client_org_id = (SELECT app.current_client_org_id())
    OR client_org_id IN (SELECT app.managed_client_org_ids())
    OR plant_id IN (SELECT app.agreement_plant_ids())
  );
CREATE POLICY plant_gates_insert ON "plant_gates" FOR INSERT TO shiftlane_app
  WITH CHECK (
    client_org_id = (SELECT app.current_client_org_id())
    OR client_org_id IN (SELECT app.managed_client_org_ids())
  );
CREATE POLICY plant_gates_update ON "plant_gates" FOR UPDATE TO shiftlane_app
  USING (
    client_org_id = (SELECT app.current_client_org_id())
    OR client_org_id IN (SELECT app.managed_client_org_ids())
  )
  WITH CHECK (
    client_org_id = (SELECT app.current_client_org_id())
    OR client_org_id IN (SELECT app.managed_client_org_ids())
  );
REVOKE DELETE ON TABLE "plant_gates" FROM shiftlane_app;

-- Contactos y contratos: de la transportista, y solo de empresas que atiende o administra.
CREATE POLICY client_contacts_isolation ON "client_contacts" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    AND (
      client_org_id IN (SELECT app.agreement_client_org_ids())
      OR client_org_id IN (SELECT app.managed_client_org_ids())
    )
  );
CREATE POLICY contracts_isolation ON "contracts" FOR ALL TO shiftlane_app
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    AND (
      client_org_id IN (SELECT app.agreement_client_org_ids())
      OR client_org_id IN (SELECT app.managed_client_org_ids())
    )
  );

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rates', 'penalties', 'leads', 'plant_invitations'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO shiftlane_app
         USING (tenant_id = (SELECT app.current_tenant_id()))
         WITH CHECK (tenant_id = (SELECT app.current_tenant_id()))',
      t || '_isolation', t
    );
  END LOOP;
END
$$;
