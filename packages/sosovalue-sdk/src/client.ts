import { $fetch, type FetchOptions } from 'ofetch';
import { SoSoValueAPIError, SoSoValueRateLimitError, SoSoValueValidationError } from './errors.js';
import type { z } from 'zod';

export interface SoSoValueClientConfig {
  /** Single API key. Ignored if `apiKeys` is provided. */
  apiKey?: string;
  /**
   * Pool of API keys for round-robin + failover. The free tier caps at
   * 20 req/min per key, and the 10-coin fan-out exceeds that — rotating
   * across keys spreads the load and retries the next key on a 429.
   */
  apiKeys?: string[];
  baseUrl?: string;
  timeout?: number;
  /** Max retries for transient failures (5xx, network) */
  maxRetries?: number;
  /** Optional cache adapter (Redis, in-memory, etc.) */
  cache?: CacheAdapter;
  /** Optional rate limiter — passes (endpoint) -> wait promise */
  rateLimiter?: (endpoint: string) => Promise<void>;
}

export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

interface FetchConfig<TSchema extends z.ZodTypeAny> {
  /** API path (without /openapi/v1 prefix) */
  path: string;
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Zod schema to validate the response shape against */
  schema: TSchema;
  /** Cache TTL in seconds (omit to skip caching) */
  cacheTtl?: number;
}

/**
 * Base HTTP client for the SoSoValue API.
 *
 * - Auth: x-soso-api-key header
 * - Validation: every response runs through a Zod schema
 * - Caching: pluggable cache (default: none)
 * - Retries: exponential backoff on transient failures
 * - Rate limit: 20 req/min on Beta tier; 100k req/month
 */
export class SoSoValueClient {
  private readonly apiKeys: string[];
  private keyIndex = 0;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly cache?: CacheAdapter;
  private readonly rateLimiter?: (endpoint: string) => Promise<void>;

  constructor(config: SoSoValueClientConfig) {
    const keys = (config.apiKeys && config.apiKeys.length > 0
      ? config.apiKeys
      : config.apiKey
        ? [config.apiKey]
        : []
    )
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    if (keys.length === 0) {
      throw new Error('SoSoValueClient: at least one apiKey is required');
    }
    this.apiKeys = keys;
    this.baseUrl = config.baseUrl ?? 'https://openapi.sosovalue.com/openapi/v1';
    this.timeout = config.timeout ?? 15_000;
    this.maxRetries = config.maxRetries ?? 3;
    if (config.cache !== undefined) this.cache = config.cache;
    if (config.rateLimiter !== undefined) this.rateLimiter = config.rateLimiter;
  }

  async fetch<TSchema extends z.ZodTypeAny>(
    config: FetchConfig<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const { path, method = 'GET', query, body, schema, cacheTtl } = config;

    const cacheKey = this.cacheKey(method, path, query, body);

    if (cacheTtl && this.cache) {
      const cached = await this.cache.get<z.infer<TSchema>>(cacheKey);
      if (cached !== null) return cached;
    }

    if (this.rateLimiter) {
      await this.rateLimiter(path);
    }

    const opts: FetchOptions = {
      method,
      baseURL: this.baseUrl,
      timeout: this.timeout,
      // 429 is handled by key rotation below, not by ofetch retry.
      retry: this.maxRetries,
      retryDelay: 500,
      retryStatusCodes: [408, 500, 502, 503, 504],
    };
    if (query !== undefined) opts.query = this.cleanQuery(query);
    if (body !== undefined) opts.body = body as Record<string, unknown>;

    // Try each key in the pool on a rate-limit; a 429 on one key rotates to
    // the next. Non-429 errors fail fast. Round-robin the starting key so a
    // burst of concurrent calls spreads across the pool.
    let raw: unknown;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
      const key = this.nextKey();
      try {
        raw = await $fetch(path, {
          ...opts,
          headers: { 'x-soso-api-key': key, 'content-type': 'application/json' },
        });
        lastError = undefined;
        break;
      } catch (err: unknown) {
        const apiErr = this.toApiError(err, path);
        if (apiErr instanceof SoSoValueRateLimitError && attempt < this.apiKeys.length - 1) {
          lastError = apiErr;
          continue; // rotate to the next key
        }
        throw apiErr;
      }
    }
    if (lastError) throw lastError;

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new SoSoValueValidationError(
        `SoSoValue response failed validation for ${path}`,
        parsed.error,
        raw,
      );
    }

    if (cacheTtl && this.cache) {
      await this.cache.set(cacheKey, parsed.data, cacheTtl);
    }

    return parsed.data;
  }

  /** Round-robin the key pool so bursts of concurrent calls spread the load. */
  private nextKey(): string {
    const key = this.apiKeys[this.keyIndex % this.apiKeys.length]!;
    this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    return key;
  }

  private cleanQuery(query: Record<string, string | number | undefined>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) out[k] = String(v);
    }
    return out;
  }

  private cacheKey(
    method: string,
    path: string,
    query?: Record<string, unknown>,
    body?: unknown,
  ): string {
    const parts = [`sosovalue`, method, path];
    if (query) parts.push(JSON.stringify(this.sortObj(query)));
    if (body) parts.push(JSON.stringify(this.sortObj(body as Record<string, unknown>)));
    return parts.join(':');
  }

  private sortObj(obj: Record<string, unknown>): Record<string, unknown> {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = obj[k];
    }
    return sorted;
  }

  private toApiError(err: unknown, path: string): Error {
    type FetchError = { statusCode?: number; data?: { message?: string }; message?: string };
    const e = err as FetchError;
    const status = e.statusCode ?? 0;
    const message = e.data?.message ?? e.message ?? 'Unknown error';

    if (status === 429) {
      return new SoSoValueRateLimitError(`Rate limited on ${path}: ${message}`);
    }
    return new SoSoValueAPIError(`SoSoValue API error on ${path} (${status}): ${message}`, status);
  }
}
