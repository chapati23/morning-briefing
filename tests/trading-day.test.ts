/**
 * Tests for trading day logic and ETF flow parsing
 */

import { describe, expect, it } from "bun:test";
import {
  formatMillion,
  formatTradingDate,
  getEasterDate,
  getFlowSentiment,
  getPreviousTradingDay,
  isTradingDay,
  isRetryableETFStatus,
  isUSMarketHoliday,
  parseETFFlowPage,
  readETFFlowResponseBody,
  shouldRetryETFFlowFetch,
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
// parseETFFlowPage
// ============================================================================

describe("parseETFFlowPage", () => {
  const makePage = (flows: unknown): string => `
    <html>
      <body>
        <script id="__NEXT_DATA__" type="application/json">
          ${JSON.stringify({ props: { pageProps: { flows } } })}
        </script>
      </body>
    </html>
  `;

  it("extracts the latest valid aggregate flow record", () => {
    const result = parseETFFlowPage(
      makePage({
        "1785715200": {
          date: 1785715200,
          Bitcoin: 170_100_000,
          Ethereum: -11_900_000,
          Solana: 0,
        },
        "1785801600": {
          date: 1785801600,
          Bitcoin: 211_500_000,
          Ethereum: 53_100_000,
          Solana: 0,
        },
      }),
    );

    expect(result).toEqual({
      timestamp: 1785801600,
      bitcoinUsd: 211_500_000,
      ethereumUsd: 53_100_000,
      solanaUsd: 0,
    });
  });

  it("rejects a malformed newest record instead of returning stale data", () => {
    expect(() =>
      parseETFFlowPage(
        makePage({
          "1785715200": {
            date: 1785715200,
            Bitcoin: 170_100_000,
            Ethereum: -11_900_000,
            Solana: 0,
          },
          "1785801600": {
            date: 1785801600,
            Bitcoin: 211_500_000,
            Ethereum: 53_100_000,
          },
        }),
      ),
    ).toThrow("Solana must be a finite number");
  });

  it("does not infer a missing asset flow as zero", () => {
    expect(() =>
      parseETFFlowPage(
        makePage({
          "1785801600": {
            date: 1785801600,
            Bitcoin: 211_500_000,
            Ethereum: 53_100_000,
          },
        }),
      ),
    ).toThrow("Solana must be a finite number");
  });

  it("rejects non-numeric asset flows", () => {
    expect(() =>
      parseETFFlowPage(
        makePage({
          "1785801600": {
            date: 1785801600,
            Bitcoin: "211500000",
            Ethereum: 53_100_000,
            Solana: 0,
          },
        }),
      ),
    ).toThrow("Bitcoin must be a finite number");
  });

  it("rejects millisecond timestamps", () => {
    expect(() =>
      parseETFFlowPage(
        makePage({
          "1785801600000": {
            date: 1785801600000,
            Bitcoin: 211_500_000,
            Ethereum: 53_100_000,
            Solana: 0,
          },
        }),
      ),
    ).toThrow("flow key must be a plausible Unix timestamp in seconds");
  });

  it("rejects keys that do not match the record date", () => {
    expect(() =>
      parseETFFlowPage(
        makePage({
          "1785801600": {
            date: 1785715200,
            Bitcoin: 211_500_000,
            Ethereum: 53_100_000,
            Solana: 0,
          },
        }),
      ),
    ).toThrow("flow key does not match record date");
  });

  it("rejects pages without Next data", () => {
    expect(() => parseETFFlowPage("<html></html>")).toThrow(
      "__NEXT_DATA__ script not found",
    );
  });

  it("rejects invalid Next data JSON", () => {
    expect(() =>
      parseETFFlowPage('<script id="__NEXT_DATA__">not-json</script>'),
    ).toThrow("__NEXT_DATA__ is not valid JSON");
  });
});

describe("shouldRetryETFFlowFetch", () => {
  it("retries network and timeout errors", () => {
    expect(shouldRetryETFFlowFetch(new TypeError("fetch failed"))).toBe(true);
    expect(
      shouldRetryETFFlowFetch(new DOMException("timed out", "TimeoutError")),
    ).toBe(true);
  });

  it("does not retry parsing and validation errors", () => {
    expect(shouldRetryETFFlowFetch(new Error("invalid schema"))).toBe(false);

    let validationError: unknown;
    try {
      parseETFFlowPage(
        '<script id="__NEXT_DATA__">{"props":{"pageProps":{"flows":{"1785801600":{"date":1785801600,"Bitcoin":1,"Ethereum":2}}}}}</script>',
      );
    } catch (error) {
      validationError = error;
    }
    expect(shouldRetryETFFlowFetch(validationError)).toBe(false);
  });

  it("classifies transient and permanent HTTP statuses", () => {
    expect(isRetryableETFStatus(408)).toBe(true);
    expect(isRetryableETFStatus(429)).toBe(true);
    expect(isRetryableETFStatus(500)).toBe(true);
    expect(isRetryableETFStatus(404)).toBe(false);
  });
});

describe("readETFFlowResponseBody", () => {
  it("reads a bounded response body", async () => {
    const text = await readETFFlowResponseBody(new Response("<html>ok</html>"));
    expect(text).toBe("<html>ok</html>");
  });

  it("rejects oversized responses without retrying", async () => {
    const response = new Response("small", {
      headers: { "content-length": String(5 * 1024 * 1024 + 1) },
    });

    let sizeError: unknown;
    try {
      await readETFFlowResponseBody(response);
    } catch (error) {
      sizeError = error;
    }
    expect(sizeError).toBeInstanceOf(Error);
    expect(shouldRetryETFFlowFetch(sizeError)).toBe(false);
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
