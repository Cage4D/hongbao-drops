// Thin fetch wrapper over the Hongbao API. Errors are thrown as ApiError with the API's own
// human-written message, which the UI shows as-is (handoff §8).
import type {
  BroadcastResponse,
  CampaignStats,
  ClaimApproval,
  ClaimRequest,
  CreateCampaignResponse,
  CreateEnvelopeRequest,
  CreateEnvelopeResponse,
  CreateSponsorRequest,
  CreateSponsorResponse,
  ErrorCode,
  FundedResponse,
  GlobalStats,
  HealthResponse,
  HoldResponse,
  PublicCampaignStats,
  PublicEnvelopeView,
  TreeResponse,
  WalletActivityResponse,
} from '@hongbao/shared';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode | 'NETWORK',
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get reasons(): string[] {
    return Array.isArray(this.extra.reasons) ? (this.extra.reasons as string[]) : [];
  }
  get issues(): { path: string; message: string }[] {
    return Array.isArray(this.extra.issues) ? (this.extra.issues as { path: string; message: string }[]) : [];
  }
  /** The most specific human message: `reason` when the API gives one (ALREADY_CLAIMED, RATE_LIMITED). */
  get display(): string {
    const reason = typeof this.extra.reason === 'string' ? this.extra.reason : null;
    return reason ?? this.message;
  }
}

async function req<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach Hongbao Drops right now. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { code: ErrorCode; message: string } & Record<string, unknown> } | null)?.error;
    if (err) {
      const { code, message, ...extra } = err;
      throw new ApiError(res.status, code, message, extra);
    }
    throw new ApiError(res.status, 'NETWORK', 'Something went wrong on our side. Please try again.');
  }
  return json as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry rule from the handoff: CHAIN_UNAVAILABLE → retry the same call after a few seconds. */
async function withChainRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHAIN_UNAVAILABLE' && i < tries - 1) {
        await sleep(3000);
        continue;
      }
      throw e;
    }
  }
}

export const api = {
  health: () => req<HealthResponse>('GET', '/health'),
  globalStats: () => req<GlobalStats>('GET', '/stats/global'),

  createEnvelope: (b: CreateEnvelopeRequest) => req<CreateEnvelopeResponse>('POST', '/envelopes', b),
  /** Retries while the API's server hasn't seen the tx yet (~30 s), per handoff §4.6. */
  async funded(id: string, txid: string): Promise<FundedResponse> {
    const deadline = Date.now() + 40_000;
    for (;;) {
      try {
        return await req<FundedResponse>('POST', `/envelopes/${id}/funded`, { txid });
      } catch (e) {
        const notYet = e instanceof ApiError && e.code === 'NOT_FUNDED' && e.reasons.some((r) => /not found on the network yet/i.test(r));
        const chain = e instanceof ApiError && e.code === 'CHAIN_UNAVAILABLE';
        if ((notYet || chain) && Date.now() < deadline) {
          await sleep(2000);
          continue;
        }
        throw e;
      }
    }
  },
  envelope: (id: string) => req<PublicEnvelopeView>('GET', `/envelopes/${encodeURIComponent(id)}`),
  bySlug: (slug: string) => req<PublicEnvelopeView>('GET', `/s/${encodeURIComponent(slug)}`),
  hold: (id: string, fingerprint?: string) => req<HoldResponse>('POST', `/envelopes/${id}/holds`, fingerprint ? { fingerprint } : {}),
  claim: (id: string, b: ClaimRequest) => withChainRetry(() => req<ClaimApproval>('POST', `/envelopes/${id}/claims`, b)),
  broadcast: (claimId: string, rawTx: string) => withChainRetry(() => req<BroadcastResponse>('POST', `/claims/${claimId}/broadcast`, { rawTx })),
  tree: (id: string) => req<TreeResponse>('GET', `/envelopes/${id}/tree`),
  ctaClick: (id: string) => req<void>('POST', `/envelopes/${id}/cta-click`),

  createSponsor: (b: CreateSponsorRequest) => req<CreateSponsorResponse>('POST', '/sponsors', b),
  createCampaign: (token: string, name: string) => req<CreateCampaignResponse>('POST', '/campaigns', { name }, token),
  campaignStats: (token: string, id: string) => req<CampaignStats>('GET', `/campaigns/${id}/stats`, undefined, token),
  campaignPublic: (id: string) => req<PublicCampaignStats>('GET', `/campaigns/${id}/public`),
  async campaignCsv(token: string, id: string): Promise<Blob> {
    const res = await fetch(`${API_URL}/campaigns/${id}/export.csv`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, 'UNAUTHORIZED', "Couldn't download the CSV. Check your sponsor key.");
    return res.blob();
  },
  /** Drops, claims and pass-ons of the connected wallet (its own derived P2PKH locking bytecodes). */
  walletActivity: (lockingBytecodes: string[]) => req<WalletActivityResponse>('POST', '/wallets/activity', { lockingBytecodes }),
  eventsUrl: (id: string) => `${API_URL}/envelopes/${id}/events`,
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'INVALID_REQUEST' && e.issues.length) return e.issues.map((i) => i.message).join(' · ');
    return e.display;
  }
  return e instanceof Error ? e.message : String(e);
}
