# Integration test report (backend + frontend), 2026-11-18

Tested on **Chipnet only**. No mainnet coins were touched. Production API `https://hongbao-drops-api.vercel.app` (`GET /health` → `"network":"CHIPNET"`, chain, db and keeper green), production frontend `https://hongbao-drops.vercel.app` (same bundle as `main` at `5a482dd`), and `apps/web` running locally (`vite`, port 5173) against the production API.

## Summary

- **Backend:** every spec requirement I could exercise is met or met as amended. All 233 automated tests pass and all four Chipnet e2e suites pass against production. I found **no backend bug that breaks a claim**. Three copy nits and one UX question are listed for a decision (backend changes need your OK).
- **Frontend:** the claim flow works end to end in a real (headless) browser: paste an address, Hold my share, quiz, live second tab, success screen with seal, double claim, empty/expired/refunded, broken links, sponsor CTA. Its funding and pass-on code also works on Chipnet: the app's own `fund.ts`/`claim.ts` was run with the script wallet signing locally (see "How the flows were driven").
- **Fixed in 6 small commits (not pushed):** 4 major and 3 minor frontend bugs, listed below. None touches the API.
- **Must still be checked with Paytaca by hand:** WizardConnect connect + sign after the fee-planning change (commit `03d43e1`), and claiming through the **Wallet** tab after Hold my share (commit `a62150c`). I can't drive a phone wallet.

## How the flows were driven

| Part | How |
|---|---|
| Rendering, clicks, phone width | Headless Chromium (Playwright 1.63) on the local frontend, at 1280 px and 375 px. Screenshots checked by eye |
| Creating and funding envelopes | Creating through the UI needs a WizardConnect wallet. Instead, a harness ran the **frontend's own** `createAndFund()` (`apps/web/src/lib/fund.ts`) and `planChange()`/`txBuilder()` (the same code `wallet.tsx` uses), signing locally with the Chipnet script wallet in place of the WizardConnect sign request |
| Claims outside the browser | The frontend's own `claimShare()` (`apps/web/src/lib/claim.ts`) |
| Confirming coins and seals | `pnpm --filter @hongbao/scripts addr-check` / `inspect` (Paytaca's Chipnet view is stuck; known) |

## 1. Spec conformance (§5–§10)

"As amended" cites `docs/findings.md` (F), `docs/review-1-fixes.md` (R1) or `docs/review-2-fixes.md` (R2).

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 5 | P2S deploy | **Met as amended**: P2SH32 (F, "Deploy as P2S? No") | Contract 222 B > 201 B P2S limit |
| 5 | Loop-based `refundBatch()` (Layla) | **Met** | Live: refund tx `da46d56d…` spent 2 shares in one batch (locktime = expiry) |
| 5.1 | Fan-out shares + seal NFT per share in one genesis tx | **Met** | Funding `0a1c5e41…`: identity, 3 seal-bearing shares, BCMR OP_RETURN, change |
| 5.1 | vout-0 rule / prep tx | **Met** | Frontend made a prep tx when no vout-0 coin existed (`ebbfefc5…`), and none on pass-on (claimed coin is vout 0) |
| 5.1 | BCMR OP_RETURN | **Met** (+ output 0 identity to treasury, F) | Template `IDENTITY:546, SHARE…, BCMR:0` |
| 5.1 | Seals optional | **Met** | No-seal envelope `6f7ae426…` (1,500-sat shares) |
| 5.2 | Constructor params | **Met** | `constructorArgs` in approvals |
| 5.3 | `claim` / `refundBatch` semantics | **Met as amended** (`toPaddedBytes`, trailing `require`, F) | Contract tests |
| 5.4 | 16-case test matrix | **Met**: all 16, plus #2b, #4b, #12b, 4 NFT-tamper variants | `packages/contract/test/hongbao.test.ts`, 58/58 contract tests pass |
| 6.1 | Link keypair in browser; only `linkPk` sent | **Met** | `link.ts`; no request carried `k=` in any browser run (request log watched) |
| 6.1 | `POST /envelopes` → address + required outputs | **Met as amended**: `sealCategory` field and `fundingTemplate` (F) | |
| 6.1 | On-chain verification before `ACTIVE` | **Met** | api-e2e: `NOT_FUNDED` → `FUNDING_MISMATCH` (wrong envelope) → `ACTIVE` |
| 6.1 | Share link `/e/<id>#k=` and `/<slug>#k=` | **Met** | Both forms load and claim |
| 6.2 | Three entry paths (wallet / hold / paste) | **Met**; wallet path not driven (needs Paytaca) | Paste and hold verified in browser |
| 6.2 | Hold shows "Paytaca / Cashonize" | **Met as amended**: Paytaca only (wallet policy, commit `35a4e12`) | |
| 6.2 | Fresh-wallet check | **Met** | `isNewWallet=true` → "Welcome to Bitcoin Cash!" |
| 6.2 | 0-conf success | **Met** | "Money arrived" ~2 s after tapping Claim |
| 6.3 | Pass it on with `parentEnvelopeId`; 50% / 3 shares default | **Met**; see minor bug m4 on the default | Pass-on `637103fd…`, tree 2 generations |
| 6.4 | Keeper refunds every minute, ≤ 20 per tx | **Met as amended**: external per-minute cron + daily Vercel backstop (F §7, R2 P1-8) | Refund `da46d56d…` |
| 8.2 | One claim per address / fingerprint / hold token | **Met** | claims-e2e double claims (q… and z… forms); browser double claim |
| 8.2 | Rate limits; 5 wrong answers / 10 min | **Met** | `attemptsLeft` 4 → 3 across harness + browser (same IP) |
| 8.2 | Quiz hashed + normalised; ≤ 3 answers | **Met** | `"  bitcoin   CASH "` accepted for "Bitcoin Cash" |
| 8.2 | Refuse after expiry / no shares / not ACTIVE | **Met** | `ENVELOPE_EXPIRED`, `ENVELOPE_EMPTY`, `NOT_FUNDED` all seen live |
| 8.3 | Per-envelope gate key | **Met** (code + tests) | |
| 8.5 | Envelope + claim endpoints | **Met** (+ additions: `/s/:slug`, `fundingTemplate`, `/wallets/activity`) | All called by the suites or the frontend |
| 8.5 | SSE `claimed/held/refunded/exhausted/passedOn` | **Met** | Replay of `claimed` + `passedOn` with documented payloads; live update in a 2nd tab |
| 8.5 | `/tree` | **Met** | `generations 2, reach 1, viral 1` |
| 8.5 | Sponsors, campaigns, stats, CSV, public | **Met** | campaign-e2e reconciles every number with chain; browser flow below |
| 8.5 | `/og`, `/bcmr`, `/seals`, `/stats/global`, `/health` | **Met** | OG 200 PNG ~1 s; seals load in the page |
| 8.5 | `/admin/budget`, `/admin/demo/refill` | **Not verified live** (operator endpoints; covered by API tests) | |
| 8.6 | Error catalog: 9 codes, human messages | **Met** (+4 added codes) | Messages shown as-is in the UI; 7 of 9 seen live |
| 9 | Approval < 500 ms | **Partly verified** | 0.86 s end to end from the test machine, but a plain GET takes 0.65–0.99 s from here, so the server share couldn't be isolated |
| 9 | Luckiest flag | **Met** | "Luckiest" tag on the feed |
| 9 | Fiat everywhere | **Met** (see minor bug m1, fixed) | |
| 9 | Slugs + OG previews | **Met** | `curl` without JS returns `og:`/`twitter:` tags (§6 below) |
| 9 | Hold 15 min | **Met** | Countdown "15m 00s" |
| 9 | Graceful chain outages | **Met** (code + tests); outage not simulated live | Frontend retries `CHAIN_UNAVAILABLE` 3× |
| 9 | Themes | **Met** (`lunar` renders as Blue Dragon) | |
| 9 | Alt text | **Met** (copy nit B1) | |
| 10.1 | Chipnet default; mainnet caps | **Met as amended** (R2 Q1–Q3) | API tests only (can't test mainnet caps on Chipnet) |
| 10.1 | `minShareSats` 2000 / 1500 | **Met as amended** (F) | Enforced by API and Send form |
| 10.1 | `MIN_EXPIRY_SECONDS` 600; max 24 h mainnet | **Met as amended** (R2 Q3) | See bug M3 (fixed) |
| 10.1 | Ledger, refill, demo wallet | **Not verified live** (operator) | |

## 2. Automated suites

| Command | Result |
|---|---|
| `scripts/dev-db.sh start` | Postgres on :54329 (already running) |
| `pnpm install && pnpm build` | ✅ |
| `pnpm test` | ✅ **233 passed**: contract 58, shared 4, API 155, web 16 (now **21** with the new `txplan` tests) |
| `pnpm --filter @hongbao/api exec tsc -p tsconfig.json --noEmit --strict false` | ✅ |
| `pnpm --filter @hongbao/web typecheck` / `test` / `build` | ✅ / ✅ / ✅ (also re-run after the fixes) |
| `pnpm lint` | ✅ |

Chipnet e2e against production (`--api https://hongbao-drops-api.vercel.app`):

| Suite | Result |
|---|---|
| `api-e2e` | ✅ create → `NOT_FUNDED` → `FUNDING_MISMATCH` → `ACTIVE` (slug `6hynyt`) |
| `claims-e2e` | ✅ 3 parallel seal-bearing claims, `ENVELOPE_EMPTY`, `ALREADY_CLAIMED` (q… and z…), hold + wrong/right quiz |
| `lifecycle-e2e` | ✅ on the 2nd run with `--allow-no-refunds`. The 1st run stopped at "0 expired envelopes refunded": the production cron keeper had already refunded everything, which is the case that flag exists for. Then: SSE `claimed` + `passedOn`, 2-generation tree |
| `campaign-e2e --single-ip` | ✅ funnel, fees = max(3%, 546), CTA spoofing ignored, CSV rows, every claim and fee reconciled on-chain, public page leaks no addresses |

## 3. Frontend ↔ API contract (`apps/web/src/lib/api.ts` and callers)

| Check | Result |
|---|---|
| Paths, methods, bodies vs `packages/shared/src/schemas.ts` | ✅ all 17 calls match (create, funded, envelope, slug, hold, claim, broadcast, tree, cta-click, sponsors, campaigns, stats, public, CSV, wallet activity, health, global stats) |
| Response fields (sats vs USD, nulls) | ✅ sats are numbers, USD nullable everywhere. Cent-rounded USD showed `$0.00` (m1, fixed) |
| Every `ERROR_CATALOG` code handled; `message` shown as-is | ✅ `errorText()` shows `message`, or `reason` when present (`ALREADY_CLAIMED`, `RATE_LIMITED`), or `issues` for `INVALID_REQUEST`; `WRONG_ANSWER` adds "N tries left"; `HOLD_EXPIRED` clears the stored hold; `NOT_FOUND` → not-found page |
| `CHAIN_UNAVAILABLE` → retry | ✅ claim and broadcast retry 3× after 3 s; `/funded` retries too |
| `/funded` + `NOT_FUNDED` "not found on the network yet" → retry ~30 s | ✅ every 2 s for up to 40 s. What happened after that was bug M2 (fixed) |
| SSE: one stream per page, closed on leave, all event types | ✅ `useEnvelopeEvents` opens one `EventSource` per envelope id and closes it on unmount; listens to all 5 events. `held` has no visible effect (holds don't change "N left"), which is fine. Dev mode opens it twice because of React StrictMode, production once |

## 4. Transaction building in the browser (handoff §4–§6)

| Check | Result |
|---|---|
| vout-0 / prep-tx rule | ✅ largest vout-0 BCH coin as input 0, else a self-send prep tx whose output 0 becomes input 0. Seen live |
| `fundingTemplate` outputs in exact order, change last | ✅ template mapped 1:1 (seals as `capability: 'none'` NFTs); on pass-on the old seal output comes after the template, then change |
| Fee scales with inputs, no flat 1,000-sat placeholder | ✅ no flat placeholder, but the size measurement could miss the change output: **bug M1 (fixed)** |
| Relay-safe WizardConnect serialisation (BigInt) | ✅ `toRelayRequest()` hex-encodes bytes and writes `"<bigint: Xn>"`; `broadcast: false`, the page broadcasts itself |
| `buildClaimTx` uses `ap.recipientLockingBytecode` | ✅ |
| Link secret only in `#k=` | ✅ never in a query string, `og:url` (origin + path only, checked with curl), logs (no `console.*` in `apps/web/src`) or analytics (none in the bundle). It is kept in this origin's `localStorage` for the sender's own drops ("Your recent drops"), which is by design |
| Pass it on returns the old seal, doesn't burn it | ✅ live: pass-on `637103fd…` output 5 = 766 sats + the original seal (`37b91160… 3200000001`) back on the claimer's address |

## 5. End to end in the browser (Chipnet)

| Flow | Result |
|---|---|
| Create EQUAL / LUCKY / QUIZ, with and without seals, sponsored | ✅ with the frontend's own `createAndFund()` (above); all became `ACTIVE`. Through the UI with a real wallet: **not verified** |
| Copy link | Link format checked; clipboard not exercised headless |
| Claim by pasted address | ✅ "Money arrived" in ~2 s, BCH + seal image (alt text present), "Welcome to Bitcoin Cash!" for a fresh address |
| Live update in a 2nd tab | ✅ "3 of 3 left" → "2 of 3 left" and the feed row appeared within ~2 s |
| Hold my share, return later | ✅ at 375 px: held "15m 00s"; another device meanwhile got `ENVELOPE_EMPTY` (see B3); returning re-opens the hold tab; claim with the held share works |
| Quiz wrong → right | ✅ "Not quite — try again. · 3 tries left", then success |
| Double claim | ✅ "You've already grabbed one from this envelope 🧧" |
| Empty / expired / refunded | ✅ "Too slow!…" / "This one has closed…" + "Send your own" |
| Success screen with seal | ✅ |
| Pass it on → tree | ✅ pass-on form loads ("Gift it forward"); tree: "This drop reached 1 person across 2 generations" |
| Sponsor: create → key once → campaign → dashboard → CSV → public page | ✅ "Continue" stays disabled until "I saved my sponsor key" is ticked; CSV downloads with the claim header; `/c/:id` shows the same numbers |
| Sponsored envelope page | ✅ "Sponsored by Browser Tea", CTA shows the domain, "You're leaving Hongbao Drops" dialog, opens with `noopener`; dashboard counted exactly 1 click |
| Landing global stats | ✅ envelopes, shares opened, new wallets, BCH gifted |
| Not-found and invalid links | ✅ missing `#k=`, cut-off `#k=`, garbage `#k=` → "This link is incomplete…"; unknown slug / id → "Lost in the smoke". A valid key from **another** envelope → generic error (m3, fixed) |
| Activity page | ✅ disconnected state only (needs a wallet) |

## 6. Phone, previews and polish

- **375 px:** no horizontal scroll on landing, claim (all states), hold, send, pass-on, sponsor, sponsor dashboard, activity. (The landing dragon's layers extend past the edge but are clipped.)
- **Double submit:** claim and hold swap the buttons for a spinner while busy. Send disables the whole form and shows Cancel. Sponsor buttons are disabled while busy.
- **Previews without JS** (`curl` on production, Telegram user agent): `/tvbs9h` and `/e/<id>` return `og:title`, `og:description` ("message · 3 of 3 left · $0.02"), `og:image` (1200×630 PNG, 200), `og:image:alt`, `twitter:*`, `og:url` without fragment, `x-hongbao-preview: 1`. Unknown slugs and `/send` fall back to the generic tags.
- **README "Try it in 30 seconds" vs the UI:** "Tap to open it" ↔ button **Open it** ✅. "Pass it on" ✅. "Hold my share" exists, but only after choosing the **No wallet** tab; the README reads as if it were on screen straight away (wording note W1). The demo link and the landing **Try it** button are still empty (`VITE_DEMO_URL` unset): expected until the mainnet demo envelope exists.

## 7. Bugs, ranked

No **blockers** remain: the judge's claim path (open → paste address or connect → claim) worked every time. All the bugs below are in `apps/web`; line numbers are before the fix (`5a482dd`).

### Major

**M1. A funding or pass-on tx could be signed and then rejected by the network: "min relay fee not met".** Fixed in `03d43e1`.
- File: `apps/web/src/lib/wallet.tsx:160-170` (`signAndSend`).
- Repro: fund with inputs whose surplus over the outputs lies between ~(tx size + 546) and (546 + 200 × inputs + 1000) sats, e.g. a pass-on from a small claimed coin, or a wallet holding just enough. The draft was measured without a change output because the draft fee left less than dust, but the final tx still got change.
- Expected: tx pays ≥ 1 sat/B. Actual: the tx is 34 bytes bigger than the fee pays for. The wallet signs, then the broadcast fails.
- Fix: pure `txplan.ts` that always measures with a change output (CashScript `getTransactionSize()`, signature bytes included). Tests sweep the window; a throwaway copy of the old logic underpaid there.

**M2. If confirming failed after broadcast, the link was lost and "Try again" funded a second envelope.** Fixed in `db2ccaf`.
- Files: `apps/web/src/lib/fund.ts:134`, `apps/web/src/pages/Send.tsx:150,402`.
- Repro: sign the funding tx, then have `/funded` fail (API slow to see the tx for > 40 s, `CHAIN_UNAVAILABLE`, network drop). The page shows an error; tap **Try again**.
- Expected: the envelope is live (or will be), and its link is kept. Actual: the link secret was thrown away with the error. "Try again" created a new envelope and asked the wallet to pay again. The first envelope's money stayed locked, unclaimable, until expiry.
- Fix: the link is saved under "Your recent drops" the moment the tx is broadcast. A later failure says the money is in the lockbox, and the button becomes **Check again**, which only re-runs `/funded` for the same envelope and txid.

**M3. A claim through the Wallet tab ignored a held share.** Fixed in `a62150c`. ⚠️ Verify with Paytaca: the wallet path can't be driven headless.
- File: `apps/web/src/pages/EnvelopePage.tsx:485-488` (and the hold panel had no Connect button, `:634-641`).
- Repro: 1-share envelope (or the last share). **No wallet → Hold my share**. Install a wallet, come back, choose **Wallet → Connect wallet → Claim my share**.
- Expected: the held share is claimed. Actual: the claim was sent without `holdToken`. The server found no free share (only the held one): "Too slow! All the red envelopes have been grabbed." On bigger envelopes it took a different share and left the hold blocking one for 15 min.
- Fix: every claim path sends the stored, unexpired hold token, and the hold panel offers **Connect wallet**.

**M4. Mainnet: the default 24-hour expiry could be refused.** Fixed in `db2ccaf`.
- File: `apps/web/src/pages/Send.tsx:126`.
- Repro (mainnet): default "24 hours" sends `now_client + 86400`. The API refuses anything above `now_server + 86400`. A phone clock a few seconds ahead of the server, with a fast wallet scan, gets "must be at most 86400s from now".
- Fix: at the network maximum the request keeps 5 min of slack.

### Minor

**m1. Small amounts showed "$0.00".** Fixed in `a62150c`.
- File: `apps/web/src/pages/EnvelopePage.tsx:180,260,670`.
- Repro: claim a 2,071-sat share. The API rounds USD to cents (`usd: 0`), so the success screen and feed said "$0.00". On mainnet a 2,000-sat share is ~$0.004 and would show the same.
- Fix: with the live price, compute USD from sats (shows "<$0.01").

**m2. Sponsor campaign list was per device, not per key.** Fixed in `a9a3135`.
- File: `apps/web/src/pages/Sponsor.tsx:20`.
- Repro: create a sponsor and a campaign → **Forget this key** → **Use this key** with another sponsor's key. The old campaign is still listed; opening it says "We couldn't find that envelope."
- Fix: the list is stored under a hash of the sponsor key.

**m3. A valid key from another envelope gave a generic error.** Fixed in `58dfc23`.
- File: `apps/web/src/lib/claim.ts:17`.
- Repro: open `/<slug>#k=<key of a different envelope>`, claim. The gate approves, then the network rejects the tx: "Something in that request doesn't look right."
- Fix: compare the key with the approval's `linkPk` first: "This link's key belongs to a different envelope. Ask the sender to send the full link again."

**m4. Pass it on's default amount is never the 50% it suggests** (not fixed, UX call). `Send.tsx:43` uses `max(suggest, 6000)`. A typical claimed share (2,000–3,000 sats) halved is below the 3 × 2,000 minimum, so the form always opens at 6,000 sats, more than the claimer received. They need other coins in the wallet ("needs about 5,949 more sats" for a 2,071-sat claim). On mainnet with ~$0.05 shares (~24,000 sats) the 50% default is fine. Option: suggest 1 share without seals when the claim is small.

**m5. Most seal-bearing envelopes need two wallet approvals** (not a bug, UX note). The funding tx's change is never at vout 0, so a wallet rarely has a vout-0 coin and the prep self-send runs almost every time (4 of the 5 seal-bearing envelopes funded from the script wallet needed it). The UI says "signature 1 of 2", so it is explained.

**m6. `RATE_LIMITED` on create after the prep signature** (not fixed, minor). `POST /envelopes` is limited to 20/h per IP and runs after the prep tx. When the limit hits, the user has already approved a (harmless) self-send. Hit during this test run, not likely for a judge.

### Backend items for your decision (not changed; they touch the API)

| # | Item | Where | Suggestion |
|---|---|---|---|
| B1 | Alt text "a classic red **red** envelope" (known nit, handoff §11) | `apps/api/src/media/og.ts:79`, `media/seal.ts:53-54` (theme label `classic red`) | Label `classic` for the alt text, or drop "red envelope" when the label ends in "red" |
| B2 | Collection seal art says "**1 SEALS**" | `apps/api/src/media/seal.ts:26` | `${n} SEAL${n === 1 ? '' : 'S'}` |
| B3 | While every remaining share is **held**, other claimers get `ENVELOPE_EMPTY` "Too slow! All the red envelopes have been grabbed." but the page still says "1 of 1 left" | `apps/api/src/claims/claims.service.ts:293` | A `reason` such as "The last shares are being held for people setting up a wallet. Check back in 15 minutes." (frontend already shows `reason`) |
| B4 | On **Chipnet**, refunds land ~5 min **before** the shown expiry (envelope REFUNDED with 271 s on the countdown). Chipnet's median time past runs ~340 s ahead of the wall clock, and the CLTV check uses MTP. Mainnet's MTP runs ~1 h behind, so not a mainnet issue | keeper / chain | No change needed; the page already shows "This one has closed". Mention it if anyone tests on Chipnet |

### Wording

**W1.** README step 2: "No wallet yet? Try Paytaca and tap **"Hold my share"**". In the UI it's **No wallet** (tab) → **Hold my share**. Suggest: *"No wallet yet? Tap **No wallet → Hold my share** and we keep a share for you for 15 minutes while you install [Paytaca](https://www.paytaca.com)."* Not edited (judge-facing README; you may want to run it through your README pass).

## 8. Fixes made (on `main`, not pushed)

| Commit | What |
|---|---|
| `03d43e1` | M1: wallet txs always pay 1 sat/B for their signed size (`txplan.ts` + 5 tests) |
| `f9b0a22` | `config.ts` reads Vite env safely outside Vite (needed to run the frontend code from Node) |
| `a62150c` | M3 + m1: a held share is used by every claim path; small amounts show "<$0.01" |
| `db2ccaf` | M2 + M4: never fund an envelope twice, keep its link; 5 min slack at the max expiry |
| `a9a3135` | m2: sponsor campaign list per sponsor key |
| `58dfc23` | m3: clear message for a key from another envelope |

All are frontend-only; none changes the API or its contract. Pushing `main` redeploys the API project too (no API files changed).

## 9. Not verified

- **Paytaca over WizardConnect after `03d43e1`.** `signAndSend` now plans change with `txplan.ts`. The same code funded 7 envelopes from Node, but the WizardConnect request itself wasn't exercised. **Fund one seal-bearing envelope with Paytaca on Chipnet before mainnet.**
- **Wallet-tab claim after Hold my share (M3 fix).** Needs a connected wallet.
- **Activity page with a wallet**, copy-to-clipboard, the native share sheet, Telegram/WhatsApp share buttons.
- **Paytaca showing the BCH and the seal:** mainnet only, Nov 19 (Paytaca's Chipnet servers are stuck; arrivals checked with `addr-check`).
- **Mainnet caps, `/admin/budget`, `/admin/demo/refill`, the demo link and the landing "Try it" button:** after the Nov 19 switch.
- **Server-side claim approval time** (< 500 ms target): only end-to-end time was measurable.
- **The 福 glyph** on the sealed envelope rendered as a box in headless Chromium, which has no CJK font. Phones have one; check on a device.

## Test artefacts (Chipnet)

Envelopes created via the frontend code: `tvbs9h` (EQUAL, seals), `fgh84u` (LUCKY), `4fygsu` (QUIZ), `g6exdz` (no seals, refunded `da46d56d…`), `rmwbay` (1 share, hold test), `xx3sfv` (pass-on of `fgh84u`, tx `637103fd…`), `cw8hpv` (sponsored, campaign "Browser launch"). Funding txs: `0a1c5e41…`, `a1e86533…`, `b70f07f4…`, `6f7ae426…`, `d029dc10…`, `37357951…`.
