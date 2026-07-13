import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableCors({
    origin: [/^http:\/\/localhost:\d+$/, /^https:\/\/localhost:\d+$/],
    credentials: false,
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[api] PushVault API listening on http://localhost:${port}/api/v1`);
}

bootstrap();
