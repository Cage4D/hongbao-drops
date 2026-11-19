import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ClaimsService } from './claims.service.js';
import { CONFIG, type AppConfig } from '../config/config.js';

/**
 * Client IP for rate limits and farm flags. Only a header our host sets (and overwrites) can be
 * trusted, so it's configured (CLIENT_IP_HEADER, e.g. Vercel's x-vercel-forwarded-for); without it
 * we use the socket address. Never trust a client-supplied X-Forwarded-For (review #14).
 */
export function clientIp(req: Request, header: string | undefined): string {
  if (header) {
    const v = req.headers[header.toLowerCase()];
    const first = (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || 'unknown';
}

@Controller()
export class ClaimsController {
  constructor(
    @Inject(ClaimsService) private readonly claims: ClaimsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('envelopes/:id/holds')
  @HttpCode(201)
  hold(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.claims.hold(id, body, clientIp(req, this.config.CLIENT_IP_HEADER));
  }

  @Post('envelopes/:id/claims')
  @HttpCode(201)
  claim(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.claims.claim(id, body, clientIp(req, this.config.CLIENT_IP_HEADER));
  }

  @Post('claims/:id/broadcast')
  @HttpCode(200)
  async broadcast(@Param('id') id: string, @Body() body: unknown) {
    return this.claims.broadcast(id, body);
  }
}
