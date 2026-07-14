import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AppModule } from "./app.module";
import { PublicService } from "./modules/public/public.service";
import { renderOptInPage } from "./modules/public/hosted-page";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const express = app.getHttpAdapter().getInstance();

  // behind Caddy/nginx: honor X-Forwarded-For so rate limits see real IPs
  if (process.env.TRUST_PROXY) {
    express.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
  }

  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableCors({
    origin:
      process.env.NODE_ENV === "production"
        ? true // public endpoints validate Origin against property domains themselves
        : [/^http:\/\/localhost:\d+$/, /^https:\/\/localhost:\d+$/],
    credentials: false,
  });
  // CDN path: serves the built snippet + service worker. no-cache (not
  // no-store) so browsers revalidate and ship pv-sw.js updates promptly.
  app.useStaticAssets(join(__dirname, "..", "public"), {
    prefix: "/cdn/",
    setHeaders: (res, path) => {
      if (path.endsWith(".js")) res.setHeader("Cache-Control", "no-cache");
    },
  });

  // Hosted opt-in subdomains (e.g. alerts.example.com pointed here): serve the
  // service worker at THEIR root so push works on sites that can't host files
  // (Website Builder / Shopify). Same built file as /cdn/pv-sw.js.
  const publicDir = join(__dirname, "..", "public");
  const publicSvc = app.get(PublicService);
  const dashboardHost = (process.env.PUSH_DOMAIN ?? "").toLowerCase();
  const cdnBase = process.env.CDN_BASE_URL ?? "http://localhost:3000/cdn";

  express.get("/pv-sw.js", (_req: any, res: any) => {
    res.setHeader("Service-Worker-Allowed", "/");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(publicDir, "pv-sw.js"));
  });

  // production: the API also serves the dashboard SPA (single container)
  const dashboardDist = join(__dirname, "..", "..", "dashboard", "dist");
  const haveDashboard = existsSync(join(dashboardDist, "index.html"));
  if (haveDashboard) app.useStaticAssets(dashboardDist);

  express.get(/^\/(?!api\/|cdn\/).*/, async (req: any, res: any) => {
    const host = String(req.headers.host ?? "").toLowerCase().split(":")[0];
    const isDashboard = !dashboardHost || host === dashboardHost || host === "localhost" || host === "127.0.0.1";
    if (isDashboard) {
      if (haveDashboard) return res.sendFile(join(dashboardDist, "index.html"));
      return res.status(404).send("Not found");
    }
    // a property subdomain → branded hosted opt-in page
    try {
      const property = await publicSvc.propertyByHost(req.headers.host);
      if (!property) {
        return res.status(404).send("No PushVault property is configured for this domain.");
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(renderOptInPage(property, cdnBase));
    } catch {
      return res.status(500).send("Error");
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[api] PushVault API listening on http://localhost:${port}/api/v1`);
}

bootstrap();
