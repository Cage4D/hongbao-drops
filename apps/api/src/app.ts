// Vercel entrypoint (NestJS zero-config: Vercel looks for src/app.ts and intercepts listen()).
// Config comes from the project's environment variables; locally, use src/main.ts instead.
import { createApp } from './create-app.js';
import { loadConfig } from './config/config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await createApp({ config });
  await app.listen(process.env.PORT ?? config.PORT);
}
void bootstrap();
