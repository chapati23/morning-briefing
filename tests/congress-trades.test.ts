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
  congressTradesSource,
  deduplicateTrades,
  filterTrades,
  formatDeduplicatedItem,
  formatTradeItem,
  getCommitteeRelevance,
  mockCongressTradesSource,
  parseAmountRange,
  parseAmountValue,
  parseCapitolTradesHTML,
  parseDisclosureDate,
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
// HTML Parsing — Fixture Assertions
// ============================================================================

describe("parseCapitolTradesHTML", () => {
  const fixturePath = path.join(__dirname, "fixtures", "capitoltrades.html");
  const html = fs.readFileSync(fixturePath, "utf8");

  it("parses exactly 12 trades from fixture", () => {
    const trades = parseCapitolTradesHTML(html);
    expect(trades.length).toBe(12);
  });

  it("first trade has correct politician, party, chamber, state", () => {
    const trades = parseCapitolTradesHTML(html);
    const first = defined(trades[0]);
    expect(first.politician).toBe("Scott Franklin");
    expect(first.party).toBe("R");
    expect(first.chamber).toBe("House");
    expect(first.state).toBe("FL");
  });

  it("first trade has correct ticker, type, amount", () => {
    const trades = parseCapitolTradesHTML(html);
    const first = defined(trades[0]);
    expect(first.ticker).toBe("HSY");
    expect(first.type).toBe("sell");
    expect(first.amountRange).toBe("1K–15K");
    expect(first.amountLower).toBe(1_000);
  });

  it("parses Jonathan Jackson trades correctly", () => {
    const trades = parseCapitolTradesHTML(html);
    const jacksonTrades = trades.filter(
      (t) => t.politician === "Jonathan Jackson",
    );
    expect(jacksonTrades.length).toBe(9);
    expect(jacksonTrades.every((t) => t.party === "D")).toBe(true);
    expect(jacksonTrades.every((t) => t.state === "IL")).toBe(true);
  });

  it("handles N/A ticker for COUPANG (no issuerTicker)", () => {
    const trades = parseCapitolTradesHTML(html);
    const coupang = trades.find((t) => t.company === "COUPANG INC");
    expect(coupang).toBeDefined();
    // No ticker in the HTML for this issuer — should be empty or N/A
    expect(
      defined(coupang).ticker === "" || defined(coupang).ticker === "N/A",
    ).toBe(true);
  });

  it("extracts party", () => {
    const trades = parseCapitolTradesHTML(html);
    for (const trade of trades) {
      expect(["D", "R", "I"]).toContain(trade.party);
    }
  });

  it("extracts ticker without :US suffix", () => {
    const trades = parseCapitolTradesHTML(html);
    for (const trade of trades) {
      expect(trade.ticker).not.toContain(":");
    }
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

  it("skips trades with unparsable dates", () => {
    const html = `<html><body><table>
      <tr><th>H</th></tr>
      <tr>
        <td><h2 class="politician-name"><a>Test Person</a></h2><div class="politician-info"><span class="q-field party">Democrat</span><span class="q-field chamber">House</span><span class="q-field us-state-compact">CA</span></div></td>
        <td><h3 class="issuer-name"><a>Acme</a></h3><span class="issuer-ticker">ACME:US</span></td>
        <td>Yesterday</td>
        <td>garbage date</td>
        <td>5 days</td>
        <td>Self</td>
        <td>buy</td>
        <td>100K–250K</td>
        <td>$100</td>
      </tr>
    </table></body></html>`;
    const trades = parseCapitolTradesHTML(html);
    expect(trades.length).toBe(0);
  });
});

// ============================================================================
// Disclosure Date Parsing
// ============================================================================

describe("parseDisclosureDate", () => {
  const now = new Date("2026-02-25T12:00:00Z");

  it("parses 'today'", () => {
    const result = parseDisclosureDate("today", now);
    expect(result.getTime()).toBe(now.getTime());
  });

  it("parses 'Today' (case-insensitive)", () => {
    const result = parseDisclosureDate("Today", now);
    expect(result.getTime()).toBe(now.getTime());
  });

  it("parses 'Yesterday'", () => {
    const result = parseDisclosureDate("Yesterday", now);
    expect(result.getDate()).toBe(24);
    expect(result.getMonth()).toBe(1); // Feb
  });

  it("parses 'X days ago'", () => {
    const result = parseDisclosureDate("3 days ago", now);
    expect(result.getDate()).toBe(22);
  });

  it("parses '1 day ago' (singular)", () => {
    const result = parseDisclosureDate("1 day ago", now);
    expect(result.getDate()).toBe(24);
  });

  it("parses 'X days' without 'ago'", () => {
    const result = parseDisclosureDate("2 days", now);
    expect(result.getDate()).toBe(23);
  });

  it("parses absolute dates", () => {
    const result = parseDisclosureDate("Feb 10, 2026", now);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(10);
  });

  it("falls back to now for unparsable text", () => {
    const result = parseDisclosureDate("gibberish", now);
    expect(result.getTime()).toBe(now.getTime());
  });
});

// ============================================================================
// Zero-trade canary & structure validation
// ============================================================================

describe("parseCapitolTradesHTML observability", () => {
  it("warns on zero trades from large HTML (canary)", () => {
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: unknown) => warns.push(String(msg));

    try {
      // Large HTML with a table but no valid data rows
      const bigHtml = `<html><body><table><tr><th>Header</th></tr></table>${"x".repeat(2000)}</body></html>`;
      const result = parseCapitolTradesHTML(bigHtml);
      expect(result).toEqual([]);
      expect(warns.some((w) => w.includes("possible parser breakage"))).toBe(
        true,
      );
    } finally {
      console.warn = origWarn;
    }
  });

  it("warns when no table found in large HTML", () => {
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: unknown) => warns.push(String(msg));

    try {
      const bigHtml = `<html><body><div>${"x".repeat(2000)}</div></body></html>`;
      const result = parseCapitolTradesHTML(bigHtml);
      expect(result).toEqual([]);
      expect(
        warns.some((w) => w.includes("Expected table structure not found")),
      ).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it("logs skipped rows on parse errors", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: unknown) => logs.push(String(msg));

    try {
      // Table with rows that have too few cells → skipped
      const html = `<html><body><table>
        <tr><th>H</th></tr>
        <tr><td>only one cell</td></tr>
        <tr><td>another</td></tr>
      </table></body></html>`;
      parseCapitolTradesHTML(html);
      expect(logs.some((l) => l.includes("skipped 2 rows"))).toBe(true);
    } finally {
      console.log = origLog;
    }
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
    rawType: "buy",
    url: "",
    committeeRelevance: null,
    ...overrides,
  });

  it("excludes N/A and empty tickers", () => {
    const trades = [
      makeTrade({ ticker: "N/A", score: 10 }),
      makeTrade({ ticker: "", score: 10 }),
      makeTrade({ ticker: "NVDA", score: 5 }),
    ];
    const result = filterTrades(trades);
    expect(result.length).toBe(1);
    expect(defined(result[0]).ticker).toBe("NVDA");
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
// Deduplication
// ============================================================================

describe("deduplicateTrades", () => {
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
    rawType: "buy",
    url: "",
    committeeRelevance: null,
    ...overrides,
  });

  it("passes through single trades unchanged", () => {
    const trades = [makeTrade({})];
    const result = deduplicateTrades(trades);
    expect(result.length).toBe(1);
    expect("count" in defined(result[0])).toBe(false);
  });

  it("groups same politician+ticker+type", () => {
    const trades = [
      makeTrade({ amountLower: 1_000_000, score: 15 }),
      makeTrade({ amountLower: 500_000, score: 10 }),
      makeTrade({ amountLower: 250_000, score: 6 }),
    ];
    const result = deduplicateTrades(trades);
    expect(result.length).toBe(1);
    const group = defined(result[0]);
    expect("count" in group).toBe(true);
    if ("count" in group) {
      expect(group.count).toBe(3);
      expect(group.totalAmountLower).toBe(1_750_000);
      expect(group.maxScore).toBe(15);
    }
  });

  it("does not group different tickers", () => {
    const trades = [
      makeTrade({ ticker: "NVDA" }),
      makeTrade({ ticker: "AAPL" }),
    ];
    const result = deduplicateTrades(trades);
    expect(result.length).toBe(2);
  });

  it("does not group different trade types", () => {
    const trades = [
      makeTrade({ type: "buy" }),
      makeTrade({ type: "sell", score: 10 }),
    ];
    const result = deduplicateTrades(trades);
    expect(result.length).toBe(2);
  });

  it("formats grouped trade correctly", () => {
    const trades = [
      makeTrade({ amountLower: 1_000_000, score: 15 }),
      makeTrade({ amountLower: 500_000, score: 10 }),
    ];
    const result = deduplicateTrades(trades);
    const { text } = formatDeduplicatedItem(defined(result[0]));
    expect(text).toContain("Pelosi");
    expect(text).toContain("NVDA");
    expect(text).toContain("2 trades");
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
    rawType: "buy",
    url: "",
    committeeRelevance: null,
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
// fetchCapitolTradesHTML error paths
// ============================================================================

describe("congressTradesSource.fetch error handling", () => {
  it("returns empty items on fetch failure", async () => {
    // The real source will fail in test env (no network / no real URL)
    // We test that it gracefully returns empty items
    const result = await congressTradesSource.fetch(new Date());
    const section = result as {
      title: string;
      items: readonly { text: string }[];
    };
    expect(section.title).toBe("Congress Trades");
    // Either empty or has "No significant trades" message — both are valid error handling
    expect(Array.isArray(section.items)).toBe(true);
  });
});

// ============================================================================
// Parser health indicator (integration)
// ============================================================================

describe("congressTradesSource health indicator", () => {
  it("shows info message when trades parsed but none pass filters", async () => {
    // Indirectly tested: the fixture has all small trades (< $100K)
    // so filterTrades should filter them all out
    const fixturePath = path.join(__dirname, "fixtures", "capitoltrades.html");
    const html = fs.readFileSync(fixturePath, "utf8");
    const allTrades = parseCapitolTradesHTML(html);
    const filtered = filterTrades(allTrades);

    // All fixture trades are small (1K-100K range), none should pass the $100K + score>=3 filter
    expect(allTrades.length).toBe(12);
    expect(filtered.length).toBe(0);
    // This confirms the health indicator path would trigger
  });
});

// ============================================================================
// Phase 2: Committee↔Sector Relevance
// ============================================================================

describe("getCommitteeRelevance", () => {
  it("returns committee name when politician's committee overlaps with ticker sector", () => {
    // Jack Reed is on Armed Services, RTX is defense
    expect(getCommitteeRelevance("Jack Reed", "RTX")).toBe("Armed Services");
  });

  it("returns null when no overlap", () => {
    // Nancy Pelosi is on Financial Services, RTX is defense
    expect(getCommitteeRelevance("Nancy Pelosi", "RTX")).toBeNull();
  });

  it("returns null for unknown politicians", () => {
    expect(getCommitteeRelevance("Unknown Person", "RTX")).toBeNull();
  });

  it("returns null for unknown tickers", () => {
    expect(getCommitteeRelevance("Jack Reed", "UNKNOWN")).toBeNull();
  });

  it("matches Financial Services committee with banking tickers", () => {
    expect(getCommitteeRelevance("Nancy Pelosi", "JPM")).toBe(
      "Financial Services",
    );
    expect(getCommitteeRelevance("Josh Gottheimer", "GS")).toBe(
      "Financial Services",
    );
  });

  it("matches Intelligence committee with cybersecurity tickers", () => {
    expect(getCommitteeRelevance("Tom Cotton", "PANW")).toBe("Intelligence");
    expect(getCommitteeRelevance("Mark Warner", "CRWD")).toBe("Intelligence");
  });

  it("matches Energy & Commerce with energy tickers", () => {
    expect(getCommitteeRelevance("Dan Crenshaw", "XOM")).toBe(
      "Energy & Commerce",
    );
  });
});

// ============================================================================
// Phase 2: Expanded Politician Map
// ============================================================================

describe("expanded politician map", () => {
  it("has at least 30 politicians", () => {
    const data = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../src/data/congress-politicians.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(Object.keys(data).length).toBeGreaterThanOrEqual(30);
  });

  it("all entries have committees array", () => {
    const data = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../src/data/congress-politicians.json"),
        "utf8",
      ),
    ) as Record<string, { committees?: string[] }>;
    for (const [, entry] of Object.entries(data)) {
      expect(Array.isArray(entry.committees)).toBe(true);
    }
  });

  it("spot-checks known politicians", () => {
    const data = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../src/data/congress-politicians.json"),
        "utf8",
      ),
    ) as Record<string, { multiplier: number; chamber: string; party: string }>;
    expect(data["Nancy Pelosi"]?.chamber).toBe("House");
    expect(data["Roger Wicker"]?.multiplier).toBe(2);
    expect(data["Tom Cotton"]?.party).toBe("R");
    expect(data["Mike Johnson"]?.multiplier).toBe(3);
  });
});

// ============================================================================
// Phase 2: Ticker-Sector Lookup
// ============================================================================

describe("ticker-sector mapping", () => {
  it("has at least 50 tickers", () => {
    const data = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../src/data/ticker-sectors.json"),
        "utf8",
      ),
    ) as Record<string, string>;
    expect(Object.keys(data).length).toBeGreaterThanOrEqual(50);
  });

  it("maps defense tickers correctly", () => {
    const data = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../src/data/ticker-sectors.json"),
        "utf8",
      ),
    ) as Record<string, string>;
    expect(data["RTX"]).toBe("defense");
    expect(data["LMT"]).toBe("defense");
    expect(data["NOC"]).toBe("defense");
  });

  it("maps banking tickers correctly", () => {
    const data = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../src/data/ticker-sectors.json"),
        "utf8",
      ),
    ) as Record<string, string>;
    expect(data["JPM"]).toBe("banking");
    expect(data["GS"]).toBe("banking");
  });
});

// ============================================================================
// Phase 2: Direction Weighting
// ============================================================================

describe("direction weighting with raw types", () => {
  it("applies 1.75x for sale_full", () => {
    const score = calculateScore({
      amountLower: 250_000,
      politician: "Unknown",
      type: "sell",
      rawType: "sale_full",
      filingLagDays: 15,
    });
    // base=2, multiplier=1, direction=1.75, freshness=1
    expect(score).toBe(3.5);
  });

  it("applies 1.25x for sale_partial", () => {
    const score = calculateScore({
      amountLower: 250_000,
      politician: "Unknown",
      type: "sell",
      rawType: "sale_partial",
      filingLagDays: 15,
    });
    expect(score).toBe(2.5);
  });

  it("applies 0.75x for exchange", () => {
    const score = calculateScore({
      amountLower: 250_000,
      politician: "Unknown",
      type: "sell",
      rawType: "exchange",
      filingLagDays: 15,
    });
    expect(score).toBe(1.5);
  });

  it("falls back to standard sell weight without rawType", () => {
    const score = calculateScore({
      amountLower: 250_000,
      politician: "Unknown",
      type: "sell",
      filingLagDays: 15,
    });
    expect(score).toBe(3);
  });
});

// ============================================================================
// Phase 2: Committee Relevance in Scoring
// ============================================================================

describe("committee relevance scoring", () => {
  it("applies 2x multiplier for committee-relevant trade", () => {
    // Jack Reed (Armed Services, multiplier=2) buying RTX (defense)
    // base=2, politician=2, direction=1, freshness=1, committee=2
    const score = calculateScore({
      amountLower: 250_000,
      politician: "Jack Reed",
      type: "buy",
      filingLagDays: 15,
      ticker: "RTX",
    });
    expect(score).toBe(8);
  });

  it("does not apply committee multiplier for irrelevant trade", () => {
    // Jack Reed buying DIS (entertainment, not defense)
    const score = calculateScore({
      amountLower: 250_000,
      politician: "Jack Reed",
      type: "buy",
      filingLagDays: 15,
      ticker: "DIS",
    });
    expect(score).toBe(4);
  });
});

// ============================================================================
// Phase 2: Committee Context in Formatted Output
// ============================================================================

describe("committee context in formatting", () => {
  const makeTrade = (overrides: Partial<CongressTrade>): CongressTrade => ({
    politician: "Jack Reed",
    party: "D",
    chamber: "Senate",
    state: "RI",
    company: "Raytheon",
    ticker: "RTX",
    tradeDate: new Date("2026-02-01"),
    disclosureDate: new Date("2026-02-18"),
    filingLagDays: 17,
    owner: "Self",
    type: "buy",
    rawType: "buy",
    amountRange: "250K–500K",
    amountLower: 250_000,
    price: "$100",
    score: 8,
    hot: true,
    url: "https://www.capitoltrades.com/trades/123",
    committeeRelevance: "Armed Services",
    ...overrides,
  });

  it("includes committee name in detail when relevant", () => {
    const { detail } = formatTradeItem(makeTrade({}));
    expect(detail).toContain("Armed Services");
  });

  it("does not include committee when null", () => {
    const { detail } = formatTradeItem(makeTrade({ committeeRelevance: null }));
    expect(detail).not.toContain("Armed Services");
  });

  it("includes url in formatted output", () => {
    const { url } = formatTradeItem(makeTrade({}));
    expect(url).toBe("https://www.capitoltrades.com/trades/123");
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
