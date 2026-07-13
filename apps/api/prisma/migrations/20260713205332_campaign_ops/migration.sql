-- AlterEnum
ALTER TYPE "campaign_status" ADD VALUE 'paused';

-- AlterEnum
ALTER TYPE "user_role" ADD VALUE 'operator';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "mix_strategy" TEXT NOT NULL DEFAULT 'mixed',
ADD COLUMN     "segment_ids" UUID[] DEFAULT ARRAY[]::UUID[];
