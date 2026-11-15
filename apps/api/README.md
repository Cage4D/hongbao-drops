# @hongbao/api

NestJS 12 + Prisma 7 (Postgres). It runs locally under Node and is built to run as a Vercel function (Phase 8). Request and response types live in [`@hongbao/shared`](../../packages/shared/src/schemas.ts), so the frontend can import them.

## Run locally

```bash
scripts/dev-db.sh start                       # user-space Postgres on :54329 (dbs hongbao, hongbao_test)
cp .env.example .env                          # then fill GATE_MASTER_SEED, ADMIN_TOKEN, TREASURY_ADDRESS
pnpm --filter @hongbao/api exec prisma migrate deploy
pnpm --filter @hongbao/api dev                # http://localhost:3000
pnpm --filter @hongbao/api test               # real Postgres + mock chain
pnpm --filter @hongbao/scripts api-e2e        # Phase 3 exit check against Chipnet (API must be running)
```

**Use a different `GATE_MASTER_SEED` per environment.** Gate keys are derived from `(seed, envelope seq)`, and each database starts its sequence at 1.

## Endpoints (Phase 3)

| Method & path | What it does |
|---|---|
| `POST /envelopes` | Validates the body, applies mainnet budget caps, derives the gate key, computes the P2SH32 contract, builds the BCMR registry (stamps). Returns `fundingTemplate`, the exact outputs the funding tx must contain, in order, excluding change |
| `POST /envelopes/:id/funded` | Fetches the tx from Fulcrum and checks every output (see below). Only then sets the envelope to `ACTIVE` and creates its shares. Idempotent for the same txid |
| `GET /envelopes/:id`, `GET /s/:slug` | Public view: sats + USD, shares left, expiry countdown, sponsor branding, stamp image and alt text. Never returns keys, quiz answers or the sender address |
| `GET /health` | DB, Fulcrum (height + server), network, price, keeper heartbeat |

Errors always look like `{ "error": { "code", "message", ... } }`, using the catalog in [`errors.ts`](../../packages/shared/src/errors.ts) (spec §8.6). Codes added beyond the spec: `INVALID_REQUEST` (400, with `issues`), `NOT_FOUND` (404), `FUNDING_MISMATCH` (422, with `reasons`) and `UNAUTHORIZED` (401).

## Funding verification

[`funding-verifier.ts`](src/envelopes/funding-verifier.ts) is a pure function. An envelope becomes `ACTIVE` only if **all** of these hold:

1. **Stamps:** input 0 spends `<stampCategory>:0` (the genesis rule).
2. **Stamps:** output 0 is the ≥ 546-sat identity output to the treasury, with no token.
3. Share *i* sits at its exact output index, pays the envelope's contract, and is ≥ `minShareSats`. With stamps it also carries one immutable NFT of `stampCategory` with commitment `u32le(seq) ‖ i` and no fungible amount. Without stamps it carries no token.
4. The shares sum to exactly `totalSats`.
5. **Sponsored:** the next output pays ≥ `ceil(total × feeBps / 10000)` to the treasury.
6. **Stamps:** the next output is the byte-exact BCMR OP_RETURN (`sha256` of the stored registry plus the stored URI).
7. No other output pays the contract, so every share is known to the gate and the keeper.

Because the gate (Phase 4) only approves claims on `ACTIVE` envelopes, a sponsor who skips the fee output gets an envelope nobody can claim from. Their funds simply return after expiry.

## Budget caps (mainnet only)

[`budget.service.ts`](src/budget/budget.service.ts) returns `422 BUDGET_CAP` with a `cap` field:

| Cap | Default |
|---|---|
| `MAX_SHARES` | 10 |
| `MAX_ENVELOPE_USD` | $0.50, at the cached price |
| `MAX_ENVELOPE_SATS` | 200,000 (always applied: fallback when the price is unknown, and a backstop) |
| `MAX_ACTIVE_MAINNET_SATS` | 600,000 |
| `DAILY_MAINNET_SATS` | 400,000 |

Unfunded envelopes count toward the caps for 1 hour.

## Design notes

- **Explicit `@Inject(...)` everywhere.** tsx/esbuild, Vitest and Vercel's bundler don't emit decorator metadata, so Nest can't infer constructor types.
- **Prisma 7:** the `prisma-client` generator writes to `src/generated/` (gitignored, created on build) and uses the `@prisma/adapter-pg` driver adapter. Migrations read `DIRECT_DATABASE_URL` when set (Neon's non-pooled URL).
- **Price** is cached for 60 s per instance. The last known value is persisted in `Setting`, so a cold serverless instance still has a fallback.
