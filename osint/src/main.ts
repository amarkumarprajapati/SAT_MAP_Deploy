import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`OSINT Producer NestJS backend running on http://localhost:${port}`);
  console.log(`1) GET /osint/news?limit=10     – all news (UUID id, title, description, lat/long)`);
  console.log(`2) GET /osint/news/full?id=<uuid> – webpage_blob HTML for that news id`);
  console.log(`POST /osint/news/publish        – ingest latest news`);
  console.log(`POST /osint/news/ingest         – one-shot poll cycle`);
  console.log(`POST /osint/publish             – store OSINT event`);
  console.log(`GET  /osint/status              – service + poll status`);
  console.log(`Poll loop: every 30s (set OSINT_POLL_ENABLED=false to disable)`);
}
bootstrap();
