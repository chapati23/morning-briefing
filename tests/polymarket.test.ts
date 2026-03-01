/**
 * Tests for Polymarket data source parsing and formatting
 */

import { describe, expect, it } from "bun:test";
import {
  classifyMarket,
  extractOutcomeName,
  extractTopOutcomes,
  formatOutcomeWithChange,
  formatVolume,
  truncate,
  type ClassifiedMarket,
  type GammaMarket,
  type ParsedMarket,
  type TopOutcome,
} from "../src/sources/polymarket";

// ============================================================================
// extractOutcomeName
// ============================================================================

describe("extractOutcomeName", () => {
  describe("duration patterns", () => {
    it("extracts range duration with hyphen", () => {
      expect(extractOutcomeName("Government shutdown 1-2 weeks?")).toBe(
        "1-2 weeks",
      );
      expect(extractOutcomeName("Strike lasts 3-4 days")).toBe("3-4 days");
    });

    it("extracts range duration with 'to'", () => {
      expect(extractOutcomeName("Shutdown lasts 1 to 2 weeks?")).toBe(
        "1 to 2 weeks",
      );
    });

    it("extracts 'less than' durations", () => {
      expect(extractOutcomeName("Strike less than 1 week")).toBe(
        "less than 1 week",
      );
      expect(extractOutcomeName("Lasts under 2 weeks")).toBe("under 2 weeks");
    });

    it("extracts 'more than' durations", () => {
      expect(extractOutcomeName("Strike more than 4 weeks")).toBe(
        "more than 4 weeks",
      );
      expect(extractOutcomeName("Shutdown over 3 months")).toBe(
        "over 3 months",
      );
    });

    it("extracts plus durations", () => {
      expect(extractOutcomeName("Strike lasts 4+ weeks")).toBe("4+ weeks");
    });

    it("extracts 'or less/more' durations", () => {
      expect(extractOutcomeName("Lasts 1 week or less")).toBe("1 week or less");
      expect(extractOutcomeName("Lasts 2 days or more")).toBe("2 days or more");
    });
  });

  describe("date patterns", () => {
    it("extracts dates with 'by [Month] [Day]'", () => {
      expect(extractOutcomeName("US strikes Iran by February 5, 2026?")).toBe(
        "Feb 5",
      );
      expect(extractOutcomeName("Resolved by January 15")).toBe("Jan 15");
      expect(extractOutcomeName("Announcement by December 31")).toBe("Dec 31");
    });
  });

  describe("person name patterns", () => {
    it("extracts last name from 'Will [Name] win'", () => {
      expect(
        extractOutcomeName("Will Gavin Newsom win the 2028 election?"),
      ).toBe("Newsom");
      expect(extractOutcomeName("Will Joe Biden win?")).toBe("Biden");
    });

    it("extracts last name from 'Will [Name] be'", () => {
      expect(extractOutcomeName("Will John Smith be nominated?")).toBe("Smith");
    });

    it("extracts last name from 'Will [Name] become'", () => {
      expect(extractOutcomeName("Will Jane Doe become president?")).toBe("Doe");
    });

    it("extracts name from nomination pattern", () => {
      expect(
        extractOutcomeName("Trump nominate Kevin Warsh as Fed Chair?"),
      ).toBe("Warsh");
    });

    it("skips articles like 'the', 'a', 'an'", () => {
      // These should not extract "the" as a name
      expect(extractOutcomeName("Will the US win?")).not.toBe("the");
      expect(extractOutcomeName("Will a new policy be enacted?")).not.toBe("a");
    });
  });

  describe("year patterns", () => {
    it("extracts year from 'in [Year]'", () => {
      expect(extractOutcomeName("US recession in 2026?")).toBe("2026");
      expect(extractOutcomeName("Will it happen in 2028?")).toBe("2028");
    });
  });

  describe("fallback behavior", () => {
    it("returns first few words when no pattern matches", () => {
      const result = extractOutcomeName("Random market question here");
      expect(result.length).toBeLessThanOrEqual(30);
    });

    it("removes leading 'Will'", () => {
      const result = extractOutcomeName("Will something random happen?");
      expect(result).not.toMatch(/^Will/);
    });

    it("removes trailing question mark", () => {
      const result = extractOutcomeName("Some question?");
      expect(result).not.toContain("?");
    });
  });
});

// ============================================================================
// formatVolume
// ============================================================================

describe("formatVolume", () => {
  it("formats millions with M suffix", () => {
    expect(formatVolume(1_000_000)).toBe("$1.0M");
    expect(formatVolume(5_500_000)).toBe("$5.5M");
    expect(formatVolume(123_456_789)).toBe("$123.5M");
  });

  it("formats thousands with K suffix", () => {
    expect(formatVolume(1_000)).toBe("$1K");
    expect(formatVolume(500_000)).toBe("$500K");
    expect(formatVolume(999_999)).toBe("$1000K");
  });

  it("formats small numbers without suffix", () => {
    expect(formatVolume(100)).toBe("$100");
    expect(formatVolume(999)).toBe("$999");
    expect(formatVolume(0)).toBe("$0");
  });

  it("rounds to appropriate precision", () => {
    expect(formatVolume(1_234_567)).toBe("$1.2M");
    expect(formatVolume(1_254_567)).toBe("$1.3M"); // Rounds up
  });
});

// ============================================================================
// truncate
// ============================================================================

describe("truncate", () => {
  it("returns text unchanged when within limit", () => {
    expect(truncate("Short text", 20)).toBe("Short text");
  });

  it("returns text unchanged when exactly at limit", () => {
    expect(truncate("Exactly ten", 11)).toBe("Exactly ten");
  });

  it("truncates and adds ellipsis when over limit", () => {
    expect(truncate("This is a very long text", 15)).toBe("This is a ve...");
  });

  it("handles empty string", () => {
    expect(truncate("", 10)).toBe("");
  });

  it("handles limit of 3", () => {
    expect(truncate("Hello", 3)).toBe("...");
  });
});

// ============================================================================
// formatOutcomeWithChange
// ============================================================================

describe("formatOutcomeWithChange", () => {
  it("formats outcome with positive change", () => {
    const outcome: TopOutcome = {
      name: "Newsom",
      probability: 33,
      change: 0.05,
    };
    expect(formatOutcomeWithChange(outcome)).toBe("Newsom — 33% (↑5%)");
  });

  it("formats outcome with negative change", () => {
    const outcome: TopOutcome = {
      name: "Biden",
      probability: 20,
      change: -0.08,
    };
    expect(formatOutcomeWithChange(outcome)).toBe("Biden — 20% (↓8%)");
  });

  it("formats outcome with no significant change", () => {
    const outcome: TopOutcome = {
      name: "Trump",
      probability: 45,
      change: 0.005,
    };
    // Less than 1% change - no arrow
    expect(formatOutcomeWithChange(outcome)).toBe("Trump — 45%");
  });

  it("formats outcome with zero change", () => {
    const outcome: TopOutcome = { name: "Harris", probability: 30, change: 0 };
    expect(formatOutcomeWithChange(outcome)).toBe("Harris — 30%");
  });

  it("handles NaN change", () => {
    const outcome: TopOutcome = {
      name: "Test",
      probability: 50,
      change: Number.NaN,
    };
    expect(formatOutcomeWithChange(outcome)).toBe("Test — 50%");
  });

  it("handles Infinity change", () => {
    const outcome: TopOutcome = {
      name: "Test",
      probability: 50,
      change: Infinity,
    };
    expect(formatOutcomeWithChange(outcome)).toBe("Test — 50%");
  });

  it("rounds probability to whole number", () => {
    const outcome: TopOutcome = {
      name: "Test",
      probability: 33.7,
      change: 0.1,
    };
    expect(formatOutcomeWithChange(outcome)).toBe("Test — 34% (↑10%)");
  });

  it("rounds change percentage to whole number", () => {
    const outcome: TopOutcome = {
      name: "Test",
      probability: 50,
      change: 0.127,
    };
    expect(formatOutcomeWithChange(outcome)).toBe("Test — 50% (↑13%)");
  });
});

// ============================================================================
// extractTopOutcomes
// ============================================================================

// Helper to build a minimal GammaMarket for testing
const makeMarket = (
  question: string,
  lastTradePrice: number,
  oneDayPriceChange = 0,
): GammaMarket => ({
  id: "test-id",
  question,
  slug: "test-slug",
  outcomePrices: JSON.stringify([String(lastTradePrice)]),
  volume: "0",
  volumeNum: 0,
  volume24hr: 0,
  liquidity: "0",
  liquidityNum: 0,
  endDate: "2026-12-31T00:00:00Z",
  category: "politics",
  oneDayPriceChange,
  oneHourPriceChange: 0,
  oneWeekPriceChange: 0,
  lastTradePrice,
});

describe("extractTopOutcomes", () => {
  it("returns top outcomes for normal multi-market event (outcomes in 1-99% range)", () => {
    const markets = [
      makeMarket("Will Trump win?", 0.55, 0.05),
      makeMarket("Will Harris win?", 0.3, -0.04),
      makeMarket("Will Biden win?", 0.1, -0.01),
    ];
    const result = extractTopOutcomes(markets);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.probability).toBeCloseTo(55, 0);
    expect(result[0]?.name).toBe("Trump");
  });

  it("returns results when all outcomes are fully resolved (~0.1% or ~99.9%)", () => {
    // Bug 2: previously the filter (prob > 0.5 && prob < 99.5) excluded everything
    const markets = [
      makeMarket("US strikes Iran by January 31, 2026?", 0.999, 0.65),
      makeMarket("US strikes Iran by February 28, 2026?", 0.001, -0.01),
      makeMarket("US strikes Iran by March 31, 2026?", 0.001, 0),
    ];
    const result = extractTopOutcomes(markets);
    // Fallback must kick in — should return the ~99.9% outcome(s)
    expect(result.length).toBeGreaterThan(0);
    // The highest-probability outcome should be ~99.9%
    expect(result[0]?.probability).toBeCloseTo(99.9, 0);
  });

  it("excludes truly 0% and 100% outcomes even in fallback", () => {
    const markets = [
      makeMarket("Option A", 1, 0), // exactly 100% — should be excluded
      makeMarket("Option B", 0.999, 0), // ~99.9% — should appear
      makeMarket("Option C", 0, 0), // exactly 0% — should be excluded
    ];
    const result = extractTopOutcomes(markets);
    expect(result.length).toBe(1);
    expect(result[0]?.probability).toBeCloseTo(99.9, 0);
  });

  it("returns at most 2 outcomes", () => {
    const markets = [
      makeMarket("Option A", 0.4, 0.02),
      makeMarket("Option B", 0.3, -0.03),
      makeMarket("Option C", 0.2, 0.01),
      makeMarket("Option D", 0.1, -0.01),
    ];
    const result = extractTopOutcomes(markets);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// classifyMarket — multi-market mover classification (Bug 1 regression)
// ============================================================================

// Helper to build a minimal ParsedMarket for classifyMarket tests
const makeMultiMarketParsed = (
  title: string,
  primaryDayChange: number,
  maxAbsDayChange: number,
): ParsedMarket => ({
  id: "pm-test",
  title,
  slug: "test-slug",
  probability: 50,
  oneDayPriceChange: primaryDayChange,
  oneHourPriceChange: 0,
  oneWeekPriceChange: 0,
  volume: 1_000_000,
  volume24hr: 10_000,
  liquidity: 200_000,
  endDate: new Date("2026-12-31"),
  category: "politics",
  url: "https://polymarket.com/event/test-slug",
  isMultiMarket: true,
  maxAbsDayChange,
});

describe("classifyMarket", () => {
  it("classifies multi-market event as mover when a sub-market has large change even if primary is small", () => {
    // Bug 1: previously used primary market's oneDayPriceChange (-0.006) instead of maxAbsDayChange (0.65)
    const market = makeMultiMarketParsed(
      "When will US strike Iran?",
      -0.006, // primary market: tiny change
      0.65, // another sub-market: huge change
    );
    const classified: ClassifiedMarket = classifyMarket(market);
    expect(classified.isMover).toBe(true);
  });

  it("does NOT classify as mover when all sub-markets have small changes", () => {
    const market = makeMultiMarketParsed(
      "Some election market",
      -0.006,
      0.006, // max is also tiny
    );
    const classified = classifyMarket(market);
    expect(classified.isMover).toBe(false);
  });

  it("sorts movers by maxAbsDayChange (largest first)", () => {
    const smallMover = makeMultiMarketParsed("Small mover", -0.006, 0.12);
    const bigMover = makeMultiMarketParsed("Big mover", -0.006, 0.65);

    const classified = [smallMover, bigMover]
      .map(classifyMarket)
      .filter((m) => m.isMover)
      .sort((a, b) => b.maxAbsDayChange - a.maxAbsDayChange);

    expect(classified[0]?.title).toBe("Big mover");
    expect(classified[1]?.title).toBe("Small mover");
  });
});

// ============================================================================
// formatOutcomeWithChange — additional edge cases
// ============================================================================

describe("formatOutcomeWithChange — edge cases", () => {
  it("handles exactly 0 change", () => {
    const outcome: TopOutcome = {
      name: "Option A",
      probability: 50,
      change: 0,
    };
    expect(formatOutcomeWithChange(outcome)).toBe("Option A — 50%");
  });

  it("handles very large positive change", () => {
    const outcome: TopOutcome = {
      name: "Option A",
      probability: 80,
      change: 0.65,
    };
    expect(formatOutcomeWithChange(outcome)).toBe("Option A — 80% (↑65%)");
  });

  it("handles very large negative change", () => {
    const outcome: TopOutcome = {
      name: "Option B",
      probability: 5,
      change: -0.72,
    };
    expect(formatOutcomeWithChange(outcome)).toBe("Option B — 5% (↓72%)");
  });
});

// ============================================================================
// extractOutcomeName — date-based questions (additional coverage)
// ============================================================================

describe("extractOutcomeName — date-based questions", () => {
  it("extracts 'Feb 28' from 'US strikes Iran by February 28, 2026?'", () => {
    expect(extractOutcomeName("US strikes Iran by February 28, 2026?")).toBe(
      "Feb 28",
    );
  });

  it("extracts 'Jan 31' from date-based market question", () => {
    expect(extractOutcomeName("US strikes Iran by January 31, 2026?")).toBe(
      "Jan 31",
    );
  });

  it("extracts 'Mar 15' from date-based market question", () => {
    expect(extractOutcomeName("Event happens by March 15?")).toBe("Mar 15");
  });
});

// ============================================================================
// extractOutcomeName — name takes priority over date
// ============================================================================

describe("extractOutcomeName — name priority over date", () => {
  it("extracts person name, not date, from 'Will X be named ... by February 28?'", () => {
    expect(
      extractOutcomeName(
        "Will Prince Andrew be named in newly released Epstein files by February 28?",
      ),
    ).toBe("Andrew");
  });

  it("extracts person name from 'Will Bill Clinton be named ... by March 15?'", () => {
    expect(
      extractOutcomeName(
        "Will Bill Clinton be named in newly released Epstein files by March 15?",
      ),
    ).toBe("Clinton");
  });

  it("still extracts date when no person name pattern matches", () => {
    expect(extractOutcomeName("US strikes Iran by February 28, 2026?")).toBe(
      "Feb 28",
    );
  });
});
