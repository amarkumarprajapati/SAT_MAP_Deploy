import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class NewsSearchDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}


export class NewsFullQueryDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  url?: string;
}

export class NewsArticleDto {
  id: string;
  title: string;
  description: string;
  link: string;
  source: string;
  category: string;
  published_at: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}
