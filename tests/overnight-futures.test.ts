/**
 * Tests for overnight futures formatting, sentiment, and error handling
 */

import { describe, expect, it } from "bun:test";
import {
  buildAlignedFuturesItems,
  buildFuturesItem,
  formatPercent,
  formatPrice,
  getSentiment,
} from "../src/sources/overnight-futures";

// ============================================================================
// formatPercent
// ============================================================================

describe("formatPercent", () => {
  it("formats positive values with + sign", () => {
    expect(formatPercent(0.45)).toBe("+0.45%");
    expect(formatPercent(1.12)).toBe("+1.12%");
  });

  it("formats negative values with - sign", () => {
    expect(formatPercent(-0.23)).toBe("-0.23%");
    expect(formatPercent(-1.45)).toBe("-1.45%");
  });

  it("formats zero as +0.00%", () => {
    expect(formatPercent(0)).toBe("+0.00%");
  });

  it("rounds to two decimal places", () => {
    expect(formatPercent(0.456)).toBe("+0.46%");
    expect(formatPercent(-1.234)).toBe("-1.23%");
  });

  it("handles large values", () => {
    expect(formatPercent(12.5)).toBe("+12.50%");
    expect(formatPercent(-8.3)).toBe("-8.30%");
  });
});

// ============================================================================
// formatPrice
// ============================================================================

describe("formatPrice", () => {
  it("formats with two decimal places", () => {
    expect(formatPrice(5432.25)).toBe("5,432.25");
    expect(formatPrice(78.23)).toBe("78.23");
  });

  it("adds trailing zeros", () => {
    expect(formatPrice(100)).toBe("100.00");
    expect(formatPrice(2.3)).toBe("2.30");
  });

  it("formats large numbers with commas", () => {
    expect(formatPrice(18765.5)).toBe("18,765.50");
  });

  it("formats small numbers", () => {
    expect(formatPrice(1.0845)).toBe("1.08");
  });
});

// ============================================================================
// getSentiment
// ============================================================================

describe("getSentiment", () => {
  it("returns positive for small gains", () => {
    expect(getSentiment(0.45)).toBe("positive");
    expect(getSentiment(0.2)).toBe("positive");
  });

  it("returns strong_positive for big gains", () => {
    expect(getSentiment(2)).toBe("strong_positive");
    expect(getSentiment(1.5)).toBe("strong_positive"); // default threshold
  });

  it("returns strong_positive with per-asset threshold", () => {
    expect(getSentiment(1, "ES=F")).toBe("strong_positive"); // ES threshold = 1.0
    expect(getSentiment(0.5, "ZN=F")).toBe("strong_positive"); // ZN threshold = 0.5
  });

  it("returns negative for small losses", () => {
    expect(getSentiment(-0.23)).toBe("negative");
    expect(getSentiment(-0.2)).toBe("negative");
  });

  it("returns strong_negative for big losses", () => {
    expect(getSentiment(-2)).toBe("strong_negative");
    expect(getSentiment(-1, "ES=F")).toBe("strong_negative");
  });

  it("returns neutral for flat (within default ±0.1%)", () => {
    expect(getSentiment(0)).toBe("neutral");
    expect(getSentiment(0.05)).toBe("neutral");
    expect(getSentiment(-0.08)).toBe("neutral");
    expect(getSentiment(0.1)).toBe("neutral"); // boundary = flat
  });

  it("returns neutral for flat with per-asset threshold", () => {
    expect(getSentiment(0.4, "BTC=F")).toBe("neutral"); // BTC flat = 0.5
    expect(getSentiment(-0.3, "NG=F")).toBe("neutral"); // NG flat = 0.5
    expect(getSentiment(0.01, "ZN=F")).toBe("neutral"); // ZN flat = 0.02
  });
});

// ============================================================================
// buildFuturesItem
// ============================================================================

describe("buildFuturesItem", () => {
  const esContract = { symbol: "ES=F", name: "ES", description: "S&P 500" };
  const defaultWidths = { name: 3, price: 9, percent: 6 };

  describe("when fetch succeeds", () => {
    it("pads name and right-aligns price", () => {
      const result = buildFuturesItem(
        esContract,
        {
          status: "fulfilled",
          value: {
            symbol: "ES=F",
            price: 5432.25,
            previousClose: 5408,
            changePercent: 0.45,
          },
        },
        defaultWidths,
      );
      expect(result.text).toBe("ES:  +0.45% /  5,432.25");
      expect(result.sentiment).toBe("positive");
      expect(result.monospace).toBe(true);
    });

    it("right-aligns small prices", () => {
      const result = buildFuturesItem(
        esContract,
        {
          status: "fulfilled",
          value: {
            symbol: "ES=F",
            price: 2.34,
            previousClose: 2.37,
            changePercent: -1.27,
          },
        },
        defaultWidths,
      );
      expect(result.text).toBe("ES:  -1.27% /      2.34");
      expect(result.sentiment).toBe("strong_negative");
    });

    it("handles zero change", () => {
      const result = buildFuturesItem(
        esContract,
        {
          status: "fulfilled",
          value: {
            symbol: "ES=F",
            price: 5408,
            previousClose: 5408,
            changePercent: 0,
          },
        },
        defaultWidths,
      );
      expect(result.text).toBe("ES:  +0.00% /  5,408.00");
      expect(result.sentiment).toBe("neutral");
    });

    it("pads 3-char names without trailing space", () => {
      const dxyContract = {
        symbol: "DX-Y.NYB",
        name: "DXY",
        description: "US Dollar Index",
      };
      const result = buildFuturesItem(
        dxyContract,
        {
          status: "fulfilled",
          value: {
            symbol: "DX-Y.NYB",
            price: 97.93,
            previousClose: 97.7,
            changePercent: 0.24,
          },
        },
        defaultWidths,
      );
      expect(result.text).toBe("DXY: +0.24% /     97.93");
    });
  });

  describe("when fetch fails", () => {
    it("returns unavailable with monospace flag", () => {
      const result = buildFuturesItem(
        esContract,
        {
          status: "rejected",
          reason: new Error("Yahoo Finance returned 429 for ES=F"),
        },
        defaultWidths,
      );
      expect(result.text).toBe("ES:  unavailable");
      expect(result.sentiment).toBe("neutral");
      expect(result.monospace).toBe(true);
    });

    it("pads name for failed items", () => {
      const gcContract = {
        symbol: "GC=F",
        name: "GC",
        description: "Gold",
      };
      const result = buildFuturesItem(
        gcContract,
        { status: "rejected", reason: new Error("Timeout") },
        defaultWidths,
      );
      expect(result.text).toBe("GC:  unavailable");
    });
  });
});

// ============================================================================
// buildAlignedFuturesItems
// ============================================================================

describe("buildAlignedFuturesItems", () => {
  it("aligns columns across items with different price widths", () => {
    const contracts = [
      { symbol: "ES=F", name: "ES", description: "S&P 500" },
      { symbol: "DX-Y.NYB", name: "DXY", description: "US Dollar Index" },
      { symbol: "NG=F", name: "NG", description: "Natural Gas" },
    ];
    const results: PromiseSettledResult<{
      symbol: string;
      price: number;
      previousClose: number;
      changePercent: number;
    }>[] = [
      {
        status: "fulfilled",
        value: {
          symbol: "ES=F",
          price: 6866.75,
          previousClose: 6894.2,
          changePercent: -0.4,
        },
      },
      {
        status: "fulfilled",
        value: {
          symbol: "DX-Y.NYB",
          price: 97.93,
          previousClose: 97.7,
          changePercent: 0.24,
        },
      },
      {
        status: "fulfilled",
        value: {
          symbol: "NG=F",
          price: 2.97,
          previousClose: 3.01,
          changePercent: -1.33,
        },
      },
    ];

    const items = buildAlignedFuturesItems(contracts, results);

    // All lines should have the same length (aligned columns)
    const lengths = items.map((item) => item.text.length);
    expect(lengths[0]).toBe(lengths[1]);
    expect(lengths[1]).toBe(lengths[2]);

    // Price column should be right-aligned (6,866.75 is widest at 8 chars)
    expect(items[0]?.text).toContain("6,866.75");
    expect(items[1]?.text).toContain("   97.93");
    expect(items[2]?.text).toContain("    2.97");

    // All should be monospace
    expect(items.every((item) => item.monospace)).toBe(true);
  });

  it("handles mixed success and failure results", () => {
    const contracts = [
      { symbol: "ES=F", name: "ES", description: "S&P 500" },
      { symbol: "GC=F", name: "GC", description: "Gold" },
    ];
    const results: PromiseSettledResult<{
      symbol: string;
      price: number;
      previousClose: number;
      changePercent: number;
    }>[] = [
      {
        status: "fulfilled",
        value: {
          symbol: "ES=F",
          price: 5432.25,
          previousClose: 5408,
          changePercent: 0.45,
        },
      },
      { status: "rejected", reason: new Error("Timeout") },
    ];

    const items = buildAlignedFuturesItems(contracts, results);
    expect(items[0]?.sentiment).toBe("positive");
    expect(items[1]?.text).toContain("unavailable");
    expect(items[1]?.sentiment).toBe("neutral");
  });
});
