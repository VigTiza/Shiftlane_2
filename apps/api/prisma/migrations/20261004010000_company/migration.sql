-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "logo_key" TEXT,
ADD COLUMN     "onboarding" JSONB NOT NULL DEFAULT '{}';

