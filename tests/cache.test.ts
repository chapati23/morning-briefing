/**
 * Tests for cache utility
 */

import { afterAll, describe, expect, it, mock } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { withCache } from "../src/utils/cache";

const TEST_CACHE_DIR = join(process.cwd(), ".cache");

// Helper to get cache file path for a key
const getCachePath = (key: string): string => {
  const safeKey = key.replace(/[^a-zA-Z0-9-_]/g, "_");
  return join(TEST_CACHE_DIR, `${safeKey}.json`);
};

// Helper to clean up a specific cache key
const cleanupCacheKey = (key: string): void => {
  const path = getCachePath(key);
  if (existsSync(path)) {
    unlinkSync(path);
  }
};

// ============================================================================
// withCache
// ============================================================================

describe("withCache", () => {
  describe("cache miss", () => {
    const testKey = `test-cache-miss-${Date.now().toString()}`;

    afterAll(() => {
      cleanupCacheKey(testKey);
    });

    it("calls the function on cache miss", async () => {
      const fn = mock(() => Promise.resolve({ value: 42 }));

      const result = await withCache(testKey, fn);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ value: 42 });
    });
  });

  describe("cache hit", () => {
    const testKey = `test-cache-hit-${Date.now().toString()}`;

    afterAll(() => {
      cleanupCacheKey(testKey);
    });

    it("returns cached data and skips function call", async () => {
      // First call - should execute function
      const fn1 = mock(() => Promise.resolve({ value: 1 }));
      const result1 = await withCache(testKey, fn1);
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(result1).toEqual({ value: 1 });

      // Second call - should use cache
      const fn2 = mock(() => Promise.resolve({ value: 2 }));
      const result2 = await withCache(testKey, fn2);
      expect(fn2).toHaveBeenCalledTimes(0); // Should NOT be called
      expect(result2).toEqual({ value: 1 }); // Should return cached value
    });
  });

  describe("cache expiration", () => {
    const testKey = `test-cache-expiry-${Date.now().toString()}`;

    afterAll(() => {
      cleanupCacheKey(testKey);
    });

    it("re-fetches when cache is expired", async () => {
      // First call with very short TTL
      const fn1 = mock(() => Promise.resolve({ value: "old" }));
      await withCache(testKey, fn1, { ttlMs: 1 }); // 1ms TTL
      expect(fn1).toHaveBeenCalledTimes(1);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second call - cache should be expired
      const fn2 = mock(() => Promise.resolve({ value: "new" }));
      const result = await withCache(testKey, fn2);
      expect(fn2).toHaveBeenCalledTimes(1); // Should be called
      expect(result).toEqual({ value: "new" });
    });
  });

  describe("key isolation", () => {
    const timestamp = Date.now().toString();
    const testKey1 = `test-isolation-1-${timestamp}`;
    const testKey2 = `test-isolation-2-${timestamp}`;

    afterAll(() => {
      cleanupCacheKey(testKey1);
      cleanupCacheKey(testKey2);
    });

    it("caches different keys independently", async () => {
      const result1 = await withCache(testKey1, () =>
        Promise.resolve({ key: "one" }),
      );
      const result2 = await withCache(testKey2, () =>
        Promise.resolve({ key: "two" }),
      );

      expect(result1).toEqual({ key: "one" });
      expect(result2).toEqual({ key: "two" });

      // Verify each key still returns its own data
      const cached1 = await withCache(testKey1, () =>
        Promise.resolve({ key: "should not return this" }),
      );
      const cached2 = await withCache(testKey2, () =>
        Promise.resolve({ key: "should not return this" }),
      );

      expect(cached1).toEqual({ key: "one" });
      expect(cached2).toEqual({ key: "two" });
    });
  });

  describe("key sanitization", () => {
    const testKey = `test/with:special*chars?${Date.now().toString()}`;

    afterAll(() => {
      cleanupCacheKey(testKey);
    });

    it("sanitizes special characters in cache keys", async () => {
      // Should not throw - special chars should be replaced
      const result = await withCache(testKey, () =>
        Promise.resolve({ sanitized: true }),
      );
      expect(result).toEqual({ sanitized: true });

      // Should still be able to retrieve
      const cached = await withCache(testKey, () =>
        Promise.resolve({ sanitized: false }),
      );
      expect(cached).toEqual({ sanitized: true });
    });
  });

  describe("data types", () => {
    const timestamp = Date.now().toString();
    const keyString = `test-type-string-${timestamp}`;
    const keyNumber = `test-type-number-${timestamp}`;
    const keyArray = `test-type-array-${timestamp}`;
    const keyObject = `test-type-object-${timestamp}`;

    afterAll(() => {
      cleanupCacheKey(keyString);
      cleanupCacheKey(keyNumber);
      cleanupCacheKey(keyArray);
      cleanupCacheKey(keyObject);
    });

    it("caches string values", async () => {
      const result = await withCache(keyString, () => Promise.resolve("hello"));
      expect(result).toBe("hello");
    });

    it("caches number values", async () => {
      const result = await withCache(keyNumber, () => Promise.resolve(42));
      expect(result).toBe(42);
    });

    it("caches array values", async () => {
      const result = await withCache(keyArray, () =>
        Promise.resolve([1, 2, 3]),
      );
      expect(result).toEqual([1, 2, 3]);
    });

    it("caches complex object values", async () => {
      const data = {
        nested: { value: 123 },
        array: ["a", "b"],
        date: "2026-01-15",
      };
      const result = await withCache(keyObject, () => Promise.resolve(data));
      expect(result).toEqual(data);
    });
  });

  describe("error handling", () => {
    const testKey = `test-error-${Date.now().toString()}`;

    afterAll(() => {
      cleanupCacheKey(testKey);
    });

    it("propagates errors from the function", async () => {
      const fn = () => Promise.reject(new Error("Test error"));

      let caughtError: Error | undefined;
      try {
        await withCache(testKey, fn);
      } catch (error) {
        caughtError = error as Error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError?.message).toBe("Test error");
    });
  });
});
