/**
 * File-based caching for development
 *
 * Caches data to .cache/ directory to speed up local development
 * and reduce external API calls during testing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(process.cwd(), ".cache");
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface CacheOptions {
  /** Time-to-live in milliseconds (default: 2 hours) */
  readonly ttlMs?: number;
  /** Only use cache in development mode (default: true) */
  readonly developmentOnly?: boolean;
}

interface CacheEntry<T> {
  readonly data: T;
  readonly timestamp: number;
  readonly expiresAt: number;
}

const isDevelopment = (): boolean =>
  process.env["NODE_ENV"] !== "production" &&
  process.env["DISABLE_CACHE"] !== "true";

const ensureCacheDir = (): void => {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
};

const getCachePath = (key: string): string => {
  // Sanitize key for filesystem
  const safeKey = key.replace(/[^a-zA-Z0-9-_]/g, "_");
  return join(CACHE_DIR, `${safeKey}.json`);
};

/**
 * Get cached data if it exists and hasn't expired.
 *
 * @param key - Cache key
 * @param options - Cache options
 * @returns Cached data or undefined if not found/expired
 */
const getFromCache = (key: string, options: CacheOptions = {}): unknown => {
  const { developmentOnly = true } = options;

  // Skip cache in production if developmentOnly is true
  if (developmentOnly && !isDevelopment()) {
    return undefined;
  }

  const cachePath = getCachePath(key);

  if (!existsSync(cachePath)) {
    return undefined;
  }

  try {
    const content = readFileSync(cachePath, "utf8");
    const entry = JSON.parse(content) as CacheEntry<unknown>;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      return undefined;
    }

    return entry.data;
  } catch {
    // Cache read failed, return undefined
    return undefined;
  }
};

/**
 * Save data to cache.
 *
 * @param key - Cache key
 * @param data - Data to cache
 * @param options - Cache options
 */
const saveToCache = (
  key: string,
  data: unknown,
  options: CacheOptions = {},
): void => {
  const { ttlMs = DEFAULT_TTL_MS, developmentOnly = true } = options;

  // Skip cache in production if developmentOnly is true
  if (developmentOnly && !isDevelopment()) {
    return;
  }

  try {
    ensureCacheDir();

    const entry: CacheEntry<unknown> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };

    const cachePath = getCachePath(key);
    writeFileSync(cachePath, JSON.stringify(entry, null, 2));
  } catch (error) {
    // Cache write failed, log but don't throw
    console.warn(`[cache] Failed to write cache for key "${key}":`, error);
  }
};

/**
 * Execute a function with caching support.
 * Returns cached data if available and not expired, otherwise executes the function
 * and caches the result.
 *
 * @param key - Cache key
 * @param fn - Async function to execute if cache miss
 * @param options - Cache options
 * @returns The cached or freshly fetched data
 */
export const withCache = async <T>(
  key: string,
  fn: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> => {
  // Try to get from cache first
  const cached = getFromCache(key, options);
  if (cached !== undefined) {
    console.log(`[cache] Cache hit for "${key}"`);
    return cached as T;
  }

  // Cache miss - fetch fresh data
  console.log(`[cache] Cache miss for "${key}", fetching...`);
  const data = await fn();

  // Save to cache
  saveToCache(key, data, options);

  return data;
};
