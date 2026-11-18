// Request/response contracts between the API and the frontend (spec §8.5).
// Amounts are integer satoshis (JSON numbers; safe far beyond 21M BCH) plus USD where shown.
import { z } from 'zod';

export const NetworkSchema = z.enum(['CHIPNET', 'MAINNET']);
export type Network = z.infer<typeof NetworkSchema>;

export const ModeSchema = z.enum(['EQUAL', 'LUCKY', 'QUIZ']);
export type Mode = z.infer<typeof ModeSchema>;

export const ThemeSchema = z.enum(['classic-red', 'gold', 'christmas', 'lunar']);
export type Theme = z.infer<typeof ThemeSchema>;

const hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`), `${bytes}-byte lowercase hex`);
export const TxidSchema = hex(32);
export const SatsSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const CreateEnvelopeRequestSchema = z
  .object({
    /** Sender's cashaddr; refunds go to its locking bytecode. */
    senderAddress: z.string().min(10).max(120),
    /** Public key of the link secret (compressed). The secret itself never leaves the browser. */
    linkPk: z.string().regex(/^0[23][0-9a-f]{64}$/, 'compressed public key hex'),
    shareCount: z.number().int().min(1).max(127),
    mode: ModeSchema,
    totalSats: SatsSchema,
    /** Unix seconds. */
    expiry: z.number().int(),
    message: z.string().trim().max(280).optional(),
    theme: ThemeSchema.default('classic-red'),
    withSeals: z.boolean().default(true),
    /** Required when seals are on: txid of the vout-0 outpoint the funding tx spends as input 0. */
    sealCategory: TxidSchema.optional(),
    quiz: z
      .object({
        question: z.string().trim().min(1).max(200),
        answers: z.array(z.string().trim().min(1).max(100)).min(1).max(3),
      })
      .optional(),
    campaignId: z.string().max(40).optional(),
    sponsorToken: z.string().max(200).optional(),
    parentEnvelopeId: z.string().max(40).optional(),
  })
  .strict()
  .refine((b) => (b.mode === 'QUIZ') === !!b.quiz, { message: 'quiz is required for QUIZ mode (and only then)', path: ['quiz'] })
  .refine((b) => !b.campaignId || !!b.sponsorToken, { message: 'campaignId needs a sponsorToken', path: ['sponsorToken'] });
export type CreateEnvelopeRequest = z.input<typeof CreateEnvelopeRequestSchema>;

/** One output the funding tx must contain (identity, sponsor fee, BCMR OP_RETURN). */
export interface RequiredOutput {
  purpose: 'IDENTITY' | 'SPONSOR_FEE' | 'BCMR';
  /** Hex locking bytecode. */
  lockingBytecode: string;
  /** Minimum sats (exact for BCMR = 0). */
  sats: number;
  /** Position in the funding tx outputs. */
  outputIndex: number;
}

export interface CreateEnvelopeResponse {
  id: string;
  slug: string;
  network: Network;
  contractAddress: string;
  contractLockingBytecode: string;
  gatePk: string;
  /** Hongbao.cash constructor args in declaration order (hex / decimal strings). */
  constructorArgs: { linkPk: string; gatePk: string; refundLockingBytecode: string; expiry: number; maxFee: number };
  requiredOutputs: RequiredOutput[];
  /** Funding outputs in order, excluding change: build exactly this (seals carry their NFT). */
  fundingTemplate: { outputIndex: number; purpose: RequiredOutput['purpose'] | 'SHARE'; lockingBytecode: string; sats: number; token?: { category: string; nftCommitment: string } }[];
  minShareSats: number;
  /** Suggested split (equal, or a server-side random split for LUCKY; the browser may use its own). */
  shareAmounts: number[];
  envelopeSeq: number;
  bcmr?: { hash: string; uri: string };
}

export const FundedRequestSchema = z.object({ txid: TxidSchema }).strict();
export type FundedRequest = z.infer<typeof FundedRequestSchema>;

export interface ShareView {
  index: number;
  outpoint: string;
  sats: number;
  usd: number | null;
  status: 'AVAILABLE' | 'HELD' | 'RESERVED' | 'CLAIMED' | 'REFUNDED';
  nftCommitment?: string;
}

export interface FundedResponse {
  status: string;
  shares: ShareView[];
}

/** Public envelope view (GET /envelopes/:id, GET /s/:slug). Never includes secrets or full addresses. */
export interface PublicEnvelopeView {
  id: string;
  slug: string;
  network: Network;
  status: string;
  mode: Mode;
  theme: Theme;
  message: string | null;
  quizQuestion: string | null;
  sponsor: { name: string; logoUrl: string | null; brandColor: string | null; ctaLabel: string | null; ctaUrl: string | null } | null;
  total: { sats: number; usd: number | null };
  remaining: { sats: number; usd: number | null };
  shares: { total: number; claimed: number; left: number };
  expiry: number;
  secondsLeft: number;
  withSeals: boolean;
  seal: { category: string; imageUrl: string; alt: string } | null;
  /** Link-preview card (set as og:image / twitter:image) with alt text. */
  og: { imageUrl: string; alt: string; width: 1200; height: 630 };
  recentClaims: { address: string; sats: number; usd: number | null; luckiest: boolean; isNewWallet: boolean | null; at: string }[];
  fundingTxid: string | null;
  parentEnvelopeId: string | null;
}

export interface HealthResponse {
  ok: boolean;
  network: Network;
  db: boolean;
  chain: { ok: boolean; height: number | null; server: string | null };
  keeper: { lastRunAt: string | null };
  priceUsd: number | null;
  time: string;
}

// ------------------------------------------------------------------ claims (Phase 4)

export const HoldRequestSchema = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{16,64}$/, 'hex wallet fingerprint').optional(),
    /** Quiz envelopes: the answer is checked before a share is held, as for a claim. */
    answer: z.string().max(200).optional(),
  })
  .strict();
export type HoldRequest = z.infer<typeof HoldRequestSchema>;

export interface HoldResponse {
  holdToken: string;
  heldUntil: string; // ISO
}

export const ClaimRequestSchema = z
  .object({
    /** Token-aware (z…) or plain (q…/p…) cashaddr. Uniqueness is per locking bytecode. */
    recipientAddress: z.string().min(10).max(120),
    /** sha256 of the WizardConnect receive xpub (hex). Never the xpub itself. */
    walletFingerprint: z.string().regex(/^[0-9a-f]{16,64}$/, 'hex wallet fingerprint').optional(),
    holdToken: z.string().max(100).optional(),
    answer: z.string().max(200).optional(),
  })
  .strict();
export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;

export interface ClaimApproval {
  claimId: string;
  /** The share this approval is bound to. */
  share: {
    index: number;
    outpointTxid: string;
    outpointIndex: number;
    sats: number;
    tokenCategory: string | null;
    nftCommitment: string | null;
  };
  /** Gate datasig over recipientLockingBytecode ‖ outpoint (hex, 64-byte Schnorr). */
  gateSig: string;
  recipientLockingBytecode: string;
  contractLockingBytecode: string;
  constructorArgs: { linkPk: string; gatePk: string; refundLockingBytecode: string; expiry: number; maxFee: number };
  /** Broadcast before this, or the share may go to someone else. */
  reservedUntil: string;
  /** True when this address had no on-chain history before the claim (null if unknown). */
  isNewWallet: boolean | null;
}

export const BroadcastRequestSchema = z.object({ rawTx: z.string().regex(/^[0-9a-f]+$/).max(20_000) }).strict();
export type BroadcastRequest = z.infer<typeof BroadcastRequestSchema>;

export interface BroadcastResponse {
  txid: string;
  amountSats: number;
  amountUsd: number | null;
  seal: { category: string; commitment: string; imageUrl: string; alt: string } | null;
}

// ------------------------------------------------------------------ pass-it-on tree (Phase 5)

export interface TreeNode {
  id: string;
  slug: string;
  parentId: string | null;
  generation: number; // root = 0
  status: string;
  theme: Theme;
  shareCount: number;
  totalSats: number;
  totalUsd: number | null;
  claims: number;
  newWallets: number;
  createdAt: string;
}

export interface TreeResponse {
  rootId: string;
  focusId: string;
  nodes: TreeNode[];
  generations: number;
  /** Claims across the whole tree = people reached. */
  totalReach: number;
  /** Envelopes spawned by passing it on (every node except the root). */
  passOnEnvelopes: number;
  /** Envelopes spawned per claim — the viral coefficient. */
  viralCoefficient: number;
}

// ------------------------------------------------------------------ sponsors & analytics (Phase 7)

const httpsUrl = z.string().url().max(300).refine((u) => u.startsWith('https://'), 'must be an https:// URL');

export const CreateSponsorRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    logoUrl: httpsUrl.optional(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB').optional(),
    ctaLabel: z.string().trim().min(1).max(40).optional(),
    ctaUrl: httpsUrl.optional(),
  })
  .strict()
  .refine((s) => !s.ctaLabel === !s.ctaUrl, { message: 'ctaLabel and ctaUrl go together', path: ['ctaUrl'] });
export type CreateSponsorRequest = z.infer<typeof CreateSponsorRequestSchema>;

export interface CreateSponsorResponse {
  sponsorId: string;
  /** Shown once. Stored only as sha256. Send as `Authorization: Bearer <token>`. */
  sponsorToken: string;
}

export const CreateCampaignRequestSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export interface CreateCampaignResponse {
  campaignId: string;
}

/**
 * The funnel (spec §4). Every count is over claims of the campaign's funded envelopes:
 *  fresh      = recipient had no on-chain history before the claim
 *  activated  = fresh AND (claimed coins moved within 7 days OR the claimer passed it on)
 *  notFarm    = activated AND not flagged as a suspected farm   ← the headline denominator
 */
export interface CampaignFunnel {
  claims: number;
  freshWallets: number;
  activatedWallets: number;
  activatedNotFarm: number;
  /** Fresh wallets whose 7-day window is still open (activation not decided yet). */
  pendingActivation: number;
  suspectedFarms: number;
}

export interface CampaignMoney {
  /** Value that left the sponsor to claimers (claimed share sats, incl. the claim tx fee each share paid). */
  givenAwaySats: number;
  /** Sponsor fees paid to the treasury in funding txs. */
  feesSats: number;
  /** givenAway + fees = what the campaign actually cost. */
  spentSats: number;
  spentUsd: number | null;
  feesUsd: number | null;
  givenAwayUsd: number | null;
  /** Still in contracts (unclaimed, not yet refunded). */
  lockedSats: number;
  lockedUsd: number | null;
  refundedSats: number;
  refundedUsd: number | null;
  priceUsd: number | null;
}

export interface CampaignEnvelopeStats {
  id: string;
  slug: string;
  status: string;
  fundingTxid: string | null;
  totalSats: number;
  shareCount: number;
  claims: number;
  freshWallets: number;
  activatedNotFarm: number;
  ctaClicks: number;
}

export interface CampaignStats extends CampaignFunnel, CampaignMoney {
  campaignId: string;
  name: string;
  sponsor: { name: string; logoUrl: string | null; brandColor: string | null };
  costPerActivatedNewWalletUsd: number | null;
  costPerFreshWalletUsd: number | null;
  ctaClicks: number;
  /** CTA clicks per claim. */
  ctr: number | null;
  /** Funded envelopes spawned from the campaign's envelopes by passing it on (any depth). */
  passOnEnvelopes: number;
  /** Claims across the campaign's envelopes and everything passed on from them. */
  totalReach: number;
  perEnvelope: CampaignEnvelopeStats[];
  /** Every number above can be audited on-chain from these. */
  fundingTxids: string[];
  claimTxids: string[];
  refundTxids: string[];
  generatedAt: string;
}

/** GET /campaigns/:id/public — shareable "proof of reach": no addresses, no fingerprints. */
export type PublicCampaignStats = Omit<CampaignStats, 'perEnvelope'> & {
  perEnvelope: Omit<CampaignEnvelopeStats, never>[];
};

export interface GlobalStats {
  envelopes: number;
  claims: number;
  newWalletsOnboarded: number;
  activatedNewWallets: number;
  bchGiftedSats: number;
  bchGiftedUsd: number | null;
  passOnEnvelopes: number;
  generatedAt: string;
}

// ------------------------------------------------------------------ wallet activity (Phase 9)

/** P2PKH locking bytecode (hex). The site sends the connected wallet's own derived addresses. */
const P2pkhLockingSchema = z.string().regex(/^76a914[0-9a-f]{40}88ac$/, 'P2PKH locking bytecode hex');

export const WalletActivityRequestSchema = z
  .object({ lockingBytecodes: z.array(P2pkhLockingSchema).min(1).max(40) })
  .strict();
export type WalletActivityRequest = z.infer<typeof WalletActivityRequestSchema>;

/** An envelope the wallet sent (funded ones only). Never includes the link secret: the server never had it. */
export interface WalletSentEnvelope {
  id: string;
  slug: string;
  status: string;
  mode: Mode;
  theme: Theme;
  message: string | null;
  total: { sats: number; usd: number | null };
  remaining: { sats: number; usd: number | null };
  shares: { total: number; claimed: number; left: number };
  refundedSats: number;
  expiry: number;
  createdAt: string;
  fundingTxid: string | null;
  /** Set when this envelope was a pass-on of a share the wallet had claimed. */
  parentEnvelopeId: string | null;
}

/** A share the wallet claimed. */
export interface WalletClaim {
  envelopeId: string;
  slug: string;
  theme: Theme;
  mode: Mode;
  message: string | null;
  amountSats: number;
  amountUsd: number | null;
  claimTxid: string | null;
  recipientAddress: string;
  isNewWallet: boolean | null;
  seal: { imageUrl: string } | null;
  at: string;
  /** The envelope this wallet made from it with Pass it on, if any. */
  passedOn: { id: string; slug: string } | null;
}

export interface WalletActivityResponse {
  sent: WalletSentEnvelope[];
  claimed: WalletClaim[];
  totals: { sentCount: number; sentSats: number; claimedCount: number; claimedSats: number; passOnCount: number };
}
