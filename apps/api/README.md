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

## Endpoints

| Method & path | What it does |
|---|---|
| `POST /envelopes` | Validates the body, applies mainnet budget caps, derives the gate key, computes the P2SH32 contract, builds the BCMR registry (stamps). Returns `fundingTemplate`, the exact outputs the funding tx must contain, in order, excluding change |
| `POST /envelopes/:id/funded` | Fetches the tx from Fulcrum and checks every output (see below). Only then sets the envelope to `ACTIVE` and creates its shares. Idempotent for the same txid |
| `GET /envelopes/:id`, `GET /s/:slug` | Public view: sats + USD, shares left, expiry countdown, sponsor branding, stamp image and alt text. Never returns keys, quiz answers or the sender address |
| `GET /health` | DB, Fulcrum (height + server), network, price, keeper heartbeat |
| `POST /envelopes/:id/holds` | "Hold my share": reserves a share for 15 min and returns a single-use `holdToken` |
| `POST /envelopes/:id/claims` | The gate. Checks eligibility, reserves a share for 120 s, signs the approval, and records `isNewWallet` (Fulcrum history) |
| `GET /envelopes/:id/events` | Server-Sent Events: `claimed`, `held`, `refunded`, `exhausted`, `passedOn`. Replays the last 10, then streams live. Resume with `Last-Event-ID`. Each stream ends after ~280 s (Vercel limit) and `EventSource` reconnects |
| `GET /envelopes/:id/tree` | Pass-it-on lineage of the whole tree: nodes, generations, total reach, viral coefficient |
| `POST /internal/keeper/tick` | Keeper (Bearer `KEEPER_TOKEN`). Steps: cleanup → reconcile from chain → batch refunds → confirmations → 7-day activation → farm flags → heartbeat. Called every minute by an external cron |
| `GET /og/:idOrSlug.png` | 1200×630 link-preview card (theme, sponsor colour, message incl. CJK, shares left, USD) |
| `GET /stamps/:category/:file` | Stamp art: `<commitment>.svg|png` per share, `collection.svg|png` |
| `GET /bcmr/:category.json` | The BCMR registry, byte-for-byte as committed on-chain |
| `POST /sponsors`, `POST /campaigns` | Sponsors (token shown once, stored hashed) and campaigns (Bearer sponsor token) |
| `GET /campaigns/:id/stats` · `/export.csv` · `/public` | Funnel → cost per activated new wallet, CSV with txids (sponsor only), public proof of reach. See docs/phase7-analytics.md |
| `GET /stats/global`, `POST /envelopes/:id/cta-click` | Landing totals; deduped CTA clicks |
| `POST /claims/:id/broadcast` | Checks the claim tx spends exactly the approved share to exactly the approved address (stamp intact, fee ≤ maxFee), relays it, and treats 0-conf acceptance as success |

## The gate (`src/claims/claims.service.ts`)

**What it signs:** a 64-byte Schnorr datasig over `recipientLockingBytecode ‖ outpointTxHash ‖ u32le(vout)` with the envelope's gate key. It's useless without the link secret, and valid only for that share to that address.

**When it signs**, in order:
1. If this recipient already received a share → `ALREADY_CLAIMED`.
2. Envelope `ACTIVE` and before expiry, else `NOT_FUNDED`, `ENVELOPE_EXPIRED` or `ENVELOPE_EMPTY`.
3. Per-IP rate limit: 10 claim attempts per envelope per 10 min (IPs stored only as HMAC hashes).
4. A live approval for this recipient is returned again, so a retry keeps the claimer's place.
5. Quiz: salted hash of the normalised answer; 5 wrong tries per IP per 10 min → `RATE_LIMITED`.
6. Wallet fingerprint not already used by another address. Serialised per (envelope, fingerprint) with an advisory lock.
7. Reserve a share:
   - **with a hold token:** that exact HELD share, or `HOLD_EXPIRED`;
   - **without:** `SELECT … FOR UPDATE SKIP LOCKED` on the next free share (AVAILABLE, or HELD/RESERVED whose time ran out). Parallel claimers never collide.
   - A timed-out claim loses its share and can no longer broadcast.
8. Insert the claim. The unique index `(envelope, recipientLockingBytecode)` settles a recipient racing itself.

**Approvals never expire on-chain.** So the gate remembers every share it approved for a recipient (`approvedShareIds`). While one is unspent, that recipient can only be re-reserved **that** share, never a second outpoint. A lapsed approval broadcast outside the API can still beat a newer claimer to the share; the keeper's reconcile step records the winner and frees the other claimer.

**Client IP:** only the header named in `CLIENT_IP_HEADER` (set by our host, e.g. Vercel's `x-vercel-forwarded-for`) is trusted; otherwise the socket address is used.

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
