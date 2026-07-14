-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "ads_check" JSONB;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "integrations" JSONB;
