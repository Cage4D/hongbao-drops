// Envelope events (spec §8.5 SSE: claimed, held, refunded, exhausted, passedOn), stored in Postgres
// so any serverless instance can stream them and clients can resume with Last-Event-ID.
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export type EventType = 'claimed' | 'held' | 'refunded' | 'exhausted' | 'passedOn';
type Db = Pick<Prisma.TransactionClient, 'event'>;

@Injectable()
export class EventsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  /** Pass a transaction client to emit atomically with the state change it describes. */
  emit(envelopeId: string, type: EventType, payload: Record<string, unknown>, db: Db = this.db) {
    return db.event.create({ data: { envelopeId, type, payload: payload as Prisma.InputJsonValue } });
  }

  after(envelopeId: string, afterId: bigint, limit = 100) {
    return this.db.event.findMany({ where: { envelopeId, id: { gt: afterId } }, orderBy: { id: 'asc' }, take: limit });
  }

  /** The most recent `n` events (oldest first), for a client connecting without a cursor. */
  async recent(envelopeId: string, n = 10) {
    const rows = await this.db.event.findMany({ where: { envelopeId }, orderBy: { id: 'desc' }, take: n });
    return rows.reverse();
  }
}
