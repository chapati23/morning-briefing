# Morning Briefing

A daily notification service that aggregates financial data and sends it to you
via Telegram. Runs on Google Cloud Platform with zero ongoing cost (within free
tier).

## What You Get

Every morning, receive a Telegram message with:

- ETF fund flows (SPY, QQQ, etc.)
- Economic calendar highlights
- Prediction market movements
- And more...

## Quick Start

```bash
# Install dependencies
bun install

# Run setup (creates GCP project, configures auth)
./scripts/setup.sh

# Add your Telegram credentials to .env.local
# (Create a bot with @BotFather, get your chat ID with `bun run get-chat-id`)

# Deploy to GCP
cd terraform && make deploy
```

See [docs/deploy-from-scratch.md](docs/deploy-from-scratch.md) for detailed
instructions.

## Local Development

```bash
# Install dependencies
bun install

# Copy example env and add your credentials
cp .env.example .env.local

# Run locally
bun dev
```

## Architecture

### Infrastructure

| Component         | Purpose                       |
| ----------------- | ----------------------------- |
| Cloud Run         | Serverless container hosting  |
| Cloud Scheduler   | Daily trigger (cron)          |
| Artifact Registry | Docker image storage          |
| Secret Manager    | Telegram credentials          |
| GitHub Actions    | CI/CD (automatic deployments) |

### Code Structure

```text
src/
├── sources/          # Data sources (one file per integration)
│   ├── index.ts      # Source registry — add new sources here
│   ├── etf-flows.ts  # BTC/ETH/SOL ETF flows (Puppeteer)
│   ├── overnight-futures.ts
│   ├── economic-calendar.ts
│   ├── appstore-rankings.ts
│   ├── daily-degen.ts
│   └── polymarket.ts
├── channels/
│   └── telegram.ts   # Telegram formatting + delivery
├── orchestrator.ts   # Wires sources → sections → channels
├── types.ts          # Shared types (start here)
└── index.ts          # Cloud Run HTTP entry point
```

**Data flow:** `DataSource.fetch()` → `orchestrator` (parallel, fail-tolerant) → `formatBriefingForTelegram` → Telegram Bot API

Each source exports both a real implementation and a `mock*Source` for local development. See [AGENTS.md](./AGENTS.md) for the full code guide.

## Commands

| Command               | Description                           |
| --------------------- | ------------------------------------- |
| `bun dev`             | Run locally                           |
| `bun test`            | Run tests                             |
| `make deploy`         | Deploy to GCP (build + push + apply)  |
| `make github-secrets` | Enable CI/CD (run after first deploy) |
| `make plan`           | Preview infrastructure changes        |
| `make destroy`        | Tear down all infrastructure          |

Run `make` commands from the `terraform/` directory.

## Cost

**$0/month** for typical usage (once-daily briefings stay within GCP free tier).

## License

MIT
