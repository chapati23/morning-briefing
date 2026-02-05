/**
 * Utility script to get your Telegram chat ID
 *
 * Usage:
 *   1. Send any message to your bot in Telegram
 *   2. Run: bun run src/get-chat-id.ts
 *   3. Copy the chat ID to .env.local
 */

// Load environment variables
import "./env";

import { getChatIdFromUpdate } from "./channels/telegram";
import { config } from "./config";

const main = async () => {
  const cfg = config();

  if (!cfg.telegram.botToken) {
    console.error("Error: TELEGRAM_BOT_TOKEN not set in .env.local");
    process.exit(1);
  }

  await getChatIdFromUpdate(cfg.telegram.botToken);
};

main().catch(console.error);
