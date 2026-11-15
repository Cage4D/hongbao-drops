// App factory shared by the local server (main.ts), tests and the Vercel entry (Phase 8).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, type AppModuleOptions } from './app.module.js';
import { ErrorFilter } from './common/error.filter.js';

export async function createApp(opts: AppModuleOptions = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(opts), {
    logger: process.env.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'],
  });
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '64kb' });
  app.enableCors(); // tightened to the frontend origin in Phase 9
  app.useGlobalFilters(new ErrorFilter());
  return app;
}
