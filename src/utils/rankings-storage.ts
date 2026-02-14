/**
 * Persistent storage for App Store ranking history.
 *
 * - Production: reads/writes JSON to a GCS bucket
 * - Development: reads/writes to local .cache/ directory
 */

import { Storage } from "@google-cloud/storage";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// Types
// ============================================================================

/** Rankings for a single app on a single day */
export interface DailyAppRanking {
  /** Position in top free apps overall (null = outside top 200) */
  readonly overall: number | null;
  /** Position in Finance category (null = outside top 200) */
  readonly finance: number | null;
}

/** All app rankings for a single day, keyed by bundle ID */
export type DailySnapshot = Readonly<Record<string, DailyAppRanking>>;

/** Full history file: date string (YYYY-MM-DD) → snapshot */
export type RankingsHistory = Readonly<Record<string, DailySnapshot>>;

// ============================================================================
// Constants
// ============================================================================

const GCS_OBJECT_KEY = "appstore-rankings-history.json";
const LOCAL_CACHE_DIR = join(process.cwd(), ".cache");
const LOCAL_CACHE_FILE = join(
  LOCAL_CACHE_DIR,
  "appstore-rankings-history.json",
);
const RETENTION_DAYS = 90;

// ============================================================================
// Storage Backend Selection
// ============================================================================

const isProduction = (): boolean => process.env["NODE_ENV"] === "production";

const getBucketName = (): string | undefined => {
  return process.env["GCS_DATA_BUCKET"];
};

// ============================================================================
// GCS Backend
// ============================================================================

/** Lazy singleton for the GCS Storage client (avoids re-initialization overhead). */
let _storage: Storage | null = null;
const getStorage = (): Storage => {
  _storage ??= new Storage();
  return _storage;
};

const loadFromGCS = async (): Promise<RankingsHistory> => {
  try {
    const bucketName = getBucketName();
    if (!bucketName) {
      console.warn(
        "[rankings-storage] GCS_DATA_BUCKET not configured, skipping history load",
      );
      return {};
    }

    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(GCS_OBJECT_KEY);

    const [exists] = await file.exists();
    if (!exists) {
      console.log(
        "[rankings-storage] No history file in GCS yet, starting fresh",
      );
      return {};
    }

    const [contents] = await file.download();
    return JSON.parse(contents.toString()) as RankingsHistory;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      "[rankings-storage] Failed to load from GCS, starting fresh:",
      message,
    );
    return {};
  }
};

const saveToGCS = async (history: RankingsHistory): Promise<void> => {
  const bucketName = getBucketName();
  if (!bucketName) {
    console.warn(
      "[rankings-storage] GCS_DATA_BUCKET not configured, skipping history save",
    );
    return;
  }

  const bucket = getStorage().bucket(bucketName);
  const file = bucket.file(GCS_OBJECT_KEY);

  await file.save(JSON.stringify(history, null, 2), {
    contentType: "application/json",
  });

  console.log("[rankings-storage] Saved history to GCS");
};

// ============================================================================
// Local Filesystem Backend (development)
// ============================================================================

const loadFromLocal = async (): Promise<RankingsHistory> => {
  try {
    if (!existsSync(LOCAL_CACHE_FILE)) {
      console.log("[rankings-storage] No local history file, starting fresh");
      return {};
    }
    const contents = readFileSync(LOCAL_CACHE_FILE, "utf8");
    return JSON.parse(contents) as RankingsHistory;
  } catch (error) {
    console.warn("[rankings-storage] Failed to load local history:", error);
    return {};
  }
};

const saveToLocal = async (history: RankingsHistory): Promise<void> => {
  if (!existsSync(LOCAL_CACHE_DIR)) {
    mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
  }
  writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(history, null, 2));
  console.log("[rankings-storage] Saved history to local cache");
};

// ============================================================================
// Public API
// ============================================================================

/** Load full ranking history from storage. Returns empty object on first run. */
export const loadRankingsHistory = async (): Promise<RankingsHistory> => {
  return isProduction() ? loadFromGCS() : loadFromLocal();
};

/** Save ranking history to storage, pruning entries older than RETENTION_DAYS. */
export const saveRankingsHistory = async (
  history: RankingsHistory,
): Promise<void> => {
  const pruned = pruneOldEntries(history);
  return isProduction() ? saveToGCS(pruned) : saveToLocal(pruned);
};

// ============================================================================
// History Helpers
// ============================================================================

/**
 * Remove entries older than RETENTION_DAYS to keep the file small.
 * Accepts an optional reference date for testability (defaults to now).
 */
export const pruneOldEntries = (
  history: RankingsHistory,
  referenceDate: Date = new Date(),
): RankingsHistory => {
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = formatDateKey(cutoff);

  const pruned: Record<string, DailySnapshot> = {};
  for (const [date, snapshot] of Object.entries(history)) {
    // YYYY-MM-DD strings sort lexicographically the same as chronologically
    if (date >= cutoffStr) {
      pruned[date] = snapshot;
    }
  }
  return pruned;
};

/** Format a Date as YYYY-MM-DD for use as a history key. */
export const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
