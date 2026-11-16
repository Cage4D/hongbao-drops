import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { EnvelopesService } from './envelopes.service.js';

@Controller()
export class EnvelopesController {
  constructor(@Inject(EnvelopesService) private readonly envelopes: EnvelopesService) {}

  @Post('envelopes')
  @HttpCode(201)
  create(@Body() body: unknown) {
    return this.envelopes.create(body);
  }

  @Post('envelopes/:id/funded')
  @HttpCode(200)
  funded(@Param('id') id: string, @Body() body: unknown) {
    return this.envelopes.markFunded(id, body);
  }

  @Get('envelopes/:id')
  byId(@Param('id') id: string) {
    return this.envelopes.publicView({ id });
  }

  @Get('envelopes/:id/tree')
  tree(@Param('id') id: string) {
    return this.envelopes.tree(id);
  }

  @Get('s/:slug')
  bySlug(@Param('slug') slug: string) {
    return this.envelopes.publicView({ slug });
  }
}
