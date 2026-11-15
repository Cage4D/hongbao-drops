// Shared types and Zod schemas used by the API and the frontend session.
// Phase 0: only the enums every later phase agrees on. Request/response schemas land in Phase 3.
import { z } from 'zod';

export const NetworkSchema = z.enum(['CHIPNET', 'MAINNET']);
export type Network = z.infer<typeof NetworkSchema>;

export const ModeSchema = z.enum(['EQUAL', 'LUCKY', 'QUIZ']);
export type Mode = z.infer<typeof ModeSchema>;

export const ThemeSchema = z.enum(['classic-red', 'gold', 'christmas', 'lunar']);
export type Theme = z.infer<typeof ThemeSchema>;
