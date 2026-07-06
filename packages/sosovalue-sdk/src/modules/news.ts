import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

/**
 * News / feeds. The live `/news` endpoint is paginated and wraps items under
 * `data.list` (not `data`), with engagement + entity fields:
 *
 *   { code, data: { page, page_size, total, list: [ {
 *       id, title, content, release_time (ms string), author, category (int),
 *       tags: string[], matched_currencies, is_blue_verified,
 *       impression_count, like_count, retweet_count, reply_count,
 *       source_link, original_link } ] } }
 *
 * There is no `sentiment` field — tone is derived downstream from the text +
 * engagement. Categories: 1=news, 2=research, 3=institution, 4=KOL/insight,
 * 7=announcement, 13=crypto-stock.
 */
export const NewsItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    release_time: z.union([z.string(), z.number()]).nullable().optional(),
    author: z.string().nullable().optional(),
    category: z.number().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
    matched_currencies: z.array(z.unknown()).nullable().optional(),
    is_blue_verified: z.boolean().nullable().optional(),
    impression_count: z.union([z.number(), z.string()]).nullable().optional(),
    like_count: z.union([z.number(), z.string()]).nullable().optional(),
    retweet_count: z.union([z.number(), z.string()]).nullable().optional(),
    reply_count: z.union([z.number(), z.string()]).nullable().optional(),
    source_link: z.string().nullable().optional(),
  })
  .passthrough();

export const NewsResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z
      .object({
        total: z.union([z.string(), z.number()]).optional(),
        page: z.number().optional(),
        page_size: z.number().optional(),
        list: z.array(NewsItemSchema).default([]),
      })
      .default({ list: [] }),
  })
  .passthrough();

export interface NewsItem {
  id: string;
  title: string;
  content?: string;
  /** Release time in ms since epoch, when available. */
  releaseTime?: number;
  author?: string;
  category?: number;
  tags: string[];
  isBlueVerified: boolean;
  /** impression + like + retweet + reply, when the API populates them. */
  engagement: number;
  sourceLink?: string;
}

export class NewsModule {
  constructor(private readonly client: SoSoValueClient) {}

  /**
   * Recent news feed (most recent first). `currencyId` / `category` narrow the
   * feed server-side; omit them for the global stream. Cache 2 min.
   */
  async feed(params?: {
    pageSize?: number;
    page?: number;
    currencyId?: string | number;
    category?: number;
  }): Promise<NewsItem[]> {
    const result = await this.client.fetch({
      path: '/news',
      method: 'GET',
      query: {
        page: params?.page ?? 1,
        page_size: params?.pageSize ?? 40,
        currency_id: params?.currencyId,
        category: params?.category,
      },
      schema: NewsResponseSchema,
      cacheTtl: 2 * 60,
    });
    return result.data.list.map(normalise);
  }
}

function normalise(raw: z.infer<typeof NewsItemSchema>): NewsItem {
  const releaseTime =
    typeof raw.release_time === 'number'
      ? raw.release_time
      : typeof raw.release_time === 'string' && raw.release_time.length > 0
        ? Number(raw.release_time)
        : undefined;
  const num = (v: number | string | null | undefined): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return Number(v) || 0;
    return 0;
  };
  const engagement =
    num(raw.impression_count) + num(raw.like_count) + num(raw.retweet_count) + num(raw.reply_count);

  const item: NewsItem = {
    id: String(raw.id),
    title: raw.title ?? '',
    tags: raw.tags ?? [],
    isBlueVerified: raw.is_blue_verified ?? false,
    engagement,
  };
  if (raw.content) item.content = raw.content;
  if (releaseTime !== undefined && !Number.isNaN(releaseTime)) item.releaseTime = releaseTime;
  if (raw.author) item.author = raw.author;
  if (raw.category !== null && raw.category !== undefined) item.category = raw.category;
  if (raw.source_link) item.sourceLink = raw.source_link;
  return item;
}
