/**
 * M1 acceptance test: prove tenant A cannot read tenant B rows via the
 * restricted pv_app role, even with crafted raw SQL.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const owner = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});
const app = new PrismaClient({
  datasources: { db: { url: process.env.APP_DATABASE_URL } },
});

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  // --- setup: two tenants, one property each (as owner, bypassing RLS)
  const suffix = randomUUID().slice(0, 8);
  const tenantA = await owner.tenant.create({ data: { name: `RLS-A-${suffix}` } });
  const tenantB = await owner.tenant.create({ data: { name: `RLS-B-${suffix}` } });
  const propA = await owner.property.create({
    data: { tenantId: tenantA.id, name: "A site", domains: ["a.test"], propertyKey: `pk_test_a_${suffix}` },
  });
  const propB = await owner.property.create({
    data: { tenantId: tenantB.id, name: "B site", domains: ["b.test"], propertyKey: `pk_test_b_${suffix}` },
  });

  // --- 1. app role with tenant A context sees only A's properties
  const seenAsA = await app.$transaction([
    app.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA.id}, TRUE)`,
    app.$queryRaw`SELECT id, tenant_id FROM properties WHERE property_key IN (${propA.propertyKey}, ${propB.propertyKey})`,
  ]);
  const rowsA = seenAsA[1] as any[];
  check("tenant A sees own property", rowsA.some((r) => r.id === propA.id));
  check("tenant A cannot see tenant B property", !rowsA.some((r) => r.id === propB.id));

  // --- 2. crafted query: explicit WHERE tenant_id = B while in A context
  const crafted = await app.$transaction([
    app.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA.id}, TRUE)`,
    app.$queryRaw`SELECT id FROM properties WHERE tenant_id = ${tenantB.id}::uuid`,
  ]);
  check("crafted cross-tenant SELECT returns 0 rows", (crafted[1] as any[]).length === 0);

  // --- 3. no tenant context set → zero rows
  const noCtx = await app.$queryRaw`SELECT id FROM properties WHERE id = ${propA.id}::uuid`;
  check("no tenant context → 0 rows", (noCtx as any[]).length === 0);

  // --- 4. cross-tenant UPDATE is a no-op
  const updated = await app.$transaction([
    app.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA.id}, TRUE)`,
    app.$executeRaw`UPDATE properties SET name = 'hacked' WHERE id = ${propB.id}::uuid`,
  ]);
  check("cross-tenant UPDATE affects 0 rows", Number(updated[1]) === 0);

  // --- 5. cross-tenant INSERT is rejected by WITH CHECK
  let insertBlocked = false;
  try {
    await app.$transaction([
      app.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA.id}, TRUE)`,
      app.$executeRaw`INSERT INTO properties (tenant_id, name, domains, property_key) VALUES (${tenantB.id}::uuid, 'evil', ARRAY['x.test'], ${"pk_evil_" + suffix})`,
    ]);
  } catch {
    insertBlocked = true;
  }
  check("cross-tenant INSERT rejected", insertBlocked);

  // --- cleanup
  await owner.property.deleteMany({ where: { id: { in: [propA.id, propB.id] } } });
  await owner.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });

  console.log(failures === 0 ? "\nRLS ACCEPTANCE: ALL PASS ✅" : `\nRLS ACCEPTANCE: ${failures} FAILURE(S) ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });
