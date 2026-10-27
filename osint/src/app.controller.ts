import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): object {
    return {
      service: 'OSINT Producer (NestJS)',
      version: '1.0.0',
      endpoints: {
        publish: 'POST /osint/publish',
        status: 'GET /osint/status',
        schema: 'GET /osint/schema',
      },
    };
  }

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
