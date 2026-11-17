// GET /envelopes/:id/events — Server-Sent Events.
// Vercel cuts function responses at 300 s, so each stream ends after ~280 s with a `retry` hint;
// EventSource reconnects automatically and resumes from Last-Event-ID (events are in Postgres).
//
// Load (review-2 P1-9): every open stream polls Postgres, so opening is rate-limited per IP
// (LIMITS.stream per 10 min: a normal viewer reconnects ~2× per 10 min, so this allows ~14 open
// streams per IP), and the poll interval is 2 s. A DB error mid-stream ends the stream cleanly
// (headers are already sent, so the JSON error filter can't run); EventSource then reconnects.
import { Controller, Get, Inject, Logger, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppError } from '../common/app-error.js';
import { LIMITS, RateLimitService } from '../ratelimit/rate-limit.service.js';
import { clientIp } from '../claims/claims.controller.js';
import { EventsService } from './events.service.js';

const POLL_MS = 2_000;
const PING_MS = 15_000;
const MAX_STREAM_MS = 280_000;

@Controller()
export class EventsController {
  private readonly log = new Logger('Events');

  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RateLimitService) private readonly rate: RateLimitService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('envelopes/:id/events')
  async stream(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
    @Query('after') afterQ?: string,
    @Query('maxSeconds') maxSecondsQ?: string,
  ) {
    const exists = await this.db.envelope.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new AppError('NOT_FOUND');
    await this.rate.hit(`sse:${this.rate.ipHash(clientIp(req, this.config.CLIENT_IP_HEADER))}`, LIMITS.stream);

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 1000\n\n');

    const send = (e: { id: bigint; type: string; payload: unknown; createdAt: Date }) =>
      res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify({ ...(e.payload as object), at: e.createdAt.toISOString() })}\n\n`);

    try {
      await this.pump(id, req, res, send, afterQ, maxSecondsQ);
    } catch (e) {
      this.log.warn(`stream ${id} ended on error: ${(e as Error).message}`);
    }
    res.end();
  }

  private async pump(
    id: string,
    req: Request,
    res: Response,
    send: (e: { id: bigint; type: string; payload: unknown; createdAt: Date }) => void,
    afterQ?: string,
    maxSecondsQ?: string,
  ) {
    const resume = req.header('last-event-id') ?? afterQ;
    let cursor = 0n;
    if (resume && /^\d+$/.test(resume)) {
      cursor = BigInt(resume);
    } else {
      for (const e of await this.events.recent(id)) {
        send(e);
        cursor = e.id;
      }
    }

    const maxMs = Math.min(MAX_STREAM_MS, Number(maxSecondsQ ?? Infinity) * 1000 || MAX_STREAM_MS);
    const started = Date.now();
    let lastWrite = Date.now();
    let open = true;
    req.on('close', () => (open = false));

    while (open && Date.now() - started < maxMs) {
      const rows = await this.events.after(id, cursor);
      for (const e of rows) {
        send(e);
        cursor = e.id;
        lastWrite = Date.now();
      }
      if (Date.now() - lastWrite >= PING_MS) {
        res.write(': ping\n\n');
        lastWrite = Date.now();
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}
