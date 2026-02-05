/**
 * Google Cloud Storage Utility
 *
 * Uploads ICS calendar files to GCS for fast, CDN-backed downloads.
 */

import { Storage } from "@google-cloud/storage";

// ============================================================================
// Configuration
// ============================================================================

const getBucketName = (): string => {
  const bucket = process.env["GCS_BUCKET"];
  if (!bucket) {
    throw new Error("GCS_BUCKET environment variable is not set");
  }
  return bucket;
};

// Lazy-initialized storage client (uses Application Default Credentials)
let storageClient: Storage | null = null;

const getStorage = (): Storage => {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Upload an ICS file to GCS and return the public URL.
 *
 * @param content - The ICS file content
 * @param path - The path within the bucket (e.g., "2026-02-03/397971.ics")
 * @returns The public URL to access the file
 */
export const uploadIcsFile = async (
  content: string,
  path: string,
): Promise<string> => {
  const bucketName = getBucketName();
  const storage = getStorage();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(path);

  await file.save(content, {
    contentType: "text/calendar; charset=utf-8",
    metadata: {
      cacheControl: "public, max-age=86400", // Cache for 1 day
    },
  });

  return `https://storage.googleapis.com/${bucketName}/${path}`;
};

/**
 * Generate the GCS path for an ICS file.
 *
 * @param date - The event date
 * @param eventId - The unique event ID
 * @returns The path within the bucket
 */
export const getIcsPath = (date: Date, eventId: string): string => {
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
  return `${dateStr}/${eventId}.ics`;
};
