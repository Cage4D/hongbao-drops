import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

// The workspace packages are consumed from source so `vite dev` never runs against a stale dist/.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@hongbao/shared': pkg('shared/src/index.ts'),
      '@hongbao/contract': pkg('contract/src/index.ts'),
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { port: 5173 },
});
