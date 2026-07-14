-- AlterTable
ALTER TABLE "users" ADD COLUMN     "allowed_pages" TEXT[] DEFAULT ARRAY[]::TEXT[];
