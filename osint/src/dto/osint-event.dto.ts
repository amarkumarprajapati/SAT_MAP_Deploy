import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsObject,
  IsUUID,
  Min,
  Max,
} from 'class-validator';

export enum EventType {
  TROOP_MOVEMENT = 'TROOP_MOVEMENT',
  CYBER_ATTACK = 'CYBER_ATTACK',
  POLITICAL = 'POLITICAL',
  NATURAL_DISASTER = 'NATURAL_DISASTER',
  MILITARY_BUILDUP = 'MILITARY_BUILDUP',
  INTEL_ALERT = 'INTEL_ALERT',
  OTHER = 'OTHER',
}

export enum ConfidenceLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export class CreateOsintEventDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
  
  @IsOptional()
  @IsString()
  webpage_blob?: string;

  @IsOptional()
  @IsEnum(EventType)
  event_type?: EventType;

  @IsOptional()
  @IsString()
  source_link?: string;

  @IsOptional()
  @IsEnum(ConfidenceLevel)
  confidence_level?: ConfidenceLevel;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsObject()
  raw_payload?: Record<string, any>;
}

export class OsintEventPayload {
  id: string;
  title: string;
  description: string;
  webpage_blob: string;
  event_type: EventType;
  source_link: string;
  confidence_level: ConfidenceLevel;
  country: string;
  latitude: number | null;
  longitude: number | null;
  raw_payload: Record<string, any>;
  created_at: string;
}
