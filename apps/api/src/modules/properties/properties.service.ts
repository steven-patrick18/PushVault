import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../infra/prisma.service";
import { generateKey, hashSecret } from "../../common/crypto";
import { AuthUser } from "../../common/auth.guard";

const DEFAULT_PROMPT_CONFIG = {
  trigger: { type: "delay", seconds: 12 },
  pages: { include: ["*"], exclude: [] },
  text: {
    headline: "🔔 Get offers & price-drop alerts?",
    yes: "Yes, notify me",
    no: "No thanks",
  },
  style: { position: "top", accent: "#7C3AED", logo: null },
  reask: { enabled: false, cooldown_days: 7 },
};

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  private db(user: AuthUser) {
    return this.prisma.forTenant(user.tenantId);
  }

  async list(user: AuthUser) {
    const properties = await this.db(user).property.findMany({
      orderBy: { createdAt: "asc" },
    });
    return properties.map((p) => this.serialize(p));
  }

  async get(user: AuthUser, id: string) {
    const property = await this.db(user).property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");
    return { ...this.serialize(property), install: this.installSnippet(property.propertyKey) };
  }

  async create(user: AuthUser, data: { name: string; domains: string[]; iconUrl?: string }) {
    const propertyKey = generateKey("pk_live");
    const apiKey = generateKey("sk_live");
    const property = await this.db(user).property.create({
      data: {
        tenantId: user.tenantId,
        name: data.name,
        domains: data.domains,
        iconUrl: data.iconUrl ?? null,
        propertyKey,
        promptConfig: DEFAULT_PROMPT_CONFIG,
        apiKeyHash: hashSecret(apiKey),
      },
    });
    await this.audit(user, "property.create", property.id, null, { name: data.name });
    return {
      ...this.serialize(property),
      apiKey, // shown once
      install: this.installSnippet(propertyKey),
    };
  }

  async update(
    user: AuthUser,
    id: string,
    data: Partial<{
      name: string;
      domains: string[];
      iconUrl: string | null;
      promptConfig: unknown;
      frequencyCapPerDay: number;
      frequencyCapPerWeek: number;
      status: string;
    }>,
  ) {
    const before = await this.db(user).property.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Property not found");
    const property = await this.db(user).property.update({
      where: { id },
      data: data as any,
    });
    await this.audit(user, "property.update", id, { name: before.name }, data);
    return this.serialize(property);
  }

  async rotateApiKey(user: AuthUser, id: string) {
    const property = await this.db(user).property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");
    const apiKey = generateKey("sk_live");
    await this.db(user).property.update({
      where: { id },
      data: { apiKeyHash: hashSecret(apiKey) },
    });
    await this.audit(user, "property.rotate_api_key", id, null, null);
    return { apiKey }; // shown once
  }

  private installSnippet(propertyKey: string) {
    const cdn = process.env.CDN_BASE_URL ?? "http://localhost:3000/cdn";
    return {
      script: `<script src="${cdn}/pushvault.js" data-property-key="${propertyKey}" defer></script>`,
      serviceWorker:
        "Upload pv-sw.js to your site root so it is reachable at https://yourdomain.com/pv-sw.js",
    };
  }

  private serialize(p: any) {
    const { apiKeyHash, vapidPrivate, monthlySendQuota, ...rest } = p;
    return {
      ...rest,
      monthlySendQuota: monthlySendQuota === null ? null : Number(monthlySendQuota),
      hasApiKey: Boolean(apiKeyHash),
    };
  }

  private async audit(
    user: AuthUser,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) {
    await this.db(user).auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action,
        entityType: "property",
        entityId,
        before: before as any,
        after: after as any,
      },
    });
  }
}
