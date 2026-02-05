/**
 * Tests for Polymarket correlation mapping functions
 */

import { describe, expect, it } from "bun:test";
import {
  getImplicationsForMarket,
  isExcludedCategory,
  isShortTermPriceBet,
  isSportsTitle,
} from "../src/config/polymarket-correlations";

// ============================================================================
// isExcludedCategory
// ============================================================================

describe("isExcludedCategory", () => {
  it("excludes sports category", () => {
    expect(isExcludedCategory("sports")).toBe(true);
    expect(isExcludedCategory("Sports")).toBe(true);
    expect(isExcludedCategory("SPORTS")).toBe(true);
  });

  it("excludes entertainment category", () => {
    expect(isExcludedCategory("entertainment")).toBe(true);
    expect(isExcludedCategory("Entertainment & Pop Culture")).toBe(true);
  });

  it("excludes gaming category", () => {
    expect(isExcludedCategory("gaming")).toBe(true);
    expect(isExcludedCategory("video gaming")).toBe(true);
  });

  it("excludes esports category", () => {
    expect(isExcludedCategory("esports")).toBe(true);
    expect(isExcludedCategory("eSports")).toBe(true);
  });

  it("excludes pop culture category", () => {
    expect(isExcludedCategory("pop culture")).toBe(true);
    expect(isExcludedCategory("Pop Culture")).toBe(true);
  });

  it("excludes celebrities category", () => {
    expect(isExcludedCategory("celebrities")).toBe(true);
  });

  it("does not exclude politics", () => {
    expect(isExcludedCategory("politics")).toBe(false);
    expect(isExcludedCategory("US Politics")).toBe(false);
  });

  it("does not exclude economics", () => {
    expect(isExcludedCategory("economics")).toBe(false);
    expect(isExcludedCategory("finance")).toBe(false);
  });

  it("does not exclude crypto", () => {
    expect(isExcludedCategory("crypto")).toBe(false);
    expect(isExcludedCategory("cryptocurrency")).toBe(false);
  });

  it("handles empty string as excluded (matches empty in list)", () => {
    // Empty string matches empty patterns in the exclusion logic
    expect(isExcludedCategory("")).toBe(true);
  });
});

// ============================================================================
// isSportsTitle
// ============================================================================

describe("isSportsTitle", () => {
  describe("traditional sports leagues", () => {
    it("detects NFL content", () => {
      expect(isSportsTitle("NFL playoffs 2026")).toBe(true);
      expect(isSportsTitle("Super Bowl winner")).toBe(true);
    });

    it("detects NBA content", () => {
      expect(isSportsTitle("NBA championship")).toBe(true);
      expect(isSportsTitle("Lakers win the finals?")).toBe(true);
    });

    it("detects MLB content", () => {
      expect(isSportsTitle("MLB World Series")).toBe(true);
      expect(isSportsTitle("Yankees vs Dodgers")).toBe(true);
    });

    it("detects NHL content", () => {
      expect(isSportsTitle("NHL Stanley Cup")).toBe(true);
    });

    it("detects soccer content", () => {
      expect(isSportsTitle("Premier League winner")).toBe(true);
      expect(isSportsTitle("Champions League final")).toBe(true);
    });
  });

  describe("combat sports", () => {
    it("detects UFC content", () => {
      expect(isSportsTitle("UFC 300 main event")).toBe(true);
    });

    it("detects boxing content", () => {
      expect(isSportsTitle("Boxing heavyweight championship")).toBe(true);
    });

    it("detects MMA content", () => {
      expect(isSportsTitle("MMA fight outcome")).toBe(true);
    });
  });

  describe("individual sports", () => {
    it("detects golf content", () => {
      expect(isSportsTitle("PGA Tour winner")).toBe(true);
      expect(isSportsTitle("golf championship")).toBe(true);
    });

    it("detects tennis content", () => {
      expect(isSportsTitle("tennis championship")).toBe(true);
    });

    it("detects World Cup content", () => {
      expect(isSportsTitle("World Cup winner")).toBe(true);
    });
  });

  describe("team names", () => {
    it("detects NFL team names", () => {
      expect(isSportsTitle("Chiefs win?")).toBe(true);
      expect(isSportsTitle("Cowboys playoff")).toBe(true);
      expect(isSportsTitle("Patriots season")).toBe(true);
    });

    it("detects NBA team names", () => {
      expect(isSportsTitle("Lakers championship")).toBe(true);
      expect(isSportsTitle("Celtics win")).toBe(true);
    });
  });

  describe("esports", () => {
    it("detects Counter-Strike", () => {
      expect(isSportsTitle("CS2 tournament")).toBe(true);
      expect(isSportsTitle("CSGO major")).toBe(true);
    });

    it("detects League of Legends", () => {
      expect(isSportsTitle("LoL World Championship")).toBe(true);
    });

    it("detects Valorant", () => {
      expect(isSportsTitle("Valorant Champions")).toBe(true);
    });
  });

  describe("match patterns", () => {
    it("detects vs. pattern", () => {
      expect(isSportsTitle("Team A vs. Team B")).toBe(true);
      expect(isSportsTitle("Player vs Player")).toBe(true);
    });
  });

  describe("non-sports content", () => {
    it("does not match political content", () => {
      expect(isSportsTitle("Trump wins 2028 election")).toBe(false);
      expect(isSportsTitle("Biden announces policy")).toBe(false);
    });

    it("does not match economic content", () => {
      expect(isSportsTitle("Fed rate cut in 2026")).toBe(false);
      expect(isSportsTitle("US recession")).toBe(false);
    });

    it("does not match geopolitical content", () => {
      expect(isSportsTitle("Iran nuclear deal")).toBe(false);
      expect(isSportsTitle("China Taiwan tensions")).toBe(false);
    });
  });
});

// ============================================================================
// isShortTermPriceBet
// ============================================================================

describe("isShortTermPriceBet", () => {
  it("detects price above/below patterns", () => {
    expect(
      isShortTermPriceBet("Will the price of Bitcoin be above $50,000?"),
    ).toBe(true);
    expect(isShortTermPriceBet("Will the price of ETH be below $3000?")).toBe(
      true,
    );
  });

  it("detects crypto price on date patterns", () => {
    expect(isShortTermPriceBet("Bitcoin price on February 2?")).toBe(true);
    expect(isShortTermPriceBet("Ethereum price on January 15")).toBe(true);
    expect(isShortTermPriceBet("SOL price on March 1")).toBe(true);
  });

  it("detects crypto up or down patterns", () => {
    expect(
      isShortTermPriceBet("Bitcoin up or down above $50k on January 5?"),
    ).toBe(true);
  });

  it("does not match long-term crypto predictions", () => {
    expect(isShortTermPriceBet("Will Bitcoin reach $100k in 2026?")).toBe(
      false,
    );
    expect(isShortTermPriceBet("Ethereum market cap by end of year")).toBe(
      false,
    );
  });

  it("does not match non-crypto content", () => {
    expect(isShortTermPriceBet("Trump wins 2028")).toBe(false);
    expect(isShortTermPriceBet("Fed rate cut")).toBe(false);
    expect(isShortTermPriceBet("US recession in 2026")).toBe(false);
  });

  it("handles case insensitivity", () => {
    expect(isShortTermPriceBet("BITCOIN price on JANUARY 5")).toBe(true);
  });
});

// ============================================================================
// getImplicationsForMarket
// ============================================================================

describe("getImplicationsForMarket", () => {
  describe("monetary policy markets", () => {
    it("returns implications for Fed-related markets", () => {
      const implications = getImplicationsForMarket("Will the Fed cut rates?");
      expect(implications.length).toBeGreaterThan(0);
      expect(implications.some((i) => i.asset === "TLT")).toBe(true);
    });

    it("returns implications for FOMC markets", () => {
      const implications = getImplicationsForMarket("FOMC decision March 2026");
      expect(implications.length).toBeGreaterThan(0);
    });

    it("returns implications for Powell markets", () => {
      const implications = getImplicationsForMarket("Powell announces policy");
      expect(implications.length).toBeGreaterThan(0);
    });
  });

  describe("geopolitical markets", () => {
    it("returns implications for Iran-related markets", () => {
      const implications = getImplicationsForMarket(
        "US strikes Iran by February?",
      );
      expect(implications.length).toBeGreaterThan(0);
      expect(implications.some((i) => i.asset === "USO")).toBe(true);
      expect(implications.some((i) => i.asset === "XLE")).toBe(true);
      expect(implications.some((i) => i.asset === "LMT")).toBe(true);
    });

    it("returns implications for China-related markets", () => {
      const implications = getImplicationsForMarket("China invades Taiwan?");
      expect(implications.length).toBeGreaterThan(0);
      expect(implications.some((i) => i.asset === "SMH")).toBe(true);
    });

    it("returns implications for Russia-related markets", () => {
      const implications = getImplicationsForMarket(
        "Russia Ukraine ceasefire?",
      );
      expect(implications.length).toBeGreaterThan(0);
      expect(implications.some((i) => i.asset === "LMT")).toBe(true);
    });
  });

  describe("US politics markets", () => {
    it("returns implications for Trump-related markets", () => {
      const implications = getImplicationsForMarket(
        "Trump wins 2028 election?",
      );
      expect(implications.length).toBeGreaterThan(0);
      expect(implications.some((i) => i.asset === "XLE")).toBe(true);
    });

    it("returns implications for Democratic markets", () => {
      const implications = getImplicationsForMarket(
        "Democratic nominee for 2028",
      );
      expect(implications.length).toBeGreaterThan(0);
    });
  });

  describe("tariff markets", () => {
    it("returns implications for tariff-related markets", () => {
      const implications = getImplicationsForMarket(
        "Canada retaliatory tariffs?",
      );
      expect(implications.length).toBeGreaterThan(0);
    });
  });

  describe("deduplication", () => {
    it("deduplicates assets when multiple patterns match", () => {
      // A market that matches multiple patterns (e.g., "Fed Powell" matches both)
      const implications = getImplicationsForMarket(
        "Fed Chairman Powell announces rate decision",
      );

      // Check for duplicates
      const assets = implications.map((i) => i.asset);
      const uniqueAssets = new Set(assets);
      expect(uniqueAssets.size).toBe(assets.length);
    });
  });

  describe("no matches", () => {
    it("returns empty array for non-matching market", () => {
      const implications = getImplicationsForMarket(
        "Random unrelated market title",
      );
      expect(implications).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      const implications = getImplicationsForMarket("");
      expect(implications).toEqual([]);
    });
  });
});
