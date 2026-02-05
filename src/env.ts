/**
 * Environment loader - loads .env.local in development
 *
 * Import this at the top of entry point files.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const loadEnvFile = (filename: string): void => {
  const filepath = join(process.cwd(), filename);

  if (!existsSync(filepath)) {
    return;
  }

  // Using sync read for startup
  const text = readFileSync(filepath, "utf8");

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only set if not already defined (env vars take precedence)
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

// Load in order of precedence (later files override earlier)
loadEnvFile(".env");
loadEnvFile(".env.local");
