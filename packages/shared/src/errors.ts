// Error catalog (spec §8.6). The `message` is human copy the frontend can show as-is.
// Codes beyond the spec are marked "added".

export const ERROR_CATALOG = {
  ENVELOPE_EMPTY: { http: 410, message: 'Too slow! All the red envelopes have been grabbed.' },
  ENVELOPE_EXPIRED: { http: 410, message: 'This envelope has expired — the BCH went back to the sender.' },
  ALREADY_CLAIMED: { http: 409, message: "You've already grabbed one from this envelope 🧧" },
  WRONG_ANSWER: { http: 403, message: 'Not quite — try again.' },
  RATE_LIMITED: { http: 429, message: 'Slow down a little and try again in a minute.' },
  HOLD_EXPIRED: { http: 410, message: 'Your held share was released. Grab another if any are left!' },
  NOT_FUNDED: { http: 409, message: "This envelope isn't ready yet — ask the sender to finish sending it." },
  BUDGET_CAP: { http: 422, message: 'Demo limit reached for this envelope size.' },
  CHAIN_UNAVAILABLE: { http: 503, message: 'The network is busy — your share is still saved, try again shortly.' },
  // added: request body failed validation (details in `issues`)
  INVALID_REQUEST: { http: 400, message: "Something in that request doesn't look right." },
  // added: unknown envelope / slug / claim
  NOT_FOUND: { http: 404, message: "We couldn't find that envelope." },
  // added: the funding tx exists but doesn't match what this envelope requires (details in `reasons`)
  FUNDING_MISMATCH: { http: 422, message: "That transaction doesn't match this envelope, so it can't be opened." },
  // added: missing / wrong sponsor or admin token
  UNAUTHORIZED: { http: 401, message: "You don't have access to that." },
} as const satisfies Record<string, { http: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** Wire shape of every API error response. */
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string } & Record<string, unknown>;
}
