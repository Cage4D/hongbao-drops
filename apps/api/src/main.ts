// Local server: `pnpm --filter @hongbao/api dev`. Loads the repo-root .env if present.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { createApp } = await import('./app.js');
const { loadConfig } = await import('./config/config.js');
const config = loadConfig();
const app = await createApp({ config });
await app.listen(config.PORT);
console.log(`Hongbao API on http://localhost:${config.PORT} (${config.NETWORK})`);
