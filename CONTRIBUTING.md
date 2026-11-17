# Developing Hongbao Drops

The judge-facing overview is in [README.md](README.md). The original brief is [HONGBAO_BACKEND_SPEC.md](HONGBAO_BACKEND_SPEC.md). This page is for people working on the code.

## Layout

| Path | What |
|---|---|
| `packages/contract` | CashScript 0.14 contract (`Hongbao.cash`), compiled artifact and builders: `fundingOutputs`, `buildClaimTx`, `planRefund`/`buildRefundTx`, `dustLimit`, `gateMessage`, `stampCommitment`. `spikes/` holds Phase 0 experiments. Contract walkthrough: [contracts/README.md](packages/contract/contracts/README.md) |
| `packages/shared` | Zod schemas, API types (imported by the frontend) and the error catalog |
| `apps/api` | NestJS 12 + Prisma 7 + Postgres API: envelopes, claims (the gate), keeper, SSE events, media (OG cards, stamps, BCMR), campaigns, admin, `/health` |
| `scripts` | Chipnet tools (`wallet`, `fund`, `claim`, `refund`, `send`, `inspect`, `addr-check`) and e2e suites (`api-e2e`, `claims-e2e`, `lifecycle-e2e`, `campaign-e2e`, `stamp-to-wallet`). All take `--api <url>` |
| `apps/wc-test` | Throwaway WizardConnect test page (Phase 2) |
| `docs/` | Phase notes, decisions ([findings.md](docs/findings.md)), the two external reviews' fixes, deploy notes and the mainnet runbook |

## Local setup

Requires Node ≥ 22 and pnpm 12. Copy `.env.example` to `.env`; it defaults to **Chipnet**.

```bash
pnpm install
scripts/dev-db.sh start          # user-space Postgres on :54329 (dbs hongbao, hongbao_test); re-run after reboots
pnpm build
pnpm test                        # contract, shared and API suites
pnpm lint
pnpm --filter @hongbao/api dev   # local API on :3000 (Chipnet), reads the root .env
```

Vercel type-checks **without strict mode**. Before pushing, also run:

```bash
pnpm --filter @hongbao/api exec tsc -p tsconfig.json --noEmit --strict false
```

## Deployment

- Vercel project `hongbao-drops-api` (root `apps/api`). **Pushing `main` deploys.** Migrations run in the build.
- The Vercel entry is `apps/api/src/app.ts`, which must call `NestFactory` directly; local dev uses `src/main.ts`.
- Secrets are generated locally with `scripts/gen-prod-secrets.sh` and set in Vercel by hand. They never go into the repo.
- The keeper runs every minute from cron-job.org (`scripts/setup-keeper-cron.sh`), with a daily Vercel Cron as a backstop.
- Details: [docs/phase8-deploy.md](docs/phase8-deploy.md). Mainnet switch: [docs/phase8-mainnet-runbook.md](docs/phase8-mainnet-runbook.md).

## Scripts and networks

Scripts run on **Chipnet** unless told otherwise. `--mainnet` works only for the manual tools (`wallet`, `inspect`, `addr-check`, `send`, `stamp-to-wallet`), and broadcasting on mainnet additionally needs `--yes-mainnet`. The e2e suites always refuse mainnet. Examples:

```bash
pnpm --filter @hongbao/scripts wallet
pnpm --filter @hongbao/scripts claims-e2e -- --api https://hongbao-drops-api.vercel.app
pnpm --filter @hongbao/scripts addr-check -- bchtest:q…
```
