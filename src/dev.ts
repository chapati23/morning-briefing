/**
 * Local Development CLI
 *
 * Usage:
 *   bun dev                          # Run full briefing
 *   bun dev --source etf-flows       # Run single source
 *   bun dev --dry-run                # Don't send notifications
 *   bun dev --date 2026-01-15        # Test specific date
 */

// Load environment variables
import "./env";

import { createConsoleChannel, getEnabledChannels } from "./channels";
import { runBriefing, sendBriefing } from "./orchestrator";
import { createMockSource, getAllSources, getSourceByName } from "./sources";
import type { DataSource } from "./types";

// Simple arg parser for Bun
const parseCliArgs = (args: string[]) => {
  const values: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h": {
        values["help"] = true;

        break;
      }
      case "--dry-run":
      case "-d": {
        values["dry-run"] = true;

        break;
      }
      case "--mock":
      case "-m": {
        values["mock"] = true;

        break;
      }
      default: {
        if ((arg === "--source" || arg === "-s") && args[i + 1]) {
          values["source"] = args[++i] ?? "";
        } else if (arg === "--date" && args[i + 1]) {
          values["date"] = args[++i] ?? "";
        }
      }
    }
  }
  return values;
};

const values = parseCliArgs(Bun.argv.slice(2));

const showHelp = () => {
  console.log(`
Morning Briefing - Local Development CLI

Usage:
  bun dev [options]

Options:
  -s, --source <name>   Run only a specific source
  -d, --dry-run         Generate briefing but don't send notifications
      --date <date>     Override the briefing date (YYYY-MM-DD)
  -m, --mock            Use mock data sources
  -h, --help            Show this help message

Examples:
  bun dev                           Run full briefing, send to configured channels
  bun dev --dry-run                 Generate briefing, print to console only
  bun dev --source etf-flows        Run just the ETF flows source
  bun dev --date 2026-01-15 --dry-run   Test with a specific date
  bun dev --mock                    Run with mock sources (no real API calls)
`);
};

const main = async () => {
  if (values["help"]) {
    showHelp();
    process.exit(0);
  }

  console.log("\n🌅 Morning Briefing - Development Mode\n");

  // Parse date
  const dateArg = values["date"];
  const date =
    typeof dateArg === "string" && dateArg ? new Date(dateArg) : new Date();
  if (Number.isNaN(date.getTime())) {
    console.error(`Invalid date: ${dateArg}`);
    process.exit(1);
  }

  // Get sources
  let sources: readonly DataSource[];
  const sourceArg = values["source"];
  if (values["mock"]) {
    console.log("Using mock data sources");
    sources = [
      createMockSource("Mock Calendar", 1),
      createMockSource("Mock ETF Flows", 2),
      createMockSource("Mock Economic Calendar", 3),
    ];
  } else if (typeof sourceArg === "string" && sourceArg) {
    try {
      sources = [getSourceByName(sourceArg)];
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  } else {
    sources = getAllSources();
  }

  if (sources.length === 0) {
    console.log(
      "⚠️  No sources configured yet. Use --mock to test with mock data.\n",
    );
    console.log("Available sources will appear here as you implement them.");
    console.log("Try: bun dev --mock --dry-run\n");
    process.exit(0);
  }

  console.log(`📅 Date: ${date.toDateString()}`);
  console.log(`📡 Sources: ${sources.map((s) => s.name).join(", ")}`);
  console.log(`🔇 Dry run: ${values["dry-run"] ? "yes" : "no"}`);
  console.log("");

  // Run briefing
  const briefing = await runBriefing(sources, date);

  // Always print to console
  const consoleChannel = createConsoleChannel();
  await consoleChannel.send(briefing);

  // Send to real channels unless dry-run
  if (!values["dry-run"]) {
    const channels = getEnabledChannels();
    if (channels.length > 0) {
      await sendBriefing(briefing, channels);
    } else {
      console.log(
        "ℹ️  No notification channels configured. Add TELEGRAM_CHAT_ID to .env.local",
      );
    }
  }

  // Summary
  console.log("✅ Done!");
  if (briefing.failures.length > 0) {
    console.log(`⚠️  ${briefing.failures.length} source(s) failed`);
    process.exit(1);
  }
};

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
