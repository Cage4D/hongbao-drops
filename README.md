# Hongbao Drops

Non-revocable BCH red-envelope links with collectible CashToken stamps. BCH BLAZE 2026, Mainnet Track.

The full brief is in [HONGBAO_BACKEND_SPEC.md](HONGBAO_BACKEND_SPEC.md); Phase 0 research is in [docs/findings.md](docs/findings.md).

## Layout

| Path | What |
|---|---|
| `packages/contract` | CashScript contract, artifact, tests (Phase 1). `spikes/` holds Phase 0 experiments |
| `packages/shared` | Zod schemas and types shared with the frontend |
| `apps/api` | NestJS API and keeper (Phase 3+) |
| `scripts` | Chipnet and ops scripts (e.g. `probe:fulcrum`) |

## Dev

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Requires Node ≥ 22 and pnpm 12. Copy `.env.example` to `.env`; it defaults to **Chipnet**.
