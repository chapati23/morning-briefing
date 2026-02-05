/**
 * Tests for Polymarket data source parsing and formatting
 */

import { describe, expect, it } from "bun:test";
import {
  extractOutcomeName,
  formatOutcomeWithChange,
  formatVolume,
  truncate,
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
