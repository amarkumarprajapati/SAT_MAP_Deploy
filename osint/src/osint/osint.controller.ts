import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Sse,
  ValidationPipe,
} from '@nestjs/common';
import { OsintService } from './osint.service';
import { CreateOsintEventDto } from '../dto/osint-event.dto';
import { NewsFullQueryDto, NewsSearchDto } from '../dto/news-search.dto';

@Controller('osint')
export class OsintController {
  constructor(private readonly osintService: OsintService) {}

  @Sse('news/stream')
  streamNews() {
    return this.osintService.getNewsStream();
  }

  @Get('news')
  async searchNews(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: NewsSearchDto,
  ) {
    return this.osintService.searchNews(query.q, query.limit ?? 10);
  }


  @Get('news/full')
  async getFullArticle(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: NewsFullQueryDto,
  ) {
    return this.osintService.getFullArticle(query.id, query.url);
  }


  @Post('news/publish')
  @HttpCode(HttpStatus.OK)
  async searchAndPublish(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: NewsSearchDto,
  ) {
    return this.osintService.searchAndPublish(dto.q, dto.limit ?? 5);
  }

  @Post('news/ingest')
  @HttpCode(HttpStatus.OK)
  async ingestNow(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: NewsSearchDto,
  ) {
    return this.osintService.ingestLatest(dto.q, dto.limit ?? 5);
  }


  @Post('publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateOsintEventDto,
  ) {
    return this.osintService.publishEvent(dto);
  }

 
  @Get('status')
  getStatus() {
    return this.osintService.getStatus();
  }


  @Get('schema')
  getSchema() {
    return {
      description: 'Expected OSINT event payload for JCC Backend',
      poll_interval_ms: 30_000,
      properties: {
        id: 'UUID string (auto-generated if omitted)',
        title: 'string (required)',
        description: 'string (distinct from title)',
        webpage_blob: 'string (full HTML for in-app viewing)',
        event_type:
          'TROOP_MOVEMENT | CYBER_ATTACK | POLITICAL | NATURAL_DISASTER | MILITARY_BUILDUP | INTEL_ALERT | OTHER',
        source_link: 'string (URL)',
        confidence_level: 'LOW | MEDIUM | HIGH',
        country: 'string',
        latitude: 'number | null (-90 to 90)',
        longitude: 'number | null (-180 to 180)',
        raw_payload: 'object (any extra scraped metadata)',
        created_at: 'ISO-8601 timestamp (auto-added)',
      },
      example: {
        id: 'a3b2c1d0-1234-5678-abcd-ef1234567890',
        title: 'Unusual troop movements detected near Eastern border',
        description: 'Satellite imagery shows deployment of 3 new armored columns.',
        webpage_blob:
          '<!DOCTYPE html><html><head><title>Scraped News Report</title></head><body><h1>Troops Deployment Details</h1><p>Full article text content goes here...</p></body></html>',
        event_type: 'TROOP_MOVEMENT',
        source_link: 'https://liveuamap.com',
        confidence_level: 'HIGH',
        country: 'Ukraine',
        latitude: 48.3794,
        longitude: 38.0264,
        raw_payload: {
          scraped_at: '2026-08-04T06:00:00Z',
          engine: 'Custom-OSINT-Ingestor',
        },
      },
    };
  }
}
