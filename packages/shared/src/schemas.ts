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
    withStamps: z.boolean().default(true),
    /** Required when stamps are on: txid of the vout-0 outpoint the funding tx spends as input 0. */
    stampCategory: TxidSchema.optional(),
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
  /** Funding outputs in order, excluding change: build exactly this (stamps carry their NFT). */
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
  withStamps: boolean;
  stamp: { category: string; imageUrl: string; alt: string } | null;
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
