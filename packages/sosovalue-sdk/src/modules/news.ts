import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

export const NewsArticleSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    url: z.string().optional(),
    link: z.string().optional(),
    source: z.string().optional(),
    published_at: z.string().optional(),
    publishTime: z.union([z.string(), z.number()]).optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    symbols: z.array(z.string()).optional(),
    coins: z.array(z.string()).optional(),
    sentiment: z.number().optional(),
    importance: z.number().optional(),
  })
  .passthrough();
export type RawNewsArticle = z.infer<typeof NewsArticleSchema>;

export const NewsListResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(NewsArticleSchema).default([]),
    msg: z.string().optional(),
  })
  .passthrough();

export interface NewsArticle {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  source?: string;
  published_at?: string;
  symbols?: string[];
  sentiment?: number;
  importance?: number;
}

export class NewsModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** Latest news feed. Tries `/news/feed` first, falls back to `/news`. */
  async feed(params?: { limit?: number; symbols?: string[] }): Promise<NewsArticle[]> {
    const query = {
      limit: params?.limit ?? 20,
      symbols: params?.symbols?.join(','),
    };
    const candidates = ['/news/feed', '/news', '/news/list', '/feeds/news'];
    for (const path of candidates) {
      try {
        const result = await this.client.fetch({
          path,
          method: 'GET',
          query,
          schema: NewsListResponseSchema,
          cacheTtl: 60,
        });
        return result.data.map(normalise).filter((n): n is NewsArticle => n !== null);
      } catch {
        // try next path
      }
    }
    return [];
  }

  async hot(params?: { limit?: number }): Promise<NewsArticle[]> {
    try {
      const result = await this.client.fetch({
        path: '/news/hot',
        method: 'GET',
        query: { limit: params?.limit ?? 10 },
        schema: NewsListResponseSchema,
        cacheTtl: 60,
      });
      return result.data.map(normalise).filter((n): n is NewsArticle => n !== null);
    } catch {
      return [];
    }
  }

  async featured(params?: { limit?: number }): Promise<NewsArticle[]> {
    try {
      const result = await this.client.fetch({
        path: '/news/featured',
        method: 'GET',
        query: { limit: params?.limit ?? 10 },
        schema: NewsListResponseSchema,
        cacheTtl: 5 * 60,
      });
      return result.data.map(normalise).filter((n): n is NewsArticle => n !== null);
    } catch {
      return [];
    }
  }

  async search(params: { q: string; limit?: number }): Promise<NewsArticle[]> {
    try {
      const result = await this.client.fetch({
        path: '/news/search',
        method: 'GET',
        query: { q: params.q, limit: params.limit ?? 20 },
        schema: NewsListResponseSchema,
        cacheTtl: 5 * 60,
      });
      return result.data.map(normalise).filter((n): n is NewsArticle => n !== null);
    } catch {
      return [];
    }
  }
}

function normalise(raw: RawNewsArticle): NewsArticle | null {
  const title = raw.title;
  if (!title) return null;
  const article: NewsArticle = {
    id: raw.id !== undefined ? String(raw.id) : title.slice(0, 40),
    title,
  };
  const summary = raw.summary ?? raw.description;
  if (summary) article.summary = summary;
  const url = raw.url ?? raw.link;
  if (url) article.url = url;
  if (raw.source) article.source = raw.source;
  const publishedAt =
    raw.published_at ??
    (typeof raw.publishTime === 'number' ? new Date(raw.publishTime).toISOString() : undefined) ??
    (typeof raw.publishTime === 'string' ? raw.publishTime : undefined) ??
    (typeof raw.timestamp === 'number' ? new Date(raw.timestamp).toISOString() : undefined) ??
    (typeof raw.timestamp === 'string' ? raw.timestamp : undefined);
  if (publishedAt) article.published_at = publishedAt;
  const symbols = raw.symbols ?? raw.coins;
  if (symbols) article.symbols = symbols;
  if (raw.sentiment !== undefined) article.sentiment = raw.sentiment;
  if (raw.importance !== undefined) article.importance = raw.importance;
  return article;
}
