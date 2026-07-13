import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AppModule } from "./app.module";

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

  // production: the API also serves the dashboard SPA (single container)
  const dashboardDist = join(__dirname, "..", "..", "dashboard", "dist");
  if (existsSync(join(dashboardDist, "index.html"))) {
    app.useStaticAssets(dashboardDist);
    express.get(/^\/(?!api\/|cdn\/).*/, (_req: any, res: any) =>
      res.sendFile(join(dashboardDist, "index.html")),
    );
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[api] PushVault API listening on http://localhost:${port}/api/v1`);
}

bootstrap();
