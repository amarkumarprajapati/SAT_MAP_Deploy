import { Module } from '@nestjs/common';
import { OsintController } from './osint.controller';
import { OsintService } from './osint.service';
import { GeocodingService } from '../geocoding/geocoding.service';

@Module({
  imports: [],
  controllers: [OsintController],
  providers: [OsintService, GeocodingService],
})
export class OsintModule {}
