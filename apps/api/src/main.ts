import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableCors({
    origin: [/^http:\/\/localhost:\d+$/, /^https:\/\/localhost:\d+$/],
    credentials: false,
  });
  // Local stand-in for the CDN: serves the built snippet + service worker
  app.useStaticAssets(join(__dirname, "..", "public"), { prefix: "/cdn/" });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[api] PushVault API listening on http://localhost:${port}/api/v1`);
}

bootstrap();
