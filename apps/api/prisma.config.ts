// Prisma 7 CLI config. Migrations use DIRECT_DATABASE_URL when set (Neon: non-pooled URL).
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations need a direct (non-pooled) connection: ours, or Neon-on-Vercel's DATABASE_URL_UNPOOLED.
  datasource: { url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL },
});
