# AGENTS.md — Morning Briefing Codebase Guide

Quick reference for AI agents and developers working on this project.

## What This Does

Fetches financial data from multiple sources every morning, formats it, and sends
one Telegram message. Runs as a Cloud Run job triggered by Cloud Scheduler.

---

## Data Flow

```text
sources/index.ts (getAllSources)
  └─ DataSource.fetch(date) × N          ← each source fetches independently
       └─ returns BriefingSection         ← or BriefingSection[] for multi-section sources
            │
orchestrator.ts (runBriefing)
  └─ Promise.allSettled(all sources)      ← parallel, fail-tolerant
  └─ flattens BriefingSection[]           ← multi-section sources get spread
  └─ filters empty sections               ← sections with no items are dropped
  └─ sorts by DataSource.priority         ← lower number = higher in message
       │
channels/telegram.ts (formatBriefingForTelegram)
  └─ formatSection(section)               ← per section
       └─ formatItem(item)                ← per BriefingItem
            └─ sends via Telegram Bot API (MarkdownV2)
```

---

## Key Files

| File                       | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `src/types.ts`             | All shared types — start here to understand the data model |
| `src/sources/index.ts`     | Source registry — **add new sources here**                 |
| `src/orchestrator.ts`      | Wires sources → sections → channels                        |
| `src/channels/telegram.ts` | Telegram formatting and delivery                           |
| `src/config.ts`            | Runtime config (env vars → typed config)                   |
| `src/dev.ts`               | Local dev CLI (`bun dev`)                                  |
| `src/index.ts`             | Cloud Run HTTP entry point                                 |

### Sources (`src/sources/`)

| File                        | What it fetches                                      |
| --------------------------- | ---------------------------------------------------- |
| `etf-flows.ts`              | BTC/ETH/SOL ETF flows from farside.co.uk (Puppeteer) |
| `overnight-futures.ts`      | ES, NQ, GC, CL etc. from Yahoo Finance               |
| `economic-calendar.ts`      | Week-ahead macro events                              |
| `appstore-rankings.ts`      | iOS App Store Finance + Overall rankings             |
| `daily-degen.ts`            | Crypto news digest                                   |
| `polymarket.ts`             | Prediction market movements                          |
| `opensea-voyages.ts`        | NFT voyage data                                      |
| `tracked-apps.ts`           | Config: which apps to track in App Store             |
| `fetch-current-rankings.ts` | Shared helper for appstore-rankings                  |

---

## BriefingItem Rendering

`BriefingItem` fields control how each line renders in Telegram:

| Field                   | Effect                                                 |
| ----------------------- | ------------------------------------------------------ |
| `text`                  | The line content                                       |
| `sentiment`             | `"positive"` → 🟢, `"negative"` → 🔴, `"neutral"` → ⚪ |
| `sentimentPrefix: true` | Emoji goes **before** the text (default: after)        |
| `monospace: true`       | Text in backtick code block; emoji always **before**   |
| `url`                   | Wraps text (or value portion) in a hyperlink           |
| `detail`                | Secondary line in italics below the item               |
| `time`                  | Prepended timestamp (Europe/Berlin timezone)           |
| `calendarUrl`           | Makes `time` a link to the calendar event              |

### Emoji placement patterns

```typescript
// Emoji BEFORE (use sentimentPrefix or monospace):
// • 🟢 Coinbase: #12 (↑5 daily)
{ text: "Coinbase: #12", sentiment: "positive", sentimentPrefix: true }

// Emoji AFTER (default):
// • Coinbase: #12 🟢
{ text: "Coinbase: #12", sentiment: "positive" }

// Monospace (always emoji before, fixed-width font):
// • 🟢 `ES:  +0.45% / 5,432.25`
{ text: "ES:  +0.45% / 5,432.25", sentiment: "positive", monospace: true }

// Labelled value (emoji before, label plain, value linked):
// • 🟢 BTC ETFs: [`+$88.1M`](url)
{ text: "BTC ETFs: +$88.1M", sentiment: "positive", url: "https://..." }
```

---

## Adding a New Data Source

1. Create `src/sources/my-source.ts` with:

   ```typescript
   export const mySource: DataSource = {
     name: "My Source",
     priority: 5,          // lower = higher in briefing
     timeoutMs: 30_000,
     fetch: async (date) => ({ title: "...", icon: "🔥", items: [...] }),
   };

   // Always add a mock for local dev
   export const mockMySource: DataSource = {
     name: "My Source",
     priority: 5,
     fetch: async () => ({ title: "...", icon: "🔥", items: [{ text: "mock item" }] }),
   };
   ```

2. Register in `src/sources/index.ts` (both real and mock versions).

3. Add tests in `tests/my-source.test.ts`.

**To return multiple sections** (e.g. Finance + Total), return `BriefingSection[]`
from `fetch`. The orchestrator flattens arrays automatically.

---

## Local Dev

```bash
bun dev                          # Full briefing, print to console
bun dev --source etf-flows       # Single source only
bun dev --dry-run                # Don't send to Telegram
bun dev --date 2026-01-15        # Test a specific date
bun dev --mock                   # Use mock data (no network calls)
```

---

## Checks Before Committing

Always run these before committing (not just before pushing):

```bash
bun run typecheck       # Catch type errors
trunk check --fix       # Lint + format (catches unused imports etc.)
bun test                # Full test suite
```

See `.cursor/rules/post-change-checks.mdc` for the full decision tree.

---

## Test Coverage Map

| Source file                        | Test file                         |
| ---------------------------------- | --------------------------------- |
| `src/orchestrator.ts`              | `tests/orchestrator.test.ts`      |
| `src/channels/telegram.ts`         | `tests/telegram.test.ts`          |
| `src/sources/appstore-rankings.ts` | `tests/appstore-rankings.test.ts` |
| `src/sources/etf-flows.ts`         | `tests/trading-day.test.ts`       |
| `src/sources/overnight-futures.ts` | `tests/overnight-futures.test.ts` |
| `src/sources/polymarket.ts`        | `tests/polymarket.test.ts`        |
| `src/sources/economic-calendar.ts` | `tests/economic-calendar.test.ts` |
| `src/sources/daily-degen.ts`       | `tests/daily-degen.test.ts`       |
| `src/utils/cache.ts`               | `tests/cache.test.ts`             |
| Multiple / integration             | `tests/e2e/briefing.test.ts`      |

---

## Infrastructure

Deployed on GCP. See `terraform/` for all infra-as-code.
See `.cursor/rules/terraform-makefile.mdc` — always use `make` targets, never raw `terraform`.
See `docs/deploy-from-scratch.md` for the full deploy guide.
