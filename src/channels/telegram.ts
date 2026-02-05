/**
 * Telegram Notification Channel
 *
 * Sends formatted briefings via Telegram Bot API using grammy.
 */

import { Bot } from "grammy";
import type {
  Briefing,
  BriefingSection,
  NotificationChannel,
  TelegramConfig,
} from "../types";

// ============================================================================
// Telegram Channel Factory
// ============================================================================

export const createTelegramChannel = (
  cfg: TelegramConfig,
): NotificationChannel => {
  const bot = new Bot(cfg.botToken);

  return {
    name: "telegram",
    send: async (briefing) => {
      const message = formatBriefingForTelegram(briefing);
      await bot.api.sendMessage(cfg.chatId, message, {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      });
    },
  };
};

// ============================================================================
// Formatting
// ============================================================================

export const SECTION_SEPARATOR = "──────────────";

// Pattern to detect "Label: $Value" format (e.g., "BTC ETFs: +$145.2M")
// For these items, only the value part should be linked, not the label
const LABELLED_VALUE_PATTERN = /^(.+?):\s*([+-]?\$[\d,.]+[KMB]?)$/;

export const formatBriefingForTelegram = (briefing: Briefing): string => {
  const lines: string[] = [];

  // Header
  const dateStr = briefing.date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  lines.push(`🌅 *Morning Briefing*`, `_${escapeMarkdown(dateStr)}_`);

  // Sections with separators before each one
  for (const section of briefing.sections) {
    lines.push(
      "",
      escapeMarkdown(SECTION_SEPARATOR),
      "",
      formatSection(section),
    );
  }

  // Failures (if any)
  if (briefing.failures.length > 0) {
    lines.push(
      "",
      escapeMarkdown(SECTION_SEPARATOR),
      "",
      "⚠️ *Failed Sources*",
    );
    for (const failure of briefing.failures) {
      lines.push(
        `• ${escapeMarkdown(failure.source)}: ${escapeMarkdown(failure.error)}`,
      );
    }
  }

  return lines.join("\n");
};

export const formatSection = (section: BriefingSection): string => {
  const lines: string[] = [];

  // Title
  lines.push(`${section.icon} *${escapeMarkdown(section.title)}*`);

  // Summary (plain italic - no monospace mixing for cleaner look)
  if (section.summary) {
    lines.push(`_${escapeMarkdown(section.summary)}_`);
  }

  // Blank line before items
  if (section.items.length > 0) {
    lines.push("");
  }

  // Items
  for (const item of section.items) {
    const isSubItem = item.text.startsWith("  ");
    const bullet = isSubItem ? "◦" : "•";
    const text = isSubItem ? item.text.trim() : item.text;
    const indent = isSubItem ? "   " : "";

    const sentiment = getSentimentEmoji(item.sentiment);

    let line: string;

    // Calendar items: put calendar icon + time as one clickable link at the start
    if (item.calendarUrl && item.time) {
      const timeStr = formatTime(item.time);
      const calendarLink = `[${escapeMarkdown(timeStr)}](${escapeUrlForMarkdown(item.calendarUrl)})`;
      const formattedText = formatTextWithMonospace(text);
      line = `${indent}${bullet} ${calendarLink} ${formattedText}`;

      if (sentiment) {
        line += ` ${sentiment}`;
      }
    } else {
      // Non-calendar items: link the title if URL is available
      const timeStr = item.time ? formatTime(item.time) : "";
      const timePrefix = timeStr ? `${escapeMarkdown(timeStr)} ` : "";

      // Check for "Label: $Value" pattern (e.g., "BTC ETFs: +$145.2M")
      // For these items, only link the value part + sentiment emoji
      const labelledMatch = text.match(LABELLED_VALUE_PATTERN);

      const label = labelledMatch?.[1];
      const value = labelledMatch?.[2];

      if (label && value && item.url) {
        const escapedLabel = escapeMarkdown(`${label}: `);
        const formattedValue = `\`${escapeMarkdownInCode(value)}\``;
        const linkContent = sentiment
          ? `${formattedValue} ${sentiment}`
          : formattedValue;
        line = `${indent}${bullet} ${timePrefix}${escapedLabel}[${linkContent}](${escapeUrlForMarkdown(item.url)})`;
        // Sentiment is already included in the link, don't add it again
      } else {
        // Regular items: link the whole text
        const formattedText = item.url
          ? `[${formatTextWithMonospace(text)}](${escapeUrlForMarkdown(item.url)})`
          : formatTextWithMonospace(text);

        line = `${indent}${bullet} ${timePrefix}${formattedText}`;

        if (sentiment) {
          line += ` ${sentiment}`;
        }
      }
    }

    lines.push(line);

    // Detail on next line (plain italic for consistency)
    if (item.detail) {
      const indent = isSubItem ? "     " : "   ";
      // Handle multi-line details - each line gets its own italic formatting
      const detailLines = item.detail.split("\n");
      for (const detailLine of detailLines) {
        lines.push(`${indent}_${escapeMarkdown(detailLine)}_`);
      }
      // Add blank line after detailed items for visual separation
      lines.push("");
    }
  }

  // Remove trailing blank line if present
  if (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }

  return lines.join("\n");
};

export const getSentimentEmoji = (
  sentiment?: "positive" | "negative" | "neutral",
): string => {
  switch (sentiment) {
    case "positive": {
      return "🟢";
    }
    case "negative": {
      return "🔴";
    }
    default: {
      return "";
    }
  }
};

export const formatTime = (date: Date): string => {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Europe/Berlin",
  });
};

// Escape special characters for Telegram MarkdownV2
export const escapeMarkdown = (text: string): string => {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
};

// Escape URLs for use inside MarkdownV2 links - only ) and \ need escaping
export const escapeUrlForMarkdown = (url: string): string => {
  return url.replace(/([)\\])/g, "\\$1");
};

// Format text with monospace for financial values (e.g., +$145.2M, -$23.1M)
export const formatTextWithMonospace = (text: string): string => {
  const parts = text.split(/([+-]?\$[\d,.]+[KMB]?)/g);
  return parts
    .map((part) => {
      if (/^[+-]?\$[\d,.]+[KMB]?$/.test(part)) {
        return `\`${escapeMarkdownInCode(part)}\``;
      }
      return escapeMarkdown(part);
    })
    .join("");
};

// Escape characters inside code/monospace blocks (fewer chars need escaping)
export const escapeMarkdownInCode = (text: string): string => {
  return text.replace(/([`\\])/g, "\\$1");
};

// ============================================================================
// Utility: Get Chat ID Helper
// ============================================================================

export const getChatIdFromUpdate = async (botToken: string): Promise<void> => {
  const bot = new Bot(botToken);
  console.log("Fetching recent updates to find chat ID...");
  console.log("Make sure you have sent a message to the bot first!\n");

  try {
    const updates = await bot.api.getUpdates({ limit: 10 });

    if (updates.length === 0) {
      console.log("No updates found. Please:");
      console.log("1. Open Telegram and find your bot");
      console.log('2. Send it any message (e.g., "hello")');
      console.log("3. Run this command again");
      return;
    }

    console.log("Found chat(s):");
    const seenChats = new Set<number>();

    for (const update of updates) {
      const chat = update.message?.chat;
      if (chat && !seenChats.has(chat.id)) {
        seenChats.add(chat.id);
        console.log(`  Chat ID: ${chat.id}`);
        console.log(`  Type: ${chat.type}`);
        if (chat.type === "private") {
          console.log(`  User: ${chat.first_name} ${chat.last_name ?? ""}`);
        } else {
          console.log(`  Title: ${chat.title}`);
        }
        console.log("");
      }
    }

    console.log("Add your chat ID to .env.local:");
    console.log("TELEGRAM_CHAT_ID=<your_chat_id>");
  } catch (error) {
    console.error("Error fetching updates:", error);
  }
};
