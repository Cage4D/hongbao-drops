// NestJS API lands in Phase 3 (spec §8). Phase 0 only proves the workspace links resolve.
import { NetworkSchema } from '@hongbao/shared';

export const DEFAULT_NETWORK = NetworkSchema.parse(process.env.NETWORK ?? 'CHIPNET');
