// Migrate the test database once per run (local: scripts/dev-db.sh start).
import { execSync } from 'node:child_process';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://hongbao@localhost:54329/hongbao_test';

export default function setup() {
  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
