import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infra/prisma.service";
import { PushService, PushError, VapidOverride } from "../campaigns/push.service";

export interface AutomationStep {
  delay_minutes: number;
  title: string;
  body: string;
  click_url: string;
  icon_url?: string | null;
}

const POLL_MS = 30_000;
const BATCH = 200;

/**
 * Drip engine: `automation_jobs` rows are the schedule (DB-backed, so
 * restarts lose nothing). A 30s poller sends whatever is due.
 */
@Injectable()
export class AutomationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Automations");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Called on new subscriber creation: schedule every step of active automations. */
  async enqueueForSubscriber(tenantId: string, propertyId: string, subscriberId: string) {
    const db = this.prisma.forTenant(tenantId);
    const automations = await db.automation.findMany({
      where: { propertyId, status: "active", trigger: "subscribe" },
    });
    if (automations.length === 0) return;
    const now = Date.now();
    const jobs = automations.flatMap((a) =>
      ((a.steps as unknown as AutomationStep[]) ?? []).map((step, i) => ({
        tenantId,
        automationId: a.id,
        subscriberId,
        stepIndex: i,
        dueAt: new Date(now + Math.max(0, step.delay_minutes) * 60_000),
      })),
    );
    if (jobs.length > 0) {
      await db.automationJob.createMany({ data: jobs });
      this.logger.log(`queued ${jobs.length} drip job(s) for subscriber ${subscriberId}`);
    }
  }

  /** Called on unsubscribe/erasure: drop pending drips. */
  async cancelForSubscriber(tenantId: string, subscriberId: string) {
    await this.prisma.forTenant(tenantId).automationJob.updateMany({
      where: { subscriberId, status: "queued" },
      data: { status: "cancelled" },
    });
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.system.automationJob.findMany({
        where: { status: "queued", dueAt: { lte: new Date() } },
        take: BATCH,
        orderBy: { dueAt: "asc" },
        include: {
          automation: { include: { property: true } },
          subscriber: true,
        },
      });
      for (const job of due) {
        await this.processJob(job);
      }
    } catch (e: any) {
      this.logger.error(`tick failed: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  private async processJob(job: any) {
    const db = this.prisma.forTenant(job.tenantId);
    const steps = (job.automation.steps as AutomationStep[]) ?? [];
    const step = steps[job.stepIndex];

    if (
      !step ||
      job.automation.status !== "active" ||
      job.subscriber.status !== "active"
    ) {
      await db.automationJob.update({
        where: { id: job.id },
        data: { status: "cancelled" },
      });
      return;
    }

    const sendId = randomUUID();
    await db.send.create({
      data: {
        id: sendId,
        tenantId: job.tenantId,
        automationId: job.automationId,
        subscriberId: job.subscriberId,
        status: "queued",
      },
    });

    const vapid: VapidOverride | null =
      job.automation.property.vapidPublic && job.automation.property.vapidPrivate
        ? {
            publicKey: job.automation.property.vapidPublic,
            privateKey: job.automation.property.vapidPrivate,
          }
        : null;

    try {
      await this.push.send(
        { endpoint: job.subscriber.endpoint, p256dh: job.subscriber.p256dh, auth: job.subscriber.auth },
        {
          title: step.title,
          body: step.body,
          icon: step.icon_url ?? job.automation.property.iconUrl,
          url: step.click_url,
          send_id: sendId,
        },
        vapid,
      );
      const now = new Date();
      await db.send.update({ where: { id: sendId }, data: { status: "sent", sentAt: now } });
      await db.subscriber.update({
        where: { id: job.subscriberId },
        data: { pushesReceived: { increment: 1 }, lastPushAt: now },
      });
      await db.automationJob.update({ where: { id: job.id }, data: { status: "sent" } });
    } catch (e) {
      const code = e instanceof PushError ? e.statusCode : null;
      if (code === 404 || code === 410) {
        await db.send.update({
          where: { id: sendId },
          data: { status: "expired", errorCode: String(code) },
        });
        await db.subscriber.update({
          where: { id: job.subscriberId },
          data: { status: "expired" },
        });
      } else {
        await db.send.update({
          where: { id: sendId },
          data: { status: "failed", errorCode: code ? String(code) : "error" },
        });
      }
      await db.automationJob.update({ where: { id: job.id }, data: { status: "failed" } });
    }
  }
}
