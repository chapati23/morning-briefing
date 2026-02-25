import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

/** Assert value is defined and return it (avoids non-null assertions). */
const defined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  return value as T;
};

import {
  calculateScore,
  filterTrades,
  formatTradeItem,
  mockCongressTradesSource,
  parseAmountRange,
  parseAmountValue,
  parseCapitolTradesHTML,
  type CongressTrade,
} from "../src/sources/congress-trades";

// ============================================================================
// Amount Parsing
// ============================================================================

describe("parseAmountValue", () => {
  it("parses K values", () => {
    expect(parseAmountValue("1K")).toBe(1_000);
    expect(parseAmountValue("15K")).toBe(15_000);
    expect(parseAmountValue("100K")).toBe(100_000);
    expect(parseAmountValue("250K")).toBe(250_000);
  });

  it("parses M values", () => {
    expect(parseAmountValue("1M")).toBe(1_000_000);
    expect(parseAmountValue("5M")).toBe(5_000_000);
    expect(parseAmountValue("25M")).toBe(25_000_000);
  });

  it("handles plain numbers", () => {
    expect(parseAmountValue("50000")).toBe(50_000);
  });

  it("returns 0 for garbage", () => {
    expect(parseAmountValue("")).toBe(0);
    expect(parseAmountValue("Undisclosed")).toBe(0);
  });
});

describe("parseAmountRange", () => {
  it("parses K–K ranges", () => {
    expect(parseAmountRange("1K–15K")).toBe(1_000);
    expect(parseAmountRange("15K–50K")).toBe(15_000);
    expect(parseAmountRange("50K–100K")).toBe(50_000);
    expect(parseAmountRange("100K–250K")).toBe(100_000);
    expect(parseAmountRange("250K–500K")).toBe(250_000);
  });

  it("parses K–M ranges", () => {
    expect(parseAmountRange("500K–1M")).toBe(500_000);
  });

  it("parses M–M ranges", () => {
    expect(parseAmountRange("1M–5M")).toBe(1_000_000);
    expect(parseAmountRange("5M–25M")).toBe(5_000_000);
    expect(parseAmountRange("25M–50M")).toBe(25_000_000);
  });

  it("returns 0 for empty/undisclosed", () => {
    expect(parseAmountRange("")).toBe(0);
    expect(parseAmountRange("Undisclosed")).toBe(0);
  });
});

// ============================================================================
// Scoring
// ============================================================================

describe("calculateScore", () => {
  it("returns 0 for trades below $100K", () => {
    expect(
      calculateScore({
        amountLower: 50_000,
        politician: "Nobody",
        type: "buy",
        filingLagDays: 15,
      }),
    ).toBe(0);
  });

  it("scores basic $100K buy by unknown member", () => {
    // base=1, multiplier=1, direction=1, freshness=1
    expect(
      calculateScore({
        amountLower: 100_000,
        politician: "Unknown Member",
        type: "buy",
        filingLagDays: 15,
      }),
    ).toBe(1);
  });

  it("scores Pelosi $1M+ buy with quick filing as hot", () => {
    // base=5, multiplier=2, direction=1, freshness=1.5
    const score = calculateScore({
      amountLower: 1_000_000,
      politician: "Nancy Pelosi",
      type: "buy",
      filingLagDays: 5,
    });
    expect(score).toBe(15);
  });

  it("scores tier-2 sell of $250K with normal filing", () => {
    // base=2, multiplier=2, direction=1.5, freshness=1
    const score = calculateScore({
      amountLower: 250_000,
      politician: "Jack Reed",
      type: "sell",
      filingLagDays: 15,
    });
    expect(score).toBe(6);
  });

  it("applies staleness penalty for old filings", () => {
    // base=1, multiplier=1, direction=1, freshness=0.5
    const score = calculateScore({
      amountLower: 100_000,
      politician: "Unknown",
      type: "buy",
      filingLagDays: 45,
    });
    expect(score).toBe(0.5);
  });

  it("boosts sells vs buys", () => {
    const buyScore = calculateScore({
      amountLower: 250_000,
      politician: "Unknown",
      type: "buy",
      filingLagDays: 15,
    });
    const sellScore = calculateScore({
      amountLower: 250_000,
      politician: "Unknown",
      type: "sell",
      filingLagDays: 15,
    });
    expect(sellScore).toBe(buyScore * 1.5);
  });
});

// ============================================================================
// HTML Parsing
// ============================================================================

describe("parseCapitolTradesHTML", () => {
  const fixturePath = path.join(__dirname, "fixtures", "capitoltrades.html");
  const html = fs.readFileSync(fixturePath, "utf8");

  it("parses trades from real HTML", () => {
    const trades = parseCapitolTradesHTML(html);
    expect(trades.length).toBeGreaterThan(0);
  });

  it("extracts politician name", () => {
    const trades = parseCapitolTradesHTML(html);
    const first = trades[0];
    expect(first).toBeDefined();
    expect(defined(first).politician.length).toBeGreaterThan(0);
  });

  it("extracts party", () => {
    const trades = parseCapitolTradesHTML(html);
    for (const trade of trades) {
      expect(["D", "R", "I"]).toContain(trade.party);
    }
  });

  it("extracts ticker", () => {
    const trades = parseCapitolTradesHTML(html);
    const first = trades[0];
    expect(first).toBeDefined();
    // Ticker should not contain ":US" suffix
    expect(defined(first).ticker).not.toContain(":");
    expect(defined(first).ticker.length).toBeGreaterThan(0);
  });

  it("extracts amount range", () => {
    const trades = parseCapitolTradesHTML(html);
    const first = trades[0];
    expect(first).toBeDefined();
    expect(defined(first).amountRange.length).toBeGreaterThan(0);
    expect(defined(first).amountLower).toBeGreaterThan(0);
  });

  it("extracts trade type", () => {
    const trades = parseCapitolTradesHTML(html);
    for (const trade of trades) {
      expect(["buy", "sell"]).toContain(trade.type);
    }
  });

  it("returns empty array for empty HTML", () => {
    expect(parseCapitolTradesHTML("")).toEqual([]);
    expect(parseCapitolTradesHTML("<html><body></body></html>")).toEqual([]);
  });

  it("returns empty array for HTML without table", () => {
    expect(
      parseCapitolTradesHTML("<html><body><p>No table here</p></body></html>"),
    ).toEqual([]);
  });
});

// ============================================================================
// Filtering
// ============================================================================

describe("filterTrades", () => {
  const makeTrade = (overrides: Partial<CongressTrade>): CongressTrade => ({
    politician: "Test Member",
    party: "D",
    chamber: "House",
    state: "CA",
    company: "Test Corp",
    ticker: "TEST",
    tradeDate: new Date(),
    disclosureDate: new Date(),
    filingLagDays: 15,
    owner: "Self",
    type: "buy",
    amountRange: "100K–250K",
    amountLower: 100_000,
    price: "$100",
    score: 5,
    hot: false,
    ...overrides,
  });

  it("excludes ETF tickers", () => {
    const trades = [
      makeTrade({ ticker: "SPY", score: 10 }),
      makeTrade({ ticker: "QQQ", score: 10 }),
      makeTrade({ ticker: "NVDA", score: 5 }),
    ];
    const result = filterTrades(trades);
    expect(result.length).toBe(1);
    expect(defined(result[0]).ticker).toBe("NVDA");
  });

  it("excludes trades below $100K", () => {
    const trades = [
      makeTrade({ amountLower: 50_000, score: 5 }),
      makeTrade({ amountLower: 100_000, score: 5 }),
    ];
    const result = filterTrades(trades);
    expect(result.length).toBe(1);
  });

  it("excludes trades with score < 3", () => {
    const trades = [
      makeTrade({ score: 1 }),
      makeTrade({ score: 2.9 }),
      makeTrade({ score: 3 }),
    ];
    const result = filterTrades(trades);
    expect(result.length).toBe(1);
    expect(defined(result[0]).score).toBe(3);
  });

  it("sorts by score descending", () => {
    const trades = [
      makeTrade({ score: 3, ticker: "A" }),
      makeTrade({ score: 10, ticker: "B" }),
      makeTrade({ score: 6, ticker: "C" }),
    ];
    const result = filterTrades(trades);
    expect(result.map((t) => t.ticker)).toEqual(["B", "C", "A"]);
  });
});

// ============================================================================
// Formatting
// ============================================================================

describe("formatTradeItem", () => {
  const makeTrade = (overrides: Partial<CongressTrade>): CongressTrade => ({
    politician: "Nancy Pelosi",
    party: "D",
    chamber: "House",
    state: "CA",
    company: "NVIDIA",
    ticker: "NVDA",
    tradeDate: new Date("2026-01-15"),
    disclosureDate: new Date("2026-02-20"),
    filingLagDays: 5,
    owner: "Self",
    type: "buy",
    amountRange: "1M–5M",
    amountLower: 1_000_000,
    price: "$130",
    score: 15,
    hot: true,
    ...overrides,
  });

  it("formats hot trade with 🔥 prefix", () => {
    const { text } = formatTradeItem(makeTrade({}));
    expect(text).toStartWith("🔥");
    expect(text).toContain("Nancy Pelosi");
    expect(text).toContain("NVDA");
    expect(text).toContain("purchased");
  });

  it("formats non-hot trade without 🔥", () => {
    const { text } = formatTradeItem(makeTrade({ hot: false }));
    expect(text).not.toContain("🔥");
  });

  it("formats sell as 'sold'", () => {
    const { text } = formatTradeItem(makeTrade({ type: "sell" }));
    expect(text).toContain("sold");
  });

  it("includes chamber prefix", () => {
    const { text: repText } = formatTradeItem(makeTrade({ chamber: "House" }));
    expect(repText).toContain("Rep.");
    const { text: senText } = formatTradeItem(makeTrade({ chamber: "Senate" }));
    expect(senText).toContain("Sen.");
  });

  it("includes party-state", () => {
    const { text } = formatTradeItem(makeTrade({}));
    expect(text).toContain("D-CA");
  });

  it("includes detail with amount and dates", () => {
    const { detail } = formatTradeItem(makeTrade({}));
    expect(detail).toContain("1M");
    expect(detail).toContain("traded");
    expect(detail).toContain("filed");
  });
});

// ============================================================================
// Mock Source
// ============================================================================

describe("mockCongressTradesSource", () => {
  it("returns predictable data", async () => {
    const result = await mockCongressTradesSource.fetch(new Date());
    expect(Array.isArray(result)).toBe(false);
    const section = result as {
      title: string;
      icon: string;
      items: readonly { text: string }[];
    };
    expect(section.title).toBe("Congress Trades");
    expect(section.icon).toBe("🏛");
    expect(section.items.length).toBe(2);
    expect(defined(section.items[0]).text).toContain("Pelosi");
  });

  it("has correct priority", () => {
    expect(mockCongressTradesSource.priority).toBe(6);
  });
});
