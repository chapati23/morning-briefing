/**
 * Notification Channel Registry
 */

import { config } from "../config";
import type { NotificationChannel } from "../types";
import { createTelegramChannel } from "./telegram";

// Import channels as they're implemented
// import { createEmailChannel } from './email';

// ============================================================================
// Channel Registry
// ============================================================================

export const getEnabledChannels = (): readonly NotificationChannel[] => {
  const channels: NotificationChannel[] = [];
  const cfg = config();

  // Add Telegram if configured
  if (cfg.telegram.botToken && cfg.telegram.chatId) {
    channels.push(createTelegramChannel(cfg.telegram));
    console.log("[channels] Telegram channel enabled");
  }

  // Add Email if configured (future)
  // if (cfg.email?.apiKey) {
  //   channels.push(createEmailChannel(cfg.email));
  // }

  return channels;
};

const getSentimentIcon = (
  sentiment?: "positive" | "negative" | "neutral",
): string => {
  if (sentiment === "positive") return "🟢";
  if (sentiment === "negative") return "🔴";
  return "";
};

export const createConsoleChannel = (): NotificationChannel => ({
  name: "console",
  send: async (briefing) => {
    console.log("\n" + "=".repeat(60));
    console.log(`MORNING BRIEFING - ${briefing.date.toDateString()}`);
    console.log("=".repeat(60) + "\n");

    for (const section of briefing.sections) {
      console.log(`${section.icon} ${section.title}`);
      if (section.summary) {
        console.log(`   ${section.summary}`);
      }
      for (const item of section.items) {
        const sentiment = getSentimentIcon(item.sentiment);
        console.log(`   • ${item.text} ${sentiment}`);
        if (item.detail) {
          // Handle multi-line details by indenting each line
          const lines = item.detail.split("\n");
          for (const line of lines) {
            console.log(`     ${line}`);
          }
          // Add blank line after multi-line items for visual separation
          if (lines.length > 1) {
            console.log("");
          }
        }
      }
      console.log("");
    }

    if (briefing.failures.length > 0) {
      console.log("⚠️  Failed Sources:");
      for (const failure of briefing.failures) {
        console.log(`   • ${failure.source}: ${failure.error}`);
      }
      console.log("");
    }

    console.log(`Generated at: ${briefing.generatedAt.toISOString()}`);
    console.log("=".repeat(60) + "\n");
  },
});
