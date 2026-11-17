// App factory shared by the local server (main.ts) and tests. The Vercel entry (app.ts) calls
// NestFactory itself (Vercel's detector requires it) and reuses configureApp().
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, type AppModuleOptions } from './app.module.js';
import { ErrorFilter } from './common/error.filter.js';

export const LOGGER = process.env.NODE_ENV === 'test' ? (false as const) : (['log', 'warn', 'error'] as ('log' | 'warn' | 'error')[]);

/** Express-level settings every entry point applies. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '64kb' });
  app.enableCors(); // tightened to the frontend origin in Phase 9
  app.useGlobalFilters(new ErrorFilter());
  return app;
}

export async function createApp(opts: AppModuleOptions = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(opts), { logger: LOGGER });
  return configureApp(app);
}
