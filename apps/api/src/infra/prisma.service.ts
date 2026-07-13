import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Two database identities:
 *  - `system`: owner connection (DATABASE_URL). Bypasses RLS. Used ONLY for
 *    login lookup, seeding and cross-tenant admin plumbing.
 *  - `forTenant(tenantId)`: restricted pv_app connection (APP_DATABASE_URL)
 *    with RLS enforced. Every query is wrapped in a transaction that sets
 *    `app.tenant_id`, so Postgres itself guarantees tenant isolation.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly system: PrismaClient;
  private readonly app: PrismaClient;
  private readonly tenantClients = new Map<string, TenantClient>();

  constructor() {
    this.system = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
    this.app = new PrismaClient({
      datasources: { db: { url: process.env.APP_DATABASE_URL } },
    });
  }

  async onModuleInit() {
    await this.system.$connect();
    await this.app.$connect();
  }

  async onModuleDestroy() {
    await this.system.$disconnect();
    await this.app.$disconnect();
  }

  forTenant(tenantId: string): TenantClient {
    let client = this.tenantClients.get(tenantId);
    if (!client) {
      client = createTenantClient(this.app, tenantId);
      this.tenantClients.set(tenantId, client);
    }
    return client;
  }
}

function createTenantClient(prisma: PrismaClient, tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof createTenantClient>;
