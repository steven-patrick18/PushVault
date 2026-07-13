import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashSecret, generateKey } from "../src/common/crypto";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.tenant.findFirst({ where: { name: "PushVault Demo Agency" } });
  if (existing) {
    console.log("[seed] already seeded — skipping");
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: "PushVault Demo Agency",
      brandName: "PushVault",
      brandPrimaryColor: "#7C3AED",
      plan: "internal",
    },
  });

  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "admin@pushvault.local",
      passwordHash: hashSecret("admin123"),
      role: "admin",
      propertyIds: [],
    },
  });

  const property = await prisma.property.create({
    data: {
      tenantId: tenant.id,
      name: "Demo Store",
      domains: ["localhost", "localhost:8443"],
      propertyKey: generateKey("pk_live"),
      promptConfig: {
        trigger: { type: "delay", seconds: 5 },
        pages: { include: ["*"], exclude: ["/checkout*"] },
        text: {
          headline: "🔔 Get offers & price-drop alerts?",
          yes: "Yes, notify me",
          no: "No thanks",
        },
        style: { position: "top", accent: "#7C3AED", logo: null },
        reask: { enabled: false, cooldown_days: 7 },
      },
    },
  });

  console.log("[seed] tenant:   ", tenant.id);
  console.log("[seed] property: ", property.id, property.propertyKey);
  console.log("[seed] login:     admin@pushvault.local / admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
