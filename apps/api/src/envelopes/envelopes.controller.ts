import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp } from '../claims/claims.controller.js';
import { CONFIG, type AppConfig } from '../config/config.js';
import { EnvelopesService } from './envelopes.service.js';
import { upgradeLegacyEnvelopeBody, withLegacySealAlias } from '../common/legacy.js';

@Controller()
export class EnvelopesController {
  constructor(
    @Inject(EnvelopesService) private readonly envelopes: EnvelopesService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('envelopes')
  @HttpCode(201)
  create(@Body() body: unknown, @Req() req: Request) {
    return this.envelopes.create(upgradeLegacyEnvelopeBody(body), clientIp(req, this.config.CLIENT_IP_HEADER));
  }

  @Post('envelopes/:id/funded')
  @HttpCode(200)
  funded(@Param('id') id: string, @Body() body: unknown) {
    return this.envelopes.markFunded(id, body);
  }

  @Get('envelopes/:id')
  async byId(@Param('id') id: string) {
    return withLegacySealAlias(await this.envelopes.publicView({ id }));
  }

  @Get('envelopes/:id/tree')
  tree(@Param('id') id: string) {
    return this.envelopes.tree(id);
  }

  @Get('s/:slug')
  async bySlug(@Param('slug') slug: string) {
    return withLegacySealAlias(await this.envelopes.publicView({ slug }));
  }
}
