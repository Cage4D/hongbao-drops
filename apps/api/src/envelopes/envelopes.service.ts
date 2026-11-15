import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  binToHex,
  cashAddressToLockingBytecode,
  decodeTransaction,
  hexToBin,
  sha256,
} from '@bitauth/libauth';
import { ElectrumNetworkProvider } from 'cashscript';
import {
  DEFAULT_MAX_FEE,
  MIN_SHARE_SATS_NO_STAMP,
  MIN_SHARE_SATS_WITH_STAMP,
  equalSplit,
  fundingOutputs,
  hongbaoContract,
  luckySplit,
} from '@hongbao/contract';
import {
  CreateEnvelopeRequestSchema,
  FundedRequestSchema,
  type CreateEnvelopeResponse,
  type FundedResponse,
  type PublicEnvelopeView,
  type RequiredOutput,
  type Theme,
} from '@hongbao/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KeysService } from '../keys/keys.service.js';
import { ChainService } from '../chain/chain.service.js';
import { PriceService } from '../price/price.service.js';
import { BudgetService } from '../budget/budget.service.js';
import { AppError } from '../common/app-error.js';
import { validate } from '../common/validate.js';
import { toNum } from '../common/bigint.js';
import { buildBcmrRegistry } from './bcmr.js';
import { randomSlug } from './slug.js';
import { verifyFundingTx } from './funding-verifier.js';
import type { Envelope, Prisma, Share } from '../generated/prisma/client.js';

/** Quiz answers are compared after trim, lowercase and collapsing whitespace (spec §8.2). */
export const normalizeAnswer = (a: string) => a.trim().toLowerCase().replace(/\s+/g, ' ');
export const hashAnswer = (salt: string, answer: string) =>
  binToHex(sha256.hash(new TextEncoder().encode(salt + normalizeAnswer(answer))));

const truncateAddress = (a: string) => {
  const [prefix, body = a] = a.includes(':') ? a.split(':') : ['', a];
  return `${prefix ? prefix + ':' : ''}${body.slice(0, 4)}…${body.slice(-4)}`;
};

@Injectable()
export class EnvelopesService {
  private readonly log = new Logger('Envelopes');
  /** Unconnected provider: only used to derive contract addresses with the right prefix. */
  private readonly addressProvider: ElectrumNetworkProvider;
  private readonly treasuryLockingBytecode: string;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(PriceService) private readonly price: PriceService,
    @Inject(BudgetService) private readonly budget: BudgetService,
  ) {
    this.addressProvider = new ElectrumNetworkProvider(config.NETWORK === 'MAINNET' ? 'mainnet' : 'chipnet', {
      manualConnectionManagement: true,
    });
    this.treasuryLockingBytecode = binToHex(this.lockingBytecodeOf(config.TREASURY_ADDRESS, 'TREASURY_ADDRESS'));
  }

  private lockingBytecodeOf(address: string, field: string): Uint8Array {
    const want = this.config.NETWORK === 'MAINNET' ? 'bitcoincash:' : 'bchtest:';
    const r = cashAddressToLockingBytecode(address);
    if (typeof r === 'string' || !address.startsWith(want)) {
      throw new AppError('INVALID_REQUEST', { issues: [{ path: field, message: `must be a ${want} cashaddr` }] });
    }
    return r.bytecode;
  }

  private contractFor(e: Pick<Envelope, 'linkPk' | 'gatePk' | 'refundLockingBytecode' | 'expiry' | 'maxFee'>) {
    return hongbaoContract(
      {
        linkPk: hexToBin(e.linkPk),
        gatePk: hexToBin(e.gatePk),
        refundLockingBytecode: hexToBin(e.refundLockingBytecode),
        expiry: e.expiry,
        maxFee: BigInt(e.maxFee),
      },
      this.addressProvider,
    );
  }

  // ---------------------------------------------------------------- POST /envelopes
  async create(body: unknown): Promise<CreateEnvelopeResponse> {
    const req = validate(CreateEnvelopeRequestSchema, body);
    const c = this.config;
    const bad = (path: string, message: string) => new AppError('INVALID_REQUEST', { issues: [{ path, message }] });

    const refundLockingBytecode = this.lockingBytecodeOf(req.senderAddress, 'senderAddress');
    const withStamps = req.withStamps && c.ENABLE_STAMPS;
    if (withStamps && !req.stampCategory) throw bad('stampCategory', 'required when withStamps is true');

    const now = Math.floor(Date.now() / 1000);
    if (req.expiry < now + c.MIN_EXPIRY_SECONDS) throw bad('expiry', `must be at least ${c.MIN_EXPIRY_SECONDS}s from now`);
    if (req.expiry > now + c.MAX_EXPIRY_SECONDS) throw bad('expiry', `must be at most ${c.MAX_EXPIRY_SECONDS}s from now`);

    const totalSats = BigInt(req.totalSats);
    const minShare = withStamps ? MIN_SHARE_SATS_WITH_STAMP : MIN_SHARE_SATS_NO_STAMP;
    if (totalSats < minShare * BigInt(req.shareCount)) {
      throw bad('totalSats', `must be at least ${minShare * BigInt(req.shareCount)} sats (${minShare} per share)`);
    }

    // Sponsored drop: valid token → 3% fee output required in the funding tx (spec §4).
    let feeBps = 0;
    let campaignId: string | null = null;
    let sponsorName: string | null = null;
    if (req.sponsorToken) {
      const tokenHash = binToHex(sha256.hash(new TextEncoder().encode(req.sponsorToken)));
      const sponsor = await this.db.sponsor.findUnique({ where: { adminToken: tokenHash } });
      if (!sponsor) throw new AppError('UNAUTHORIZED');
      if (req.campaignId) {
        const camp = await this.db.campaign.findFirst({ where: { id: req.campaignId, sponsorId: sponsor.id } });
        if (!camp) throw new AppError('UNAUTHORIZED');
        campaignId = camp.id;
      }
      feeBps = c.SPONSOR_FEE_BPS;
      sponsorName = sponsor.name;
    }
    const sponsorFeeSats = (totalSats * BigInt(feeBps) + 9_999n) / 10_000n; // ceil

    if (req.parentEnvelopeId) {
      const parent = await this.db.envelope.findUnique({ where: { id: req.parentEnvelopeId }, select: { id: true } });
      if (!parent) throw bad('parentEnvelopeId', 'unknown envelope');
    }
    if (c.NETWORK !== 'MAINNET' && req.shareCount > 127) throw bad('shareCount', 'max 127');
    await this.budget.assertCanCreate(totalSats, req.shareCount);

    const quizSalt = req.quiz ? binToHex(randomBytes(16)) : null;
    const quizAnswerHashes = req.quiz ? req.quiz.answers.map((a) => hashAnswer(quizSalt!, a)) : [];

    const created = await this.db.$transaction(async (tx) => {
      // Insert first to get the sequence number (gate key index), then fill in derived fields.
      let row: Envelope | undefined;
      for (let attempt = 0; !row; attempt++) {
        try {
          row = await tx.envelope.create({
            data: {
              slug: randomSlug(),
              network: c.NETWORK,
              senderAddress: req.senderAddress,
              refundLockingBytecode: binToHex(refundLockingBytecode),
              linkPk: req.linkPk,
              gatePk: '',
              contractAddress: '',
              contractLockingBytecode: '',
              expiry: req.expiry,
              maxFee: Number(DEFAULT_MAX_FEE),
              mode: req.mode,
              quizQuestion: req.quiz?.question ?? null,
              quizAnswerHashes,
              quizSalt,
              withStamps,
              stampCategory: withStamps ? req.stampCategory! : null,
              totalSats,
              shareCount: req.shareCount,
              message: req.message || null,
              theme: req.theme,
              campaignId,
              feeBps,
              sponsorFeeSats,
              parentEnvelopeId: req.parentEnvelopeId ?? null,
            },
          });
        } catch (e) {
          if (attempt < 5 && (e as { code?: string }).code === 'P2002') continue; // slug collision
          throw e;
        }
      }
      const gatePk = binToHex(this.keys.gatePublicKey(row.seq));
      const contract = this.contractFor({ ...row, gatePk });
      const bcmr = withStamps
        ? buildBcmrRegistry({
            category: req.stampCategory!,
            envelopeSeq: row.seq,
            shareCount: req.shareCount,
            theme: req.theme,
            message: req.message,
            sponsorName,
            publicApiUrl: c.PUBLIC_API_URL,
            createdAt: row.createdAt,
          })
        : null;
      return tx.envelope.update({
        where: { id: row.id },
        data: {
          gatePk,
          contractAddress: contract.tokenAddress,
          contractLockingBytecode: contract.lockingBytecode,
          bcmrRegistry: bcmr?.json ?? null,
          bcmrHash: bcmr?.hash ?? null,
          bcmrUri: bcmr?.uri ?? null,
        },
      });
    });

    this.log.log(`created envelope ${created.id} seq=${created.seq} ${created.network} ${created.totalSats} sats × ${created.shareCount}`);
    return this.createResponse(created);
  }

  private createResponse(e: Envelope): CreateEnvelopeResponse {
    const contract = this.contractFor(e);
    const minShare = e.withStamps ? MIN_SHARE_SATS_WITH_STAMP : MIN_SHARE_SATS_NO_STAMP;
    const shareAmounts = e.mode === 'LUCKY' ? luckySplit(e.totalSats, e.shareCount, minShare) : equalSplit(e.totalSats, e.shareCount);
    const outputs = fundingOutputs({
      contract,
      shareAmounts,
      ...(e.withStamps && {
        stamps: {
          category: e.stampCategory!,
          envelopeSeq: e.seq,
          identityLockingBytecode: hexToBin(this.treasuryLockingBytecode),
          bcmr: { registryHash: hexToBin(e.bcmrHash!), uris: [e.bcmrUri!] },
        },
      }),
      ...(e.sponsorFeeSats > 0n && {
        sponsorFee: { lockingBytecode: hexToBin(this.treasuryLockingBytecode), amount: e.sponsorFeeSats },
      }),
    });
    const fundingTemplate: CreateEnvelopeResponse['fundingTemplate'] = outputs.map((o, i) => {
      const lb = typeof o.to === 'string' ? contract.lockingBytecode : binToHex(o.to);
      const purpose: RequiredOutput['purpose'] | 'SHARE' =
        lb === contract.lockingBytecode ? 'SHARE' : lb.startsWith('6a') ? 'BCMR' : e.withStamps && i === 0 ? 'IDENTITY' : 'SPONSOR_FEE';
      return {
        outputIndex: i,
        purpose,
        lockingBytecode: lb,
        sats: toNum(o.amount),
        ...(o.token && { token: { category: o.token.category, nftCommitment: o.token.nft!.commitment } }),
      };
    });
    return {
      id: e.id,
      slug: e.slug,
      network: e.network,
      contractAddress: e.contractAddress,
      contractLockingBytecode: e.contractLockingBytecode,
      gatePk: e.gatePk,
      constructorArgs: {
        linkPk: e.linkPk,
        gatePk: e.gatePk,
        refundLockingBytecode: e.refundLockingBytecode,
        expiry: e.expiry,
        maxFee: e.maxFee,
      },
      requiredOutputs: fundingTemplate
        .filter((o) => o.purpose !== 'SHARE')
        .map(({ purpose, lockingBytecode, sats, outputIndex }) => ({ purpose: purpose as RequiredOutput['purpose'], lockingBytecode, sats, outputIndex })),
      fundingTemplate,
      minShareSats: toNum(minShare),
      shareAmounts: shareAmounts.map(toNum),
      envelopeSeq: e.seq,
      ...(e.bcmrHash && { bcmr: { hash: e.bcmrHash, uri: e.bcmrUri! } }),
    };
  }

  // ---------------------------------------------------------------- POST /envelopes/:id/funded
  async markFunded(id: string, body: unknown): Promise<FundedResponse> {
    const { txid } = validate(FundedRequestSchema, body);
    const env = await this.db.envelope.findUnique({ where: { id }, include: { shares: { orderBy: { index: 'asc' } } } });
    if (!env) throw new AppError('NOT_FOUND');

    if (env.status !== 'PENDING_FUNDING') {
      if (env.fundingTxid === txid) return this.fundedResponse(env, env.shares); // idempotent retry
      throw new AppError('FUNDING_MISMATCH', { reasons: ['envelope is already funded by another transaction'] });
    }

    const raw = await this.chain.getRawTransaction(txid);
    if (!raw) throw new AppError('NOT_FUNDED', { reasons: ['transaction not found on the network yet'] });
    const tx = decodeTransaction(hexToBin(raw));
    if (typeof tx === 'string') throw new AppError('FUNDING_MISMATCH', { reasons: [`undecodable transaction: ${tx}`] });

    const result = verifyFundingTx(tx, {
      seq: env.seq,
      shareCount: env.shareCount,
      totalSats: env.totalSats,
      withStamps: env.withStamps,
      stampCategory: env.stampCategory,
      bcmrHash: env.bcmrHash,
      bcmrUri: env.bcmrUri,
      sponsorFeeSats: env.sponsorFeeSats,
      contractLockingBytecode: env.contractLockingBytecode,
      treasuryLockingBytecode: this.treasuryLockingBytecode,
    });
    if (!result.ok) {
      this.log.warn(`funding ${txid} rejected for ${env.id}: ${result.reasons.join('; ')}`);
      throw new AppError('FUNDING_MISMATCH', { reasons: result.reasons });
    }

    const price = this.config.NETWORK === 'MAINNET' ? await this.price.bchUsd() : null;
    const updated = await this.db.$transaction(async (db) => {
      // Conditional update: two concurrent /funded calls can't both activate.
      const n = await db.envelope.updateMany({
        where: { id: env.id, status: 'PENDING_FUNDING' },
        data: { status: 'ACTIVE', fundingTxid: txid, fundedAt: new Date() },
      });
      if (n.count === 0) throw new AppError('FUNDING_MISMATCH', { reasons: ['envelope was funded concurrently'] });
      await db.share.createMany({
        data: result.shares.map((s) => ({
          envelopeId: env.id,
          index: s.index,
          outpointTxid: txid,
          outpointIndex: s.vout,
          sats: s.sats,
          nftCommitment: s.nftCommitment,
        })),
      });
      if (this.config.NETWORK === 'MAINNET') {
        const ledger: Prisma.LedgerEntryCreateManyInput[] = [
          { kind: 'FUND', sats: env.totalSats, usd: this.price.toUsd(env.totalSats, price) ?? 0, txid, envelopeId: env.id },
        ];
        // Treasury is our own address, so the fee is recoverable (spec §10.1 rule 8).
        if (env.sponsorFeeSats > 0n) {
          ledger.push({ kind: 'FEE', sats: env.sponsorFeeSats, usd: this.price.toUsd(env.sponsorFeeSats, price) ?? 0, txid, envelopeId: env.id });
        }
        await db.ledgerEntry.createMany({ data: ledger });
      }
      return db.envelope.findUniqueOrThrow({ where: { id: env.id }, include: { shares: { orderBy: { index: 'asc' } } } });
    });
    this.log.log(`envelope ${env.id} ACTIVE via ${txid} (${result.shares.length} shares)`);
    return this.fundedResponse(updated, updated.shares);
  }

  private async fundedResponse(e: Envelope, shares: Share[]): Promise<FundedResponse> {
    const price = await this.price.bchUsd();
    return {
      status: e.status,
      shares: shares.map((s) => ({
        index: s.index,
        outpoint: `${s.outpointTxid}:${s.outpointIndex}`,
        sats: toNum(s.sats),
        usd: this.price.toUsd(s.sats, price),
        status: s.status,
        ...(s.nftCommitment && { nftCommitment: s.nftCommitment }),
      })),
    };
  }

  // ---------------------------------------------------------------- GET /envelopes/:id, /s/:slug
  async publicView(where: { id: string } | { slug: string }): Promise<PublicEnvelopeView> {
    const e = await this.db.envelope.findUnique({
      where,
      include: {
        shares: true,
        campaign: { include: { sponsor: true } },
        claims: { where: { status: { in: ['BROADCAST', 'CONFIRMED'] } }, orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!e) throw new AppError('NOT_FOUND');
    const price = await this.price.bchUsd();
    const now = Math.floor(Date.now() / 1000);

    const unclaimed = e.shares.filter((s) => ['AVAILABLE', 'HELD', 'RESERVED'].includes(s.status));
    const claimed = e.shares.filter((s) => s.status === 'CLAIMED').length;
    const remainingSats = e.status === 'PENDING_FUNDING' ? e.totalSats : unclaimed.reduce((a, s) => a + s.sats, 0n);
    let status: string = e.status;
    if (e.status === 'ACTIVE' && now >= e.expiry) status = 'EXPIRED';
    else if (e.status === 'ACTIVE' && unclaimed.length === 0) status = 'EXHAUSTED';

    const maxClaim = e.claims.reduce((m, c) => (c.amountSats && c.amountSats > m ? c.amountSats : m), 0n);
    const sponsor = e.campaign?.sponsor;
    const api = this.config.PUBLIC_API_URL.replace(/\/$/, '');
    return {
      id: e.id,
      slug: e.slug,
      network: e.network,
      status,
      mode: e.mode,
      theme: e.theme as Theme,
      message: e.message,
      quizQuestion: e.quizQuestion,
      sponsor: sponsor
        ? { name: sponsor.name, logoUrl: sponsor.logoUrl, brandColor: sponsor.brandColor, ctaLabel: sponsor.ctaLabel, ctaUrl: sponsor.ctaUrl }
        : null,
      total: { sats: toNum(e.totalSats), usd: this.price.toUsd(e.totalSats, price) },
      remaining: { sats: toNum(remainingSats), usd: this.price.toUsd(remainingSats, price) },
      shares: { total: e.shareCount, claimed, left: e.status === 'PENDING_FUNDING' ? e.shareCount : unclaimed.length },
      expiry: e.expiry,
      secondsLeft: Math.max(0, e.expiry - now),
      withStamps: e.withStamps,
      stamp: e.stampCategory
        ? {
            category: e.stampCategory,
            imageUrl: `${api}/stamps/${e.stampCategory}/collection.svg`,
            alt: `Hongbao stamp: a ${e.theme.replace('-', ' ')} red envelope${sponsor ? ` from ${sponsor.name}` : ''}`,
          }
        : null,
      recentClaims: e.claims.map((c) => ({
        address: truncateAddress(c.recipientAddress),
        sats: toNum(c.amountSats ?? 0n),
        usd: this.price.toUsd(c.amountSats ?? 0n, price),
        luckiest: e.mode === 'LUCKY' && c.amountSats !== null && c.amountSats === maxClaim && maxClaim > 0n,
        isNewWallet: c.isNewWallet,
        at: c.createdAt.toISOString(),
      })),
      fundingTxid: e.fundingTxid,
      parentEnvelopeId: e.parentEnvelopeId,
    };
  }
}
