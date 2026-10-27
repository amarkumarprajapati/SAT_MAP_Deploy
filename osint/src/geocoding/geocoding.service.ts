import { Injectable, Logger } from '@nestjs/common';

export type GeocodedLocation = {
  location: string;
  country: string;
  latitude: number;
  longitude: number;
};

type NominatimHit = {
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
  importance?: number;
  addresstype?: string;
  name?: string;
  address?: {
    country?: string;
    city?: string;
    town?: string;
    state?: string;
    village?: string;
  };
};

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly cache = new Map<string, GeocodedLocation | null>();
  private lastNominatimAt = 0;

  async resolveForArticle(
    title: string,
    description: string,
  ): Promise<GeocodedLocation | null> {
    const candidates = this.extractPlaceCandidates(title, description);
    this.logger.debug(
      `Place candidates for "${title}": ${candidates.join(', ') || '(none)'}`,
    );

    let best: GeocodedLocation | null = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      const scored = await this.geocodeNominatim(candidate);
      if (scored && scored.score > bestScore) {
        bestScore = scored.score;
        best = scored.location;
        if (scored.score >= 0.85) break;
      }
    }

    return best;
  }

  private extractPlaceCandidates(title: string, description: string): string[] {
    const cleanedTitle = title.replace(/\s+[-–—]\s+[^-–—]+$/, '').trim();
    const text = `${cleanedTitle} ${description}`.replace(/[‘’‚‛']/g, "'");

    const possessives: string[] = [];
    const places: string[] = [];

    for (const m of text.matchAll(/\b([A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+)*)'s\b/g)) {
      if (!this.isNoiseToken(m[1])) possessives.push(m[1]);
    }

    for (const m of text.matchAll(
      /\b(?:New|Los|San|Hong|South|North|United|Saudi|Sri)\s+[A-Z][a-zA-Z]+\b/g,
    )) {
      places.push(m[0]);
    }

    for (const m of text.matchAll(/\b([A-Z][a-zA-Z]{3,})\b/g)) {
      if (!this.isNoiseToken(m[1])) places.push(m[1]);
    }

    return [...new Set([...possessives, ...places])].slice(0, 5);
  }

  private isNoiseToken(phrase: string): boolean {
    const noise = new Set([
      'the', 'why', 'how', 'what', 'when', 'where', 'who', 'this', 'that',
      'these', 'those', 'their', 'there', 'here', 'after', 'before', 'against',
      'near', 'over', 'under', 'into', 'from', 'with', 'about', 'between',
      'during', 'while', 'says', 'said', 'asks', 'ask', 'enters', 'enter',
      'sales', 'market', 'fund', 'youth', 'anger', 'challenge', 'biggest',
      'record', 'prime', 'time', 'machine', 'propaganda', 'retail', 'push',
      'widening', 'billion', 'exposed', 'planned', 'speech', 'clarify',
      'stance', 'apple', 'live', 'update', 'updates', 'breaking', 'news',
      'report', 'analysis', 'opinion', 'exclusive', 'video', 'photos',
      'watch', 'read', 'modi', 'hasina', 'trump', 'biden', 'bbc', 'reuters',
      'bloomberg', 'guardian', 'cnn', 'axios', 'yahoo', 'meets', 'poised',
      'confirmation', 'arrest', 'connection', 'officials', 'flames', 'wildfire',
      'white', 'house', 'pool', 'case', 'reflecting', 'pirro', 'blanche',
      'choked', 'kills', 'todd', 'wins', 'despite', 'target', 'warship',
      'imposing', 'different', 'route', 'top', 'blackrock',
    ]);
    return phrase.toLowerCase().split(/\s+/).every((p) => noise.has(p) || p.length <= 2);
  }

  private async geocodeNominatim(
    query: string,
  ): Promise<{ location: GeocodedLocation; score: number } | null> {
    const key = query.trim().toLowerCase();
    if (!key || key.length < 2) return null;

    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (!cached) return null;
      return { location: cached, score: 0.75 };
    }

    try {
      await this.throttleNominatim();
      const url =
        `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(query)}` +
        `&format=json&limit=3&addressdetails=1`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'NestJS-OSINT-V1/1.0 (osint-producer)',
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        this.logger.warn(`Nominatim HTTP ${res.status} for "${query}"`);
        this.cache.set(key, null);
        return null;
      }

      const data = (await res.json()) as NominatimHit[];
      const ranked = (data || [])
        .map((hit) => ({ hit, score: this.scoreHit(hit, query) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (!ranked.length) {
        this.cache.set(key, null);
        return null;
      }

      const { hit, score } = ranked[0];
      const latitude = Number(hit.lat);
      const longitude = Number(hit.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        this.cache.set(key, null);
        return null;
      }

      const locationName =
        hit.address?.city ||
        hit.address?.town ||
        hit.address?.village ||
        hit.address?.state ||
        hit.name ||
        hit.display_name.split(',')[0].trim();

      const country =
        hit.address?.country ||
        hit.display_name.split(',').pop()?.trim() ||
        '';

      const location: GeocodedLocation = {
        location: locationName,
        country,
        latitude,
        longitude,
      };

      this.cache.set(key, location);
      this.logger.log(
        `Geocoded "${query}" → ${latitude}, ${longitude} (${locationName})`,
      );
      return { location, score };
    } catch (err) {
      this.logger.warn(
        `Nominatim failed for "${query}": ${(err as Error).message}`,
      );
      this.cache.set(key, null);
      return null;
    }
  }

  private scoreHit(hit: NominatimHit, query: string): number {
    const addressType = (hit.addresstype || hit.type || '').toLowerCase();
    const importance = hit.importance ?? 0;

    const tier: Record<string, number> = {
      country: 1,
      continent: 0.95,
      state: 0.85,
      province: 0.85,
      city: 0.8,
      town: 0.75,
      county: 0.65,
      village: 0.45,
      municipality: 0.4,
      administrative: 0.5,
      city_district: 0.2,
      suburb: 0.2,
    };

    const typeScore = tier[addressType];
    if (
      typeScore === undefined &&
      !['place', 'boundary'].includes(hit.class || '')
    ) {
      return 0;
    }

    const base = typeScore ?? 0.35;
    if (importance < 0.3 && base < 0.75) return 0;

    const name = (hit.name || '').toLowerCase();
    const q = query.toLowerCase();
    const nameBonus = name === q ? 0.2 : name.includes(q) ? 0.1 : 0;

    return base + importance * 0.5 + nameBonus;
  }

  private async throttleNominatim(): Promise<void> {
    const elapsed = Date.now() - this.lastNominatimAt;
    if (elapsed < 1100) {
      await new Promise((r) => setTimeout(r, 1100 - elapsed));
    }
    this.lastNominatimAt = Date.now();
  }
}
