-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "call_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "call_strategy" TEXT NOT NULL DEFAULT 'round_robin';
