/**
 * Aligns the restricted RLS role's password with PV_APP_PASSWORD so the
 * APP_DATABASE_URL connection works in production (the migration creates
 * pv_app with a dev default). Runs on every container start — idempotent.
 */
import { PrismaClient } from "@prisma/client";

const password = process.env.PV_APP_PASSWORD;
if (!password) {
  console.log("[set-app-password] PV_APP_PASSWORD not set — skipping (dev mode)");
  process.exit(0);
}

const prisma = new PrismaClient();
const escaped = password.replace(/'/g, "''");
await prisma.$executeRawUnsafe(`ALTER ROLE pv_app WITH PASSWORD '${escaped}'`);
await prisma.$disconnect();
console.log("[set-app-password] pv_app password aligned");
