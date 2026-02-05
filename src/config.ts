/**
 * Configuration loader - reads from environment variables
 */

import type { AppConfig, LogLevel } from "./types";

const getEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const getEnvBool = (key: string, defaultValue: boolean): boolean => {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === "true";
};

const getEnvInt = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

const loadConfig = (): AppConfig => ({
  timezone: getEnv("TIMEZONE", "Europe/Berlin"),
  useMockData: getEnvBool("USE_MOCK_DATA", false),
  logLevel: getEnv("LOG_LEVEL", "info") as LogLevel,
  port: getEnvInt("PORT", 8080),

  telegram: {
    botToken: getEnv("TELEGRAM_BOT_TOKEN", ""),
    chatId: getEnv("TELEGRAM_CHAT_ID", ""),
  },
});

// Singleton config instance - loaded once at startup
let _config: AppConfig | null = null;

export const config = (): AppConfig => {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
};
