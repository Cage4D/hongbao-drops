import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ClaimsService } from './claims.service.js';

/** Client IP: first X-Forwarded-For hop (set by Vercel's edge), else the socket address. */
export function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return first || req.ip || req.socket.remoteAddress || 'unknown';
}

@Controller()
export class ClaimsController {
  constructor(@Inject(ClaimsService) private readonly claims: ClaimsService) {}

  @Post('envelopes/:id/holds')
  @HttpCode(201)
  hold(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.claims.hold(id, body, clientIp(req));
  }

  @Post('envelopes/:id/claims')
  @HttpCode(201)
  claim(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.claims.claim(id, body, clientIp(req));
  }

  @Post('claims/:id/broadcast')
  @HttpCode(200)
  broadcast(@Param('id') id: string, @Body() body: unknown) {
    return this.claims.broadcast(id, body);
  }
}
