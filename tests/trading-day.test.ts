/**
 * Tests for trading day logic and ETF flow parsing
 */

import { describe, expect, it } from "bun:test";
import {
  buildETFItem,
  formatMillion,
  formatTradingDate,
  getEasterDate,
  getFlowSentiment,
  getPreviousTradingDay,
  isTradingDay,
  isUSMarketHoliday,
  parseFlowValue,
} from "../src/sources/etf-flows";

// ============================================================================
// isTradingDay
// ============================================================================

describe("isTradingDay", () => {
  it("returns true for a normal weekday", () => {
    // Wednesday, January 15, 2026
    expect(isTradingDay(new Date(2026, 0, 14))).toBe(true);
  });

  it("returns false for Saturday", () => {
    // Saturday, January 17, 2026
    expect(isTradingDay(new Date(2026, 0, 17))).toBe(false);
  });

  it("returns false for Sunday", () => {
    // Sunday, January 18, 2026
    expect(isTradingDay(new Date(2026, 0, 18))).toBe(false);
  });

  it("returns false for holidays", () => {
    // New Year's Day 2026 (Thursday, January 1)
    expect(isTradingDay(new Date(2026, 0, 1))).toBe(false);
  });

  it("returns true for normal Friday", () => {
    // Friday, January 16, 2026
    expect(isTradingDay(new Date(2026, 0, 16))).toBe(true);
  });
});

// ============================================================================
// isUSMarketHoliday
// ============================================================================

describe("isUSMarketHoliday", () => {
  describe("New Year's Day", () => {
    it("returns true for January 1st", () => {
      expect(isUSMarketHoliday(new Date(2026, 0, 1))).toBe(true);
    });

    it("returns true for observed Monday when Jan 1 is Sunday", () => {
      // Jan 1, 2023 was a Sunday, so Jan 2, 2023 (Monday) is observed
      expect(isUSMarketHoliday(new Date(2023, 0, 2))).toBe(true);
    });

    it("returns true for observed Friday when Jan 1 is Saturday", () => {
      // Jan 1, 2022 was a Saturday, so Dec 31, 2021 (Friday) is observed
      expect(isUSMarketHoliday(new Date(2021, 11, 31))).toBe(true);
    });
  });

  describe("Martin Luther King Jr. Day", () => {
    it("returns true for 3rd Monday of January", () => {
      // MLK Day 2026: January 19 (3rd Monday)
      expect(isUSMarketHoliday(new Date(2026, 0, 19))).toBe(true);
    });

    it("returns false for other Mondays in January", () => {
      // January 12, 2026 - 2nd Monday
      expect(isUSMarketHoliday(new Date(2026, 0, 12))).toBe(false);
    });
  });

  describe("Presidents' Day", () => {
    it("returns true for 3rd Monday of February", () => {
      // Presidents' Day 2026: February 16 (3rd Monday)
      expect(isUSMarketHoliday(new Date(2026, 1, 16))).toBe(true);
    });
  });

  describe("Good Friday", () => {
    it("returns true for Good Friday 2026", () => {
      // Easter 2026 is April 5, so Good Friday is April 3
      expect(isUSMarketHoliday(new Date(2026, 3, 3))).toBe(true);
    });

    it("returns true for Good Friday 2025", () => {
      // Easter 2025 is April 20, so Good Friday is April 18
      expect(isUSMarketHoliday(new Date(2025, 3, 18))).toBe(true);
    });
  });

  describe("Memorial Day", () => {
    it("returns true for last Monday of May", () => {
      // Memorial Day 2026: May 25 (last Monday)
      expect(isUSMarketHoliday(new Date(2026, 4, 25))).toBe(true);
    });

    it("returns false for earlier Mondays in May", () => {
      // May 18, 2026 - not the last Monday
      expect(isUSMarketHoliday(new Date(2026, 4, 18))).toBe(false);
    });
  });

  describe("Juneteenth", () => {
    it("returns true for June 19", () => {
      expect(isUSMarketHoliday(new Date(2026, 5, 19))).toBe(true);
    });

    it("returns true for observed Monday when June 19 is Sunday", () => {
      // June 19, 2022 was Sunday, so June 20 (Monday) was observed
      expect(isUSMarketHoliday(new Date(2022, 5, 20))).toBe(true);
    });

    it("returns true for observed Friday when June 19 is Saturday", () => {
      // June 19, 2021 was Saturday, so June 18 (Friday) was observed
      expect(isUSMarketHoliday(new Date(2021, 5, 18))).toBe(true);
    });
  });

  describe("Independence Day", () => {
    it("returns true for July 4", () => {
      expect(isUSMarketHoliday(new Date(2026, 6, 4))).toBe(true);
    });

    it("returns true for observed Monday when July 4 is Sunday", () => {
      // July 4, 2021 was Sunday, so July 5 (Monday) was observed
      expect(isUSMarketHoliday(new Date(2021, 6, 5))).toBe(true);
    });

    it("returns true for observed Friday when July 4 is Saturday", () => {
      // July 4, 2020 was Saturday, so July 3 (Friday) was observed
      expect(isUSMarketHoliday(new Date(2020, 6, 3))).toBe(true);
    });
  });

  describe("Labor Day", () => {
    it("returns true for 1st Monday of September", () => {
      // Labor Day 2026: September 7 (1st Monday)
      expect(isUSMarketHoliday(new Date(2026, 8, 7))).toBe(true);
    });

    it("returns false for other Mondays in September", () => {
      // September 14, 2026 - 2nd Monday
      expect(isUSMarketHoliday(new Date(2026, 8, 14))).toBe(false);
    });
  });

  describe("Thanksgiving", () => {
    it("returns true for 4th Thursday of November", () => {
      // Thanksgiving 2026: November 26 (4th Thursday)
      expect(isUSMarketHoliday(new Date(2026, 10, 26))).toBe(true);
    });

    it("returns false for other Thursdays in November", () => {
      // November 19, 2026 - 3rd Thursday
      expect(isUSMarketHoliday(new Date(2026, 10, 19))).toBe(false);
    });
  });

  describe("Christmas", () => {
    it("returns true for December 25", () => {
      expect(isUSMarketHoliday(new Date(2026, 11, 25))).toBe(true);
    });

    it("returns true for observed Monday when Dec 25 is Sunday", () => {
      // Dec 25, 2022 was Sunday, so Dec 26 (Monday) was observed
      expect(isUSMarketHoliday(new Date(2022, 11, 26))).toBe(true);
    });

    it("returns true for observed Friday when Dec 25 is Saturday", () => {
      // Dec 25, 2021 was Saturday, so Dec 24 (Friday) was observed
      expect(isUSMarketHoliday(new Date(2021, 11, 24))).toBe(true);
    });
  });

  it("returns false for regular weekdays", () => {
    // A random Wednesday in March
    expect(isUSMarketHoliday(new Date(2026, 2, 11))).toBe(false);
  });
});

// ============================================================================
// getPreviousTradingDay
// ============================================================================

describe("getPreviousTradingDay", () => {
  it("returns previous day for normal weekday", () => {
    // Thursday, January 15, 2026 -> Wednesday, January 14
    const result = getPreviousTradingDay(new Date(2026, 0, 15));
    expect(result.getDate()).toBe(14);
    expect(result.getMonth()).toBe(0);
  });

  it("returns Friday when called on Monday", () => {
    // Monday, January 19, 2026 -> but this is MLK Day!
    // So Tuesday, January 20 -> previous trading day is Friday, January 16
    const result = getPreviousTradingDay(new Date(2026, 0, 20));
    expect(result.getDate()).toBe(16);
    expect(result.getMonth()).toBe(0);
  });

  it("returns Friday when called on Saturday", () => {
    // Saturday, January 17, 2026 -> Friday, January 16
    const result = getPreviousTradingDay(new Date(2026, 0, 17));
    expect(result.getDate()).toBe(16);
    expect(result.getMonth()).toBe(0);
  });

  it("returns Friday when called on Sunday", () => {
    // Sunday, January 18, 2026 -> Friday, January 16
    const result = getPreviousTradingDay(new Date(2026, 0, 18));
    expect(result.getDate()).toBe(16);
    expect(result.getMonth()).toBe(0);
  });

  it("skips holidays", () => {
    // Day after New Year's 2026 (Jan 2) -> Wednesday Dec 31, 2025
    const result = getPreviousTradingDay(new Date(2026, 0, 2));
    expect(result.getDate()).toBe(31);
    expect(result.getMonth()).toBe(11); // December
    expect(result.getFullYear()).toBe(2025);
  });
});

// ============================================================================
// getEasterDate
// ============================================================================

describe("getEasterDate", () => {
  it("calculates Easter 2026 correctly", () => {
    // Easter 2026 is April 5
    const easter = getEasterDate(2026);
    expect(easter.getMonth()).toBe(3); // April (0-indexed)
    expect(easter.getDate()).toBe(5);
  });

  it("calculates Easter 2025 correctly", () => {
    // Easter 2025 is April 20
    const easter = getEasterDate(2025);
    expect(easter.getMonth()).toBe(3);
    expect(easter.getDate()).toBe(20);
  });

  it("calculates Easter 2024 correctly", () => {
    // Easter 2024 is March 31
    const easter = getEasterDate(2024);
    expect(easter.getMonth()).toBe(2); // March
    expect(easter.getDate()).toBe(31);
  });

  it("calculates Easter 2023 correctly", () => {
    // Easter 2023 is April 9
    const easter = getEasterDate(2023);
    expect(easter.getMonth()).toBe(3);
    expect(easter.getDate()).toBe(9);
  });
});

// ============================================================================
// getFlowSentiment
// ============================================================================

describe("getFlowSentiment", () => {
  it("returns positive for positive values", () => {
    expect(getFlowSentiment(100)).toBe("positive");
    expect(getFlowSentiment(0.01)).toBe("positive");
  });

  it("returns negative for negative values", () => {
    expect(getFlowSentiment(-100)).toBe("negative");
    expect(getFlowSentiment(-0.01)).toBe("negative");
  });

  it("returns neutral for zero", () => {
    expect(getFlowSentiment(0)).toBe("neutral");
  });
});

// ============================================================================
// formatTradingDate
// ============================================================================

describe("formatTradingDate", () => {
  it("formats date with weekday, month, and day", () => {
    const date = new Date(2026, 0, 15); // Thursday, January 15, 2026
    const result = formatTradingDate(date);
    // Should contain "Thu", "Jan", "15"
    expect(result).toContain("Thu");
    expect(result).toContain("Jan");
    expect(result).toContain("15");
  });

  it("handles different days of week", () => {
    const friday = new Date(2026, 0, 16); // Friday
    expect(formatTradingDate(friday)).toContain("Fri");

    const monday = new Date(2026, 0, 12); // Monday
    expect(formatTradingDate(monday)).toContain("Mon");
  });
});

// ============================================================================
// parseFlowValue
// ============================================================================

describe("parseFlowValue", () => {
  it("parses positive numbers", () => {
    expect(parseFlowValue("145.2")).toBe(145.2);
    expect(parseFlowValue("100")).toBe(100);
  });

  it("parses negative numbers in parentheses", () => {
    expect(parseFlowValue("(312.2)")).toBe(-312.2);
    expect(parseFlowValue("(50)")).toBe(-50);
  });

  it("parses numbers with commas", () => {
    expect(parseFlowValue("1,234.5")).toBe(1234.5);
    expect(parseFlowValue("(1,000)")).toBe(-1000);
  });

  it("returns null for dash", () => {
    expect(parseFlowValue("-")).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(parseFlowValue("")).toBe(null);
  });

  it("returns null for invalid input", () => {
    expect(parseFlowValue("abc")).toBe(null);
    expect(parseFlowValue("N/A")).toBe(null);
  });

  it("handles zero", () => {
    expect(parseFlowValue("0")).toBe(0);
    expect(parseFlowValue("0.0")).toBe(0);
  });

  it("handles whitespace", () => {
    expect(parseFlowValue(" 100 ")).toBe(100);
    expect(parseFlowValue("( 50 )")).toBe(-50);
  });
});

// ============================================================================
// formatMillion
// ============================================================================

describe("formatMillion", () => {
  it("formats positive values with + sign", () => {
    expect(formatMillion(145.2)).toBe("+$145.2M");
    expect(formatMillion(100)).toBe("+$100.0M");
  });

  it("formats negative values with - sign", () => {
    expect(formatMillion(-23.1)).toBe("-$23.1M");
    expect(formatMillion(-100)).toBe("-$100.0M");
  });

  it("formats zero without sign", () => {
    expect(formatMillion(0)).toBe("$0");
  });

  it("rounds to one decimal place", () => {
    expect(formatMillion(145.26)).toBe("+$145.3M");
    expect(formatMillion(-23.14)).toBe("-$23.1M");
  });
});

// ============================================================================
// buildETFItem (partial success handling)
// ============================================================================

describe("buildETFItem", () => {
  const testUrl = "https://farside.co.uk/btc/";

  describe("when fetch succeeds", () => {
    it("returns formatted flow with positive sentiment", () => {
      const result = buildETFItem(
        "BTC",
        {
          status: "fulfilled",
          value: [
            { ticker: "IBIT", name: "IBIT", flow: 100, date: new Date() },
          ],
        },
        testUrl,
      );
      expect(result.text).toBe("BTC ETFs: +$100.0M");
      expect(result.sentiment).toBe("positive");
      expect(result.url).toBe(testUrl);
    });

    it("returns formatted flow with negative sentiment", () => {
      const result = buildETFItem(
        "ETH",
        {
          status: "fulfilled",
          value: [
            { ticker: "ETHA", name: "ETHA", flow: -50, date: new Date() },
          ],
        },
        testUrl,
      );
      expect(result.text).toBe("ETH ETFs: -$50.0M");
      expect(result.sentiment).toBe("negative");
    });

    it("sums multiple ETF flows", () => {
      const result = buildETFItem(
        "BTC",
        {
          status: "fulfilled",
          value: [
            { ticker: "IBIT", name: "IBIT", flow: 100, date: new Date() },
            { ticker: "FBTC", name: "FBTC", flow: 50, date: new Date() },
            { ticker: "GBTC", name: "GBTC", flow: -30, date: new Date() },
          ],
        },
        testUrl,
      );
      expect(result.text).toBe("BTC ETFs: +$120.0M");
      expect(result.sentiment).toBe("positive");
    });

    it("handles zero total with neutral sentiment", () => {
      const result = buildETFItem(
        "SOL",
        {
          status: "fulfilled",
          value: [
            { ticker: "BSOL", name: "BSOL", flow: 50, date: new Date() },
            { ticker: "VSOL", name: "VSOL", flow: -50, date: new Date() },
          ],
        },
        testUrl,
      );
      expect(result.text).toBe("SOL ETFs: $0");
      expect(result.sentiment).toBe("neutral");
    });

    it("handles empty flows array", () => {
      const result = buildETFItem(
        "BTC",
        { status: "fulfilled", value: [] },
        testUrl,
      );
      expect(result.text).toBe("BTC ETFs: $0");
      expect(result.sentiment).toBe("neutral");
    });
  });

  describe("when fetch fails", () => {
    it("returns unavailable with neutral sentiment for Error", () => {
      const result = buildETFItem(
        "BTC",
        { status: "rejected", reason: new Error("Timeout after 30000ms") },
        testUrl,
      );
      expect(result.text).toBe("BTC ETFs: unavailable");
      expect(result.sentiment).toBe("neutral");
      expect(result.url).toBe(testUrl);
    });

    it("returns unavailable for string error", () => {
      const result = buildETFItem(
        "ETH",
        { status: "rejected", reason: "Network error" },
        testUrl,
      );
      expect(result.text).toBe("ETH ETFs: unavailable");
      expect(result.sentiment).toBe("neutral");
    });

    it("handles different ETF types", () => {
      const solResult = buildETFItem(
        "SOL",
        { status: "rejected", reason: new Error("Connection refused") },
        "https://farside.co.uk/sol/",
      );
      expect(solResult.text).toBe("SOL ETFs: unavailable");
      expect(solResult.url).toBe("https://farside.co.uk/sol/");
    });
  });
});
