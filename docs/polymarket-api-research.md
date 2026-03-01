# Polymarket Gamma API Research: Structured Outcome Names

**Date:** 2026-03-01
**Goal:** Replace brittle regex-based `extractOutcomeName` with structured API data

## TL;DR

**Use `groupItemTitle`** — it's a first-class field on every market within a multi-outcome event. It contains exactly the short label we've been trying to regex-extract from `question`. No parsing needed.

## The `groupItemTitle` Field

Every market object in the Gamma API response includes `groupItemTitle` (string) for multi-market events. This is the structured outcome label that Polymarket uses internally for grouping.

### Examples from live API responses

| Event                                 | `question`                                                                     | `groupItemTitle`    |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------------------- |
| Fed decision in March                 | "Will the Fed decrease interest rates by 25 bps after the March 2026 meeting?" | `"25 bps decrease"` |
| Who will Trump nominate as Fed Chair? | "Will Trump nominate Kevin Warsh as the next Fed chair?"                       | `"Kevin Warsh"`     |
| Next Country US Strikes               | "Will the US strike Somalia next?"                                             | `"Somalia"`         |
| Bitcoin above \_\_\_ on March 1?      | "Will the price of Bitcoin be above $60,000 on March 1?"                       | `"60,000"`          |
| 2026 FIFA World Cup Winner            | "Will Spain win the 2026 FIFA World Cup?"                                      | `"Spain"`           |
| Elon Musk # tweets                    | "Will Elon Musk post 0-19 tweets from February 24 to March 3, 2026?"           | `"<20"`             |
| Will Khamenei leave Iran by...?       | "Will Khamenei leave Iran by Feb 28?"                                          | `"February 28"`     |

### Key observations

1. **Always present** on multi-market events (events with >1 market)
2. **Clean, short labels** — exactly what we need for display
3. **Empty string** on some single-market entries within sports events (e.g., the main moneyline market), but all sub-markets have it
4. **No auth required** — same public `/events` endpoint we already use
5. **No rate limits observed** — standard REST, no auth headers needed

## Other Useful Fields We're Not Using

From the full market object (90+ fields), these are notable additions:

| Field                   | Type                  | Description                                                   |
| ----------------------- | --------------------- | ------------------------------------------------------------- |
| `groupItemTitle`        | `string`              | **The key field** — structured outcome label                  |
| `groupItemThreshold`    | `number`              | Threshold value for numeric markets (e.g., price targets)     |
| `negRisk`               | `boolean`             | Whether this is a negative-risk (multi-outcome) market        |
| `negRiskOther`          | `boolean`             | Whether this is the "Other" catch-all outcome                 |
| `bestBid` / `bestAsk`   | `number`              | Current order book prices (more precise than `outcomePrices`) |
| `acceptingOrders`       | `boolean`             | Whether the market is currently tradeable                     |
| `clobTokenIds`          | `string` (JSON array) | Token IDs for the CLOB (if needed for deeper integration)     |
| `outcomes`              | `string` (JSON array) | Always `["Yes", "No"]` for binary markets                     |
| `competitive`           | `number`              | Competitiveness score (0-1)                                   |
| `orderPriceMinTickSize` | `number`              | Min tick size (e.g., 0.001)                                   |

## Recommended Implementation

### 1. Update `GammaMarket` interface

```typescript
interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomePrices: string;
  volume: string;
  volumeNum: number;
  volume24hr: number;
  liquidity: string;
  liquidityNum: number;
  endDate: string;
  category: string;
  oneDayPriceChange: number;
  oneHourPriceChange: number;
  oneWeekPriceChange: number;
  lastTradePrice: number;
  // NEW FIELDS
  groupItemTitle?: string; // Structured outcome label
  groupItemThreshold?: number;
  negRisk?: boolean;
  negRiskOther?: boolean;
  bestBid?: number;
  bestAsk?: number;
}
```

### 2. Replace `extractOutcomeName`

```typescript
function getOutcomeLabel(market: GammaMarket): string {
  // Use groupItemTitle if available (multi-market events)
  if (market.groupItemTitle) {
    return market.groupItemTitle;
  }
  // Fallback to existing regex for single-market events (shouldn't be needed
  // for multi-outcome events, but keeps backward compat)
  return extractOutcomeName(market.question);
}
```

### 3. That's it

No need to hit the CLOB API, no additional endpoints, no auth. The field is already in the response — we just weren't reading it.

## What About the CLOB API?

The CLOB API (`clob.polymarket.com`) provides order book data and trading functionality. It doesn't add useful metadata beyond what Gamma provides. The Gamma API is the correct source for market metadata.

## Endpoint Details

- **URL:** `https://gamma-api.polymarket.com/events`
- **Method:** GET
- **Auth:** None (public)
- **Useful params:** `active`, `closed`, `order`, `ascending`, `limit`, `offset`, `slug`, `id`
- **Response:** Array of event objects, each containing a `markets` array with full market objects

No formal API docs or OpenAPI spec exists — the API is undocumented but stable and widely used by third-party tools.
