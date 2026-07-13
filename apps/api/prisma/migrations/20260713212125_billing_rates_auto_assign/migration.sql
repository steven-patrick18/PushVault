-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "auto_assign" JSONB;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "billing_rates" JSONB;
