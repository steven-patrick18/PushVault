import { Injectable } from "@nestjs/common";
import { request } from "node:http";
import * as webpush from "web-push";

export interface PushPayload {
  title: string;
  body: string;
  icon?: string | null;
  image?: string | null;
  url: string;
  send_id: string;
  actions?: { action: string; title: string; url: string }[];
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export class PushError extends Error {
  constructor(public readonly statusCode: number | null) {
    super(`Push failed with status ${statusCode}`);
  }
}

@Injectable()
export class PushService {
  send(sub: PushSubscriptionKeys, payload: PushPayload): Promise<void> {
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > 4096) {
      return Promise.reject(new PushError(413));
    }
    // Dev-only fake transport: synthetic test subscribers point at a local
    // HTTP sink; real push services are always HTTPS so this never matches
    // production traffic.
    if (process.env.NODE_ENV !== "production" && sub.endpoint.startsWith("http://localhost")) {
      return this.fakeSend(sub.endpoint, body);
    }
    return webpush
      .sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        {
          TTL: 86400,
          urgency: "normal",
          vapidDetails: {
            subject: process.env.VAPID_SUBJECT ?? "mailto:ops@pushvault.local",
            publicKey: process.env.VAPID_PUBLIC_KEY!,
            privateKey: process.env.VAPID_PRIVATE_KEY!,
          },
        },
      )
      .then(() => undefined)
      .catch((e: any) => {
        throw new PushError(typeof e?.statusCode === "number" ? e.statusCode : null);
      });
  }

  private fakeSend(endpoint: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = request(endpoint, { method: "POST" }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 300) resolve();
        else reject(new PushError(res.statusCode ?? null));
      });
      req.on("error", () => reject(new PushError(null)));
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new PushError(null));
      });
      req.end(body);
    });
  }
}
