// Vercel entrypoint (NestJS zero-config: Vercel detects src/app.ts importing @nestjs/core and
// intercepts listen()). Config comes from the project's environment; locally use src/main.ts.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { LOGGER, configureApp } from './create-app.js';
import { loadConfig } from './config/config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ config }), { logger: LOGGER });
  configureApp(app);
  await app.listen(process.env.PORT ?? config.PORT);
}
void bootstrap();
