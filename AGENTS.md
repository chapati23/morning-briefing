# AGENTS.md — Morning Briefing

## Project Overview

Daily financial briefing service that aggregates market data from multiple sources and delivers a formatted Telegram message every morning. Runs serverless on GCP (Cloud Run + Cloud Scheduler), deployed via Terraform, CI/CD via GitHub Actions.

- **Runtime:** Bun (not Node)
- **Language:** TypeScript (strict mode, `noUncheckedIndexedAccess`)
- **Delivery:** Telegram Bot API via grammy
- **Infra:** GCP Cloud Run (min 0, max 1), Cloud Scheduler, Artifact Registry, Secret Manager, GCS
- **IaC:** Terraform (always use `make plan`/`make apply` from `terraform/` — never raw `terraform` commands)
- **CI:** GitHub Actions → trunk-action + typecheck + knip + test:coverage → auto-deploy to Cloud Run on main
- **Repo:** `chapati23/morning-briefing`

## Architecture (read this, skip the code)

```
src/
├── index.ts              # Cloud Run HTTP server (GET /health, POST /briefing)
├── dev.ts                # Local dev CLI (--dry-run, --source, --date, --mock)
├── orchestrator.ts       # Core: fetches all sources in parallel, fail-tolerant, sorts by priority
├── config.ts             # Env-based config singleton
├── env.ts                # Loads .env.local (dev only)
├── types.ts              # ALL type definitions (DataSource, BriefingSection, BriefingItem, etc.)
├── sources/
│   ├── index.ts          # Source registry — add new sources here
│   ├── overnight-futures.ts    # S&P/Nasdaq/Dow/Russell futures (Puppeteer scrape)
│   ├── daily-degen.ts          # Crypto news digest (AgentMail email parsing)
│   ├── etf-flows.ts            # ETF fund flows (web scrape, trading day logic)
│   ├── economic-calendar.ts    # Economic events (web scrape)
│   ├── polymarket.ts           # Prediction market movers + top markets (API)
│   ├── appstore-rankings.ts    # App Store rankings + trends (Puppeteer, GCS history)
│   ├── opensea-voyages.ts      # OpenSea voyages/quests (AgentMail email parsing)
│   ├── tracked-apps.ts         # App bundle IDs config
│   └── fetch-current-rankings.ts  # Standalone rankings fetcher
├── channels/
│   ├── index.ts          # Channel registry + console channel
│   └── telegram.ts       # Telegram MarkdownV2 formatting + delivery
├── utils/
│   ├── cache.ts          # Generic caching utility
│   ├── rankings-storage.ts  # GCS-backed rankings persistence
│   └── index.ts
└── config/
    └── polymarket-correlations.ts  # Polymarket category mapping
```

### How a briefing works

1. Cloud Scheduler POSTs to `/briefing` (or `bun dev` locally)
2. `runFullBriefing()` in orchestrator calls all sources in parallel via `Promise.allSettled`
3. Each source implements `DataSource.fetch(date) → BriefingSection`
4. Failed sources are logged but don't block others (fail-tolerant)
5. Sections sorted by `priority` (lower = higher in message)
6. Formatted as Telegram MarkdownV2, sent via grammy

### Key types (from `src/types.ts`)

```typescript
interface DataSource {
  name: string;
  priority: number;       // Lower = higher in briefing
  timeoutMs?: number;     // Per-source timeout (default 45s)
  fetch(date: Date): Promise<BriefingSection>;
}

interface BriefingSection {
  title: string;
  icon: string;
  items: BriefingItem[];
  summary?: string;
}

interface BriefingItem {
  text: string;
  detail?: string;
  url?: string;
  sentiment?: "positive" | "negative" | "neutral";
  monospace?: boolean;
  time?: Date;
  timePrefix?: string;
  calendarUrl?: string;
}
```

## Commands

```bash
# Dev
bun install                      # Install deps
bun dev                          # Full briefing, sends to Telegram
bun dev --dry-run                # Print to console only
bun dev --source etf-flows       # Single source
bun dev --date 2026-01-15        # Specific date
bun dev --mock                   # Mock data, no API calls

# Quality (all run pre-push via trunk hooks)
bun run typecheck                # TSC strict check
bun test                         # Bun test runner
bun test tests/telegram.test.ts  # Single test file
bun test --coverage              # With coverage
bun run knip                     # Dead code detection
trunk check --fix                # Lint + format (use trunk, not raw eslint)
trunk fmt                        # Format only

# Infrastructure (from terraform/ directory)
make plan                        # Preview infra changes
make apply                       # Apply with approval
make deploy                      # Build + push + apply (full deploy)
make github-secrets              # Set up CI/CD vars

# Ops
bun run trigger                  # Manually trigger Cloud Scheduler job
bun run logs                     # Tail Cloud Run logs
bun run healthcheck              # Hit /health endpoint
./scripts/setup.sh               # Full project setup (idempotent)
./scripts/setup.sh --check       # Diagnose without changes
```

## Adding a New Data Source

This is the most common change. Follow this pattern exactly:

1. Create `src/sources/my-source.ts` implementing `DataSource`:
   ```typescript
   import type { DataSource } from "../types";

   export const mySource: DataSource = {
     name: "My Source",
     priority: 50,  // Adjust relative to others
     fetch: async (date) => ({
       title: "My Source",
       icon: "📊",
       items: [{ text: "Example item" }],
     }),
   };

   // Mock version for testing
   export const mockMySource: DataSource = { /* ... */ };
   ```

2. Register in `src/sources/index.ts`:
   - Add to `getRealSources()` and `getMockSources()`

3. Add tests in `tests/my-source.test.ts`

4. Run: `bun run typecheck && bun test && trunk check --fix`

## Code Style & Conventions

- **Functional style:** `const` arrow functions for module-level, pure where possible
- **Immutable types:** Use `readonly` on interface fields and array types
- **No classes** — factory functions returning interfaces (see `createTelegramChannel`)
- **Error handling:** Sources never throw — orchestrator catches via `Promise.allSettled`
- **File naming:** kebab-case (`etf-flows.ts`, not `etfFlows.ts`)
- **Exports:** Named exports only, no default exports
- **Formatting:** Prettier via trunk (auto on commit)
- **Linting:** ESLint 9 + typescript-eslint strict + unicorn + functional-lite + promise
- **No `any`:** Strict TypeScript, `noUncheckedIndexedAccess` enabled
- **Telegram formatting:** MarkdownV2 requires escaping special chars — see `escapeMarkdown()` in telegram.ts

## Testing

- **Framework:** Bun's built-in test runner (`bun test`)
- **Pattern:** Each source gets its own test file, tests use factory helpers from `tests/helpers.ts`
- **Mocks:** Each source exports a mock variant; external APIs are mocked in tests
- **E2E:** `tests/e2e/briefing.test.ts` runs full pipeline with mocks
- **Pre-push hooks:** typecheck + trunk check + test:coverage + knip (all must pass)

### Test file mapping

| Source | Test |
|--------|------|
| `src/orchestrator.ts` | `tests/orchestrator.test.ts` |
| `src/channels/telegram.ts` | `tests/telegram.test.ts` |
| `src/sources/polymarket.ts` | `tests/polymarket.test.ts` |
| `src/sources/etf-flows.ts` | `tests/trading-day.test.ts` |
| `src/sources/daily-degen.ts` | `tests/daily-degen.test.ts` |
| `src/sources/appstore-rankings.ts` | `tests/appstore-rankings.test.ts` |
| `src/sources/opensea-voyages.ts` | `tests/opensea-voyages.test.ts` |
| `src/utils/cache.ts` | `tests/cache.test.ts` |
| `src/config/polymarket-correlations.ts` | `tests/polymarket-correlations.test.ts` |

## Infrastructure Rules

- **NEVER run raw `gcloud` commands** that modify infrastructure (no `gcloud run deploy`, `gcloud run services update`, etc.)
- **All infra changes go through Terraform** (`terraform/` dir, via Makefile)
- **Read-only `gcloud` is fine** (logs, describe, scheduler triggers)
- Terraform reads secrets from `../.env.local` via Makefile — never run `terraform` directly
- Cloud Run: 2Gi memory (Puppeteer needs it), 300s timeout, scales 0→1
- Secrets in GCP Secret Manager: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `AGENTMAIL_API_KEY`

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes (prod) | — | Bot API token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes (prod) | — | Target chat for briefings |
| `AGENTMAIL_API_KEY` | No | — | For email-based sources (Daily Degen, OpenSea) |
| `TIMEZONE` | No | `Europe/Berlin` | Briefing timezone |
| `USE_MOCK_DATA` | No | `false` | Use mock sources |
| `LOG_LEVEL` | No | `info` | Logging verbosity |
| `PORT` | No | `8080` | HTTP server port |
| `GCS_DATA_BUCKET` | No | — | GCS bucket for rankings history (set by Terraform) |

## Git & CI/CD

- **Branch protection** on `main` — PRs required
- **CI:** Quality Checks (trunk + typecheck + knip + coverage) must pass before merge
- **Deploy:** Auto-deploy to Cloud Run on push to main (builds Docker image, pushes to Artifact Registry)
- **Workload Identity Federation** for GCP auth (no service account keys in CI)

## Troubleshooting

### "gcloud: command not found"

The gcloud CLI isn't installed. If you're on a clawd-provisioned server, it should be pre-installed via cloud-init. Otherwise:

```bash
# Debian/Ubuntu — install from Google's apt repo
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg
echo "deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt-get update && sudo apt-get install -y google-cloud-cli
```

### "Permission denied" on `gcloud run services logs read`

You need a GCP service account with read-only access. Run the bootstrap script from the `clawd` repo:

```bash
# From a machine with GCP admin access:
./scripts/gcp-setup.sh <gcp-project-id> <bot-name>
```

This creates a `<bot-name>-readonly` service account with `roles/run.viewer` + `roles/logging.viewer`, stores the key in `pass`, and activates it. The key lives at `pass bot-<bot-name>/gcp/<project-id>/sa-key`.

If the key is in pass but not activated (e.g. after server rebuild):

```bash
# Re-activate from pass
TMPKEY=$(mktemp) && pass show bot-<bot-name>/gcp/<project-id>/sa-key > "$TMPKEY" \
  && gcloud auth activate-service-account --key-file="$TMPKEY" --project=<project-id> \
  && rm "$TMPKEY"
```

### "bun: command not found"

This project uses Bun, not Node. Install:

```bash
curl -fsSL https://bun.sh/install | bash
```

### Tests fail with "Cannot find module" after git pull

```bash
bun install  # Reinstall deps after lockfile changes
```

### Terraform errors / missing variables

Never run `terraform` directly — always use the Makefile from `terraform/`:

```bash
cd terraform && make plan  # Loads secrets from ../.env.local automatically
```

### Cloud Run logs show "Container failed to start"

Check memory limits (Puppeteer needs 2Gi) and environment variables:

```bash
bun run logs          # Tail Cloud Run logs
bun run healthcheck   # Hit /health endpoint
```

## Boundaries

- ✅ **Do:** Add sources, fix formatting, improve tests, update Terraform
- ✅ **Do:** Run `bun dev --dry-run` to verify changes locally
- ⚠️ **Ask first:** Changing Telegram message format (user-facing), adding new GCP services, modifying CI pipeline
- 🚫 **Never:** Raw `gcloud` infra commands, hardcode secrets, modify `.env.local` without asking, bypass trunk/typecheck
