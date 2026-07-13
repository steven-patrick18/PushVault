/**
 * Production seed: creates the tenant + first admin from ADMIN_EMAIL /
 * ADMIN_PASSWORD. Safe to re-run — does nothing if any user exists.
 *   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec api node scripts/seed-prod.mjs
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

// must match apps/api/src/common/crypto.ts
function hashSecret(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 8) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (min 8 chars) in deploy/.env");
  process.exit(1);
}

const prisma = new PrismaClient();
const existing = await prisma.user.count();
if (existing > 0) {
  console.log("[seed-prod] users already exist — nothing to do");
} else {
  const tenant = await prisma.tenant.create({
    data: { name: "PushVault", brandName: "PushVault", brandPrimaryColor: "#7C3AED", plan: "internal" },
  });
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: email.toLowerCase().trim(),
      passwordHash: hashSecret(password),
      role: "admin",
      propertyIds: [],
    },
  });
  console.log(`[seed-prod] admin created: ${email}`);
}
await prisma.$disconnect();
