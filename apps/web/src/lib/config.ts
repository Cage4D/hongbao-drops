export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'https://hongbao-drops-api.vercel.app';
/** "Try it" demo envelope link (with its #k= fragment). Empty until the operator sets one. */
export const DEMO_URL = (import.meta.env.VITE_DEMO_URL as string | undefined) || '';
export const PAYTACA_URL = 'https://www.paytaca.com';
