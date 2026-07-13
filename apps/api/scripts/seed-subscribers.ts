/**
 * Seeds N synthetic subscribers for send-engine testing (M3 acceptance).
 * Endpoints point at an unreachable local sink, so campaign sends exercise the
 * failure/pruning paths without hitting real push services.
 *   pnpm --filter @pushvault/api exec tsx scripts/seed-subscribers.ts 1000
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
const N = Number(process.argv[2] ?? 500);

const campaigns = ["summer_sale", "diwali_sale", "launch_week", null];
const countries = ["IN", "US", "GB", "DE", null];
const devices = ["mobile", "desktop", "tablet"] as const;
const browsers = ["Chrome", "Edge", "Firefox"];

async function main() {
  const property = await prisma.property.findFirst({ orderBy: { createdAt: "asc" } });
  if (!property) throw new Error("No property — run pnpm seed first");

  const rows = Array.from({ length: N }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 60);
    return {
      id: randomUUID(),
      tenantId: property.tenantId,
      propertyId: property.id,
      endpoint: `http://localhost:9999/push-sink/${randomUUID()}`,
      p256dh: "BNSyntheticTestKeyP256dh_" + i,
      auth: "synthauth" + i,
      status: "active" as const,
      utmCampaign: campaigns[i % campaigns.length],
      utmSource: i % 4 === 3 ? null : "google",
      utmMedium: i % 4 === 3 ? null : "cpc",
      country: countries[i % countries.length],
      device: devices[i % devices.length],
      browser: browsers[i % browsers.length],
      os: "Windows",
      language: "en-US",
      timezone: "Asia/Calcutta",
      subscribedAt: new Date(Date.now() - daysAgo * 86400_000),
    };
  });

  await prisma.subscriber.createMany({ data: rows, skipDuplicates: true });
  console.log(`[seed-subscribers] inserted ${rows.length} synthetic subscribers`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
