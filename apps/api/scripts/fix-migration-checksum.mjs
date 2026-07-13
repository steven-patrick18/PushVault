/**
 * One-off: the 20260713184500_rls migration file was corrected in place
 * (NULLIF guard) after being applied; the live DB already matches it.
 * Re-align Prisma's stored checksum so migrate dev doesn't demand a reset.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const name = "20260713184500_rls";
const sql = readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url));
const checksum = createHash("sha256").update(sql).digest("hex");

const prisma = new PrismaClient();
const count = await prisma.$executeRawUnsafe(
  `UPDATE _prisma_migrations SET checksum = $1 WHERE migration_name = $2`,
  checksum,
  name,
);
console.log(`updated ${count} row(s) with checksum ${checksum.slice(0, 12)}…`);
await prisma.$disconnect();
