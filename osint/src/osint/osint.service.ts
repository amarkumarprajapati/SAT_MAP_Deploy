import {
  BadRequestException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import Parser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { Observable, BehaviorSubject, map } from 'rxjs';
import {
  CreateOsintEventDto,
  OsintEventPayload,
  EventType,
  ConfidenceLevel,
} from '../dto/osint-event.dto';
import { NewsArticleDto } from '../dto/news-search.dto';
import { GeocodingService } from '../geocoding/geocoding.service';
import { NEWS_FEEDS, NEWS_FEED_SOURCES } from './news-feeds';

type GoogleNewsItem = {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  isoDate?: string;
  content?: string;
  contentSnippet?: string;
  creator?: string;
  source?: string | { $?: string; _: string };
};


type StoredNewsRef = {
  id: string;
  googleId: string;
  link: string;
  title: string;
  description: string;
  source: string;
  category: string;
  published_at: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  touchedAt: number;
};

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

const BATCH_EXECUTE_URL =
  'https://news.google.com/_/DotsSplashUi/data/batchexecute';

@Injectable()
export class OsintService implements OnModuleInit {
  private readonly logger = new Logger(OsintService.name);
  private readonly rssParser = new Parser<Record<string, unknown>, GoogleNewsItem>({
    timeout: 15000,
    headers: {
      'User-Agent': 'NestJS-OSINT-V1/1.0',
    },
    customFields: {
      item: ['source'],
    },
  });


  private readonly byUuid = new Map<string, StoredNewsRef>();
  private readonly byGoogleId = new Map<string, string>();
  private readonly seenGoogleIds = new Set<string>();
  private pollRunning = false;
  private pollEnabled = true;
  private readonly events: OsintEventPayload[] = [];
  private readonly newsUpdates = new BehaviorSubject<NewsArticleDto[]>([]);

  constructor(
    private readonly geocodingService: GeocodingService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.pollEnabled =
      (this.configService.get<string>('OSINT_POLL_ENABLED') ?? 'true') !== 'false';
    this.logger.log(
      this.pollEnabled
        ? 'OSINT 30s poll loop enabled (latest news → backend API)'
        : 'OSINT poll loop disabled (OSINT_POLL_ENABLED=false)',
    );

    if (this.pollEnabled) {
      setTimeout(() => void this.pollLatestNews(), 5_000);
    }
  }


  @Interval(30_000)
  async pollLatestNews(): Promise<void> {
    if (!this.pollEnabled || this.pollRunning) return;
    this.pollRunning = true;
    try {
      const q = this.configService.get<string>('OSINT_POLL_QUERY')?.trim() || undefined;
      const configuredLimit = Number(this.configService.get<string>('OSINT_POLL_LIMIT') ?? 40);
      const limit = Number.isFinite(configuredLimit) ? configuredLimit : 40;
      const result = await this.searchNews(q, Math.max(1, Math.min(limit, 50)));
      this.logger.log(`News poll: fetched=${result.articles.length} articles from configured feeds`);
    } catch (err) {
      this.logger.error(`Poll cycle failed: ${(err as Error).message}`);
    } finally {
      this.pollRunning = false;
    }
  }


  async ingestLatest(
    query?: string,
    limit = 5,
  ): Promise<{
    success: boolean;
    fetched: number;
    published: number;
    skipped: number;
    failed: number;
    events: OsintEventPayload[];
  }> {
    const { articles } = await this.searchNews(query, limit);
    const events: OsintEventPayload[] = [];
    let published = 0;
    let skipped = 0;
    let failed = 0;

    for (const article of articles) {
      const ref = this.byUuid.get(article.id);
      const googleKey = ref?.googleId || article.link;
      if (this.seenGoogleIds.has(googleKey)) {
        skipped += 1;
        continue;
      }

      try {
        const event = await this.buildEventFromArticle(article);
        const result = await this.publishEvent(event);
        this.seenGoogleIds.add(googleKey);
        this.trimSeenCache();

        if (result.success && result.payload) {
          published += 1;
          events.push(result.payload);
        } else {
          failed += 1;
          if (result.payload) events.push(result.payload);
        }
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `Failed to ingest article ${article.id}: ${(err as Error).message}`,
        );
      }
    }

    return {
      success: failed === 0,
      fetched: articles.length,
      published,
      skipped,
      failed,
      events,
    };
  }


  async searchNews(
    query?: string,
    limit = 10,
  ): Promise<{
    success: boolean;
    total: number;
    articles: NewsArticleDto[];
  }> {
    const q = query?.trim().toLocaleLowerCase();
    this.logger.log(q ? `Searching configured news feeds for: "${query}"` : 'Fetching configured news feeds');

    const feedResults = await Promise.allSettled(
      NEWS_FEED_SOURCES.map(async (feedSource) => {
        const feed = await this.rssParser.parseURL(NEWS_FEEDS[feedSource.key]);
        return (feed.items || []).slice(0, 10).map((item) => {
          const rawTitle = item.title || 'Untitled';
          const title = this.cleanTitle(rawTitle);
          const description = this.cleanDescription(
            rawTitle,
            item.contentSnippet || item.content || '',
          );
          return this.registerArticle({
            title,
            description,
            link: item.link || feedSource.sourceUrl,
            source: feedSource.source,
            category: feedSource.category,
            published_at: item.isoDate || item.pubDate || new Date().toISOString(),
            country: 'Global',
            latitude: null,
            longitude: null,
          });
        });
      }),
    );

    const candidates = feedResults.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    const matched = q
      ? candidates.filter((article) =>
          `${article.title} ${article.description} ${article.source}`.toLocaleLowerCase().includes(q),
        )
      : candidates;
    const articles = matched
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
      .slice(0, limit);

    this.newsUpdates.next(articles);

    return {
      success: true,
      total: articles.length,
      articles,
    };
  }


  async getFullArticle(id?: string, url?: string): Promise<OsintEventPayload> {
    const resolved = this.resolveNewsRef(id, url);
    const newsUuid = resolved.uuid;
    const googleNewsUrl = resolved.googleNewsUrl;
    const fallbackUrl = resolved.directUrl;

    if (!googleNewsUrl && !fallbackUrl) {
      throw new BadRequestException(
        'Provide id from GET /osint/news (UUID) or url (article link)',
      );
    }

    this.logger.log(`Fetching full article: ${newsUuid || id || url}`);

    let sourceUrl: string;
    let googleUrl: string | null = null;

    if (googleNewsUrl) {
      googleUrl = googleNewsUrl;
      sourceUrl = await this.resolveGoogleNewsUrl(googleNewsUrl);
    } else {
      sourceUrl = fallbackUrl!;
    }

    if (!sourceUrl) {
      throw new NotFoundException('Could not resolve publisher URL for this article');
    }

    const pageHtml = await this.fetchPageHtml(sourceUrl);
    const parsed = this.extractReadableArticle(pageHtml, sourceUrl);

    if (!parsed || (!parsed.content && !parsed.textContent)) {
      throw new NotFoundException(
        'Could not extract article content from the publisher page',
      );
    }

    const stored = newsUuid ? this.byUuid.get(newsUuid) : undefined;
    const title = this.cleanTitle(parsed.title || stored?.title || 'Untitled');
    const bodyHtml = parsed.content || `<p>${this.escapeHtml(parsed.textContent || '')}</p>`;
    const text = (parsed.textContent || this.stripHtml(bodyHtml)).trim();
    const description = this.buildLongDescription(title, parsed.excerpt || '', text);
    const webpageBlob = this.buildStandaloneHtml(
      title,
      bodyHtml,
      sourceUrl,
      parsed.byline,
    );

    const geo = await this.geocodingService.resolveForArticle(title, description);

    return {
      id: newsUuid || randomUUID(),
      title,
      description,
      webpage_blob: webpageBlob,
      event_type: this.inferEventType(title, description),
      source_link: sourceUrl,
      confidence_level: ConfidenceLevel.MEDIUM,
      country: geo?.country || stored?.country || 'Global',
      latitude: geo?.latitude ?? stored?.latitude ?? null,
      longitude: geo?.longitude ?? stored?.longitude ?? null,
      raw_payload: {
        scraped_at: new Date().toISOString(),
        engine: 'Custom-OSINT-Ingestor',
        news_id: newsUuid || null,
        google_news_url: googleUrl,
        byline: parsed.byline || null,
        site_name: parsed.siteName || null,
      },
      created_at: new Date().toISOString(),
    };
  }


  async searchAndPublish(
    query?: string,
    limit = 5,
  ): Promise<{
    success: boolean;
    published: number;
    failed: number;
    results: Array<{
      event: OsintEventPayload;
      publish: { success: boolean; message: string };
    }>;
  }> {
    const ingest = await this.ingestLatest(query, limit);
    return {
      success: ingest.failed === 0,
      published: ingest.published,
      failed: ingest.failed,
      results: ingest.events.map((event) => ({
        event,
        publish: {
          success: true,
          message: 'OSINT event stored in OSINT service',
        },
      })),
    };
  }

  async publishEvent(dto: CreateOsintEventDto): Promise<{
    success: boolean;
    message: string;
    payload?: OsintEventPayload;
  }> {
    const payload: OsintEventPayload = {
      id: dto.id || randomUUID(),
      title: dto.title,
      description: dto.description || '',
      webpage_blob: dto.webpage_blob || '',
      event_type: dto.event_type || EventType.OTHER,
      source_link: dto.source_link || '',
      confidence_level: dto.confidence_level || ConfidenceLevel.MEDIUM,
      country: dto.country || 'Global',
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      raw_payload: dto.raw_payload || {
        scraped_at: new Date().toISOString(),
        engine: 'Custom-OSINT-Ingestor',
      },
      created_at: new Date().toISOString(),
    };

    this.events.unshift(payload);
    if (this.events.length > 500) this.events.length = 500;
    return {
      success: true,
      message: 'OSINT event stored in OSINT service',
      payload,
    };
  }

  getStatus() {
    return {
      connected: true,
      transport: 'http',
      poll_enabled: this.pollEnabled,
      poll_interval_ms: 30_000,
      registered_articles: this.byUuid.size,
      seen_articles: this.seenGoogleIds.size,
      stored_events: this.events.length,
    };
  }

  getNewsStream(): Observable<MessageEvent> {
    return this.newsUpdates.asObservable().pipe(
      map((items) => ({ data: { items } })),
    );
  }


  extractArticleId(link: string): string {
    if (!link) return randomUUID();
    try {
      const u = new URL(link);
      const match = u.pathname.match(/\/articles\/([^/?#]+)/);
      if (match?.[1]) return match[1];
      const last = u.pathname.split('/').filter(Boolean).pop();
      return last || Buffer.from(link).toString('base64url').slice(0, 32);
    } catch {
      return Buffer.from(link).toString('base64url').slice(0, 32);
    }
  }


  private registerArticle(
    meta: Omit<NewsArticleDto, 'id'>,
  ): NewsArticleDto {
    const googleId = this.extractArticleId(meta.link);
    const existingUuid = this.byGoogleId.get(googleId);

    if (existingUuid && this.byUuid.has(existingUuid)) {
      const updated: StoredNewsRef = {
        ...this.byUuid.get(existingUuid)!,
        ...meta,
        id: existingUuid,
        googleId,
        touchedAt: Date.now(),
      };
      this.byUuid.set(existingUuid, updated);
      return {
        id: existingUuid,
        title: updated.title,
        description: updated.description,
        link: updated.link,
        source: updated.source,
        category: updated.category,
        published_at: updated.published_at,
        country: updated.country,
        latitude: updated.latitude,
        longitude: updated.longitude,
      };
    }

    const id = randomUUID();
    const stored: StoredNewsRef = {
      id,
      googleId,
      ...meta,
      touchedAt: Date.now(),
    };
    this.byUuid.set(id, stored);
    this.byGoogleId.set(googleId, id);
    this.trimRegistry();

    return {
      id,
      title: stored.title,
      description: stored.description,
      link: stored.link,
      source: stored.source,
      category: stored.category,
      published_at: stored.published_at,
      country: stored.country,
      latitude: stored.latitude,
      longitude: stored.longitude,
    };
  }

  private resolveNewsRef(
    id?: string,
    url?: string,
  ): { uuid: string | null; googleNewsUrl: string | null; directUrl: string | null } {
    const trimmedId = id?.trim();
    const trimmedUrl = url?.trim();

    if (trimmedId && this.isUuid(trimmedId)) {
      const stored = this.byUuid.get(trimmedId);
      if (!stored) {
        throw new NotFoundException(
          `Unknown news id "${trimmedId}". Call GET /osint/news first and use the returned id.`,
        );
      }
      stored.touchedAt = Date.now();
      const googleNewsUrl = stored.link.includes('news.google.com')
        ? stored.link
        : `https://news.google.com/rss/articles/${stored.googleId}?oc=5`;
      return {
        uuid: stored.id,
        googleNewsUrl,
        directUrl: stored.link.includes('news.google.com') ? null : stored.link,
      };
    }

   
    if (trimmedId && !this.isUuid(trimmedId) && !trimmedId.startsWith('http')) {
      const mapped = this.byGoogleId.get(trimmedId);
      if (mapped) {
        return this.resolveNewsRef(mapped, url);
      }
      return {
        uuid: null,
        googleNewsUrl: `https://news.google.com/rss/articles/${trimmedId}?oc=5`,
        directUrl: null,
      };
    }

    if (trimmedId?.startsWith('http')) {
      const googleId = this.extractArticleId(trimmedId);
      const mapped = this.byGoogleId.get(googleId);
      return {
        uuid: mapped || null,
        googleNewsUrl: trimmedId.includes('news.google.com') ? trimmedId : null,
        directUrl: trimmedId.includes('news.google.com') ? null : trimmedId,
      };
    }

    if (trimmedUrl) {
      const googleId = this.extractArticleId(trimmedUrl);
      const mapped = this.byGoogleId.get(googleId);
      return {
        uuid: mapped || null,
        googleNewsUrl: trimmedUrl.includes('news.google.com') ? trimmedUrl : null,
        directUrl: trimmedUrl.includes('news.google.com') ? null : trimmedUrl,
      };
    }

    return { uuid: null, googleNewsUrl: null, directUrl: null };
  }

  private isUuid(value: string): boolean {
    return UUID_V4_RE.test(value);
  }

  private trimRegistry() {
    if (this.byUuid.size <= 1000) return;
    const sorted = [...this.byUuid.values()].sort((a, b) => a.touchedAt - b.touchedAt);
    const drop = sorted.slice(0, this.byUuid.size - 500);
    for (const item of drop) {
      this.byUuid.delete(item.id);
      this.byGoogleId.delete(item.googleId);
    }
  }



  private async buildEventFromArticle(
    article: NewsArticleDto,
  ): Promise<OsintEventPayload> {
    try {
      const full = await this.getFullArticle(article.id);
      return {
        ...full,
        id: article.id,
        title: full.title || article.title,
        description: this.mergeDescriptions(
          article.title,
          article.description,
          full.description,
        ),
        country: full.country !== 'Global' ? full.country : article.country,
        latitude: full.latitude ?? article.latitude,
        longitude: full.longitude ?? article.longitude,
        raw_payload: {
          ...full.raw_payload,
          source: article.source,
          published_at: article.published_at,
          news_id: article.id,
        },
      };
    } catch (err) {
      this.logger.warn(
        `Scrape failed for ${article.id}, publishing without webpage_blob: ${(err as Error).message}`,
      );
      return this.articleToEvent(article, '');
    }
  }

  private articleToEvent(
    article: NewsArticleDto,
    webpageBlob: string,
  ): OsintEventPayload {
    return {
      id: article.id,
      title: article.title,
      description: article.description,
      webpage_blob: webpageBlob,
      event_type: this.inferEventType(article.title, article.description),
      source_link: article.link,
      confidence_level: ConfidenceLevel.MEDIUM,
      country: article.country || 'Global',
      latitude: article.latitude,
      longitude: article.longitude,
      raw_payload: {
        scraped_at: new Date().toISOString(),
        engine: 'Custom-OSINT-Ingestor',
        source: article.source,
        published_at: article.published_at,
        news_id: article.id,
      },
      created_at: new Date().toISOString(),
    };
  }

  private trimSeenCache() {
    if (this.seenGoogleIds.size <= 500) return;
    const keep = [...this.seenGoogleIds].slice(-250);
    this.seenGoogleIds.clear();
    for (const id of keep) this.seenGoogleIds.add(id);
  }


  private cleanTitle(title: string): string {
    return title.replace(/\s+[-–—]\s+[^-–—]+$/, '').trim();
  }

  private cleanDescription(rawTitle: string, rawDescription: string): string {
    const title = this.cleanTitle(rawTitle);
    const text = this.stripHtml(rawDescription)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();

    if (!text) return '';

    const lines = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => this.stripTrailingSource(l))
      .filter(Boolean);

    const unique = lines.filter((line) => !this.isSameHeadline(line, title));

    if (unique.length > 0) {
      const joined = unique.slice(0, 5).join('. ');
      return joined.length > 600 ? `${joined.slice(0, 597).replace(/\s+\S*$/, '')}...` : joined;
    }


    const stripped = this.stripTrailingSource(text);
    if (this.isSameHeadline(stripped, title)) {
      return '';
    }
    if (stripped.toLowerCase().startsWith(title.toLowerCase())) {
      const rest = stripped.slice(title.length).replace(/^[\s:.\-–—]+/, '').trim();
      return rest.length > 600 ? `${rest.slice(0, 597).replace(/\s+\S*$/, '')}...` : rest;
    }
    return stripped.length > 600
      ? `${stripped.slice(0, 597).replace(/\s+\S*$/, '')}...`
      : stripped;
  }


  private buildLongDescription(
    title: string,
    excerpt: string,
    fullText: string,
  ): string {
    const cleanExcerpt = this.stripTrailingSource(excerpt.trim());
    if (cleanExcerpt && !this.isSameHeadline(cleanExcerpt, title) && cleanExcerpt.length >= 80) {
      return cleanExcerpt.length > 600
        ? `${cleanExcerpt.slice(0, 597).replace(/\s+\S*$/, '')}...`
        : cleanExcerpt;
    }

    const text = fullText.replace(/\s+/g, ' ').trim();
    if (!text) return cleanExcerpt || '';


    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let out = '';
    for (const s of sentences) {
      const next = `${out} ${s.trim()}`.trim();
      if (out && next.length > 500) break;
      out = next;
      if (out.length >= 350) break;
    }
    if (!out) out = text.slice(0, 500);

    if (this.isSameHeadline(out, title)) {
      out = text.slice(title.length).replace(/^[\s:.\-–—]+/, '').trim().slice(0, 500);
    }

    return out.length > 600 ? `${out.slice(0, 597).replace(/\s+\S*$/, '')}...` : out;
  }


  private mergeDescriptions(
    title: string,
    rssDescription: string,
    scrapedDescription: string,
  ): string {
    const scraped = (scrapedDescription || '').trim();
    const rss = (rssDescription || '').trim();

    if (scraped && !this.isSameHeadline(scraped, title) && scraped.length >= 120) {
      if (
        rss &&
        !this.isSameHeadline(rss, title) &&
        !scraped.toLowerCase().includes(rss.slice(0, 40).toLowerCase()) &&
        scraped.length < 350
      ) {
        const merged = `${scraped} ${rss}`;
        return merged.length > 700
          ? `${merged.slice(0, 697).replace(/\s+\S*$/, '')}...`
          : merged;
      }
      return scraped;
    }

    if (rss && !this.isSameHeadline(rss, title)) return rss;
    return scraped || rss || '';
  }

  private stripTrailingSource(line: string): string {
    return line
      .replace(/\s{2,}[A-Za-z0-9 .&]{2,40}$/, '')
      .replace(
        /\s+(Reuters|AP|AFP|BBC|CNN|Euronews(?:\.com)?|Yahoo|Guardian|Bloomberg|Al Jazeera|Associated Press)$/i,
        '',
      )
      .trim();
  }

  private isSameHeadline(a: string, b: string): boolean {
    const na = this.normalizeHeadline(a);
    const nb = this.normalizeHeadline(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.startsWith(nb) || nb.startsWith(na)) return true;
    const wa = na.split(/\s+/).slice(0, 8).join(' ');
    const wb = nb.split(/\s+/).slice(0, 8).join(' ');
    return wa === wb;
  }

  private normalizeHeadline(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private inferEventType(title: string, description: string): EventType {
    const t = `${title} ${description}`.toLowerCase();
    if (/\b(troop|military|armored|artillery|missile|invasion|border)\b/.test(t)) {
      return EventType.TROOP_MOVEMENT;
    }
    if (/\b(cyber|ransomware|hack|malware|ddos)\b/.test(t)) {
      return EventType.CYBER_ATTACK;
    }
    if (/\b(wildfire|earthquake|flood|hurricane|tornado|tsunami|volcano|disaster)\b/.test(t)) {
      return EventType.NATURAL_DISASTER;
    }
    if (/\b(election|sanction|diplomat|parliament|president|minister|political)\b/.test(t)) {
      return EventType.POLITICAL;
    }
    if (/\b(buildup|deployment|base|naval|warship)\b/.test(t)) {
      return EventType.MILITARY_BUILDUP;
    }
    return EventType.OTHER;
  }

  // ─── Google News URL resolution ───────────────────────────────────────────

  private async resolveGoogleNewsUrl(articleUrl: string): Promise<string> {
    const articleId = this.extractArticleId(articleUrl);
    const pageUrl = articleUrl.includes('?')
      ? articleUrl
      : `https://news.google.com/rss/articles/${articleId}?oc=5`;

    const pageRes = await fetch(pageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (pageRes.url && !pageRes.url.includes('news.google.com')) {
      return pageRes.url;
    }

    const pageText = await pageRes.text();

    const sigMatch = pageText.match(/data-n-a-sg="([^"]+)"/);
    const tsMatch = pageText.match(/data-n-a-ts="([^"]+)"/);

    if (sigMatch && tsMatch) {
      const signature = sigMatch[1];
      const timestamp = tsMatch[1];
      const resolved = await this.batchexecuteResolve(articleId, timestamp, signature);
      if (resolved) return resolved;
    }

    const dataPMatch = pageText.match(/data-p="([^"]+)"/);
    if (dataPMatch) {
      const resolved = await this.resolveViaDataP(dataPMatch[1]);
      if (resolved) return resolved;
    }

    const canonical = pageText.match(
      /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    );
    if (canonical?.[1] && !canonical[1].includes('news.google.com')) {
      return canonical[1];
    }

    throw new NotFoundException(
      'Could not decode Google News redirect for this article id',
    );
  }

  private async batchexecuteResolve(
    articleId: string,
    timestamp: string,
    signature: string,
  ): Promise<string | null> {
    const rpcInner = JSON.stringify([
      'garturlreq',
      [
        ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
        'X',
        'X',
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
      ],
      articleId,
      Number(timestamp),
      signature,
    ]);

    const fReq = JSON.stringify([[['Fbv4je', rpcInner, null, 'generic']]]);
    const body = new URLSearchParams({ 'f.req': fReq });

    const postRes = await fetch(BATCH_EXECUTE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Referer: 'https://news.google.com/',
        'User-Agent': USER_AGENT,
      },
      body,
    });

    let text = await postRes.text();
    if (text.startsWith(")]}'")) {
      text = text.split('\n').slice(1).join('\n').trim();
    }

    const firstNl = text.indexOf('\n');
    if (firstNl > 0 && /^\d+$/.test(text.slice(0, firstNl).trim())) {
      text = text.slice(firstNl + 1);
    }

    try {
      const envelopes = JSON.parse(text) as unknown[];
      for (const env of envelopes) {
        if (
          Array.isArray(env) &&
          env.length >= 3 &&
          env[0] === 'wrb.fr' &&
          env[1] === 'Fbv4je'
        ) {
          const payload = JSON.parse(String(env[2])) as unknown[];
          if (payload?.[0] === 'garturlres' && typeof payload[1] === 'string') {
            return payload[1];
          }
        }
      }
    } catch (err) {
      this.logger.warn(`batchexecute parse failed: ${(err as Error).message}`);
    }

    return null;
  }

  private async resolveViaDataP(rawDataP: string): Promise<string | null> {
    try {
      const decoded = rawDataP
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
      const normalized = decoded.replace(/^%\.@\./, '["garturlreq",');
      const obj = JSON.parse(normalized) as unknown[];
      const payload = {
        'f.req': JSON.stringify([
          [['Fbv4je', JSON.stringify([...obj.slice(0, -6), ...obj.slice(-2)]), null, 'generic']],
        ]),
      };

      const postRes = await fetch(BATCH_EXECUTE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': USER_AGENT,
          Referer: 'https://news.google.com/',
        },
        body: new URLSearchParams(payload as Record<string, string>),
      });

      let text = await postRes.text();
      if (text.startsWith(")]}'")) {
        text = text.split('\n').slice(1).join('\n').trim();
      }
      const arrayString = JSON.parse(text)[0][2];
      const articleUrl = JSON.parse(arrayString)[1];
      return typeof articleUrl === 'string' ? articleUrl : null;
    } catch (err) {
      this.logger.warn(`data-p resolve failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async fetchPageHtml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new NotFoundException(
        `Publisher page returned HTTP ${res.status} for ${url}`,
      );
    }

    return res.text();
  }

  private extractReadableArticle(html: string, url: string) {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    return reader.parse();
  }

  private buildStandaloneHtml(
    title: string,
    bodyHtml: string,
    sourceUrl: string,
    byline?: string | null,
  ): string {
    const safeTitle = this.escapeHtml(title);
    const meta = byline
      ? `<p class="byline">${this.escapeHtml(byline)}</p>`
      : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      line-height: 1.65;
      color: #1a1a1a;
      background: #f7f5f1;
    }
    article {
      max-width: 42rem;
      margin: 0 auto;
      padding: 1.5rem 1.25rem 3rem;
    }
    h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 0.75rem; }
    .byline { color: #555; font-size: 0.95rem; margin: 0 0 1.25rem; }
    .source {
      display: inline-block;
      margin-bottom: 1rem;
      font-family: system-ui, sans-serif;
      font-size: 0.8rem;
      color: #666;
      text-decoration: none;
    }
    img { max-width: 100%; height: auto; }
    figure { margin: 1.25rem 0; }
    a { color: #0b57d0; }
  </style>
</head>
<body>
  <article>
    <a class="source" href="${this.escapeHtml(sourceUrl)}" rel="noopener noreferrer">Original source</a>
    <h1>${safeTitle}</h1>
    ${meta}
    ${bodyHtml}
  </article>
</body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private extractSource(item: GoogleNewsItem, title: string): string {
    if (typeof item.source === 'string' && item.source.trim()) {
      return item.source.trim();
    }
    if (item.source && typeof item.source === 'object' && item.source._) {
      return String(item.source._).trim();
    }
    if (item.creator) {
      return item.creator;
    }
    const parts = title.split(' - ');
    if (parts.length > 1) {
      return parts[parts.length - 1].trim();
    }
    return 'Google News';
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }
}
