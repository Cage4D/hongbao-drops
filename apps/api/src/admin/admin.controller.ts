import { Body, Controller, Get, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { AdminService } from './admin.service.js';

@Controller('admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get('budget')
  budget(@Headers('authorization') auth?: string) {
    this.admin.authorize(auth);
    return this.admin.budget();
  }

  @Get('demo')
  demo(@Headers('authorization') auth?: string) {
    this.admin.authorize(auth);
    return this.admin.demoStatus();
  }

  @Post('demo/refill')
  @HttpCode(200)
  refill(@Headers('authorization') auth: string | undefined, @Body() body: unknown) {
    this.admin.authorize(auth);
    return this.admin.refill(body);
  }
}

/** Public, no token: the stable /demo link asks which envelope to open. */
@Controller('demo')
export class DemoController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  current() {
    return this.admin.currentDemo();
  }
}
