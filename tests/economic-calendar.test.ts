/**
 * Tests for economic calendar weekend logic:
 * date helpers, event scoring, and top-N selection.
 */

import { describe, expect, it } from "bun:test";
import {
  getNextWeekRange,
  getTopEvents,
  isWeekend,
  scoreEvent,
  type TradingViewEvent,
} from "../src/sources/economic-calendar";

// ============================================================================
// Test Data Factory
// ============================================================================

const createEvent = (
  overrides: Partial<TradingViewEvent> = {},
): TradingViewEvent => ({
  id: "test-1",
  title: "Test Event",
  country: "US",
  indicator: "test.indicator",
  date: "2026-02-16T13:30:00.000Z", // Monday
  actual: null,
  forecast: null,
  previous: null,
  importance: 1,
  ...overrides,
});

// ============================================================================
// isWeekend
// ============================================================================

describe("isWeekend", () => {
  it("returns true for Saturday", () => {
    // Saturday, February 14, 2026
    expect(isWeekend(new Date(2026, 1, 14))).toBe(true);
  });

  it("returns true for Sunday", () => {
    // Sunday, February 15, 2026
    expect(isWeekend(new Date(2026, 1, 15))).toBe(true);
  });

  it("returns false for Monday", () => {
    // Monday, February 16, 2026
    expect(isWeekend(new Date(2026, 1, 16))).toBe(false);
  });

  it("returns false for Wednesday", () => {
    // Wednesday, February 18, 2026
    expect(isWeekend(new Date(2026, 1, 18))).toBe(false);
  });

  it("returns false for Friday", () => {
    // Friday, February 20, 2026
    expect(isWeekend(new Date(2026, 1, 20))).toBe(false);
  });
});

// ============================================================================
// getNextWeekRange
// ============================================================================

describe("getNextWeekRange", () => {
  it("returns Mon-Fri when given a Saturday", () => {
    // Saturday, February 14, 2026 → Mon Feb 16 - Fri Feb 20
    const saturday = new Date(2026, 1, 14, 10, 30);
    const { start, end } = getNextWeekRange(saturday);

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(1);
    expect(start.getDate()).toBe(16); // Monday
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);

    expect(end.getDate()).toBe(20); // Friday
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("returns Mon-Fri when given a Sunday", () => {
    // Sunday, February 15, 2026 → Mon Feb 16 - Fri Feb 20
    const sunday = new Date(2026, 1, 15, 9, 0);
    const { start, end } = getNextWeekRange(sunday);

    expect(start.getDate()).toBe(16); // Monday
    expect(end.getDate()).toBe(20); // Friday
  });

  it("handles month boundaries (Saturday at end of month)", () => {
    // Saturday, January 31, 2026 → Mon Feb 2 - Fri Feb 6
    const saturday = new Date(2026, 0, 31);
    const { start, end } = getNextWeekRange(saturday);

    expect(start.getMonth()).toBe(1); // February
    expect(start.getDate()).toBe(2); // Monday
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(6); // Friday
  });

  it("handles year boundaries (Saturday Dec 27, 2025)", () => {
    // Saturday, December 27, 2025 → Mon Dec 29 - Fri Jan 2, 2026
    const saturday = new Date(2025, 11, 27);
    const { start, end } = getNextWeekRange(saturday);

    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(11); // December
    expect(start.getDate()).toBe(29); // Monday

    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(0); // January
    expect(end.getDate()).toBe(2); // Friday
  });
});

// ============================================================================
// scoreEvent
// ============================================================================

describe("scoreEvent", () => {
  describe("tier 1 indicators (score 10)", () => {
    it("scores US Nonfarm Payrolls at 15 (10 * 1.5 US weight)", () => {
      const event = createEvent({ title: "Nonfarm Payrolls", country: "US" });
      expect(scoreEvent(event)).toBe(15);
    });

    it("scores US CPI at 15", () => {
      const event = createEvent({
        title: "Consumer Price Index (MoM)",
        country: "US",
      });
      expect(scoreEvent(event)).toBe(15);
    });

    it("scores ECB Interest Rate Decision at 12 (10 * 1.2 EU weight)", () => {
      const event = createEvent({
        title: "ECB Interest Rate Decision",
        country: "EU",
      });
      expect(scoreEvent(event)).toBe(12);
    });

    it("scores FOMC at 15 (US)", () => {
      const event = createEvent({
        title: "FOMC Statement",
        country: "US",
      });
      expect(scoreEvent(event)).toBe(15);
    });
  });

  describe("tier 2 indicators (score 8)", () => {
    it("scores US GDP at 12 (8 * 1.5)", () => {
      const event = createEvent({ title: "GDP (QoQ)", country: "US" });
      expect(scoreEvent(event)).toBe(12);
    });

    it("scores US Retail Sales at 12", () => {
      const event = createEvent({
        title: "Retail Sales (MoM)",
        country: "US",
      });
      expect(scoreEvent(event)).toBe(12);
    });

    it("scores GB Unemployment Rate at 9.6 (8 * 1.2)", () => {
      const event = createEvent({
        title: "Unemployment Rate",
        country: "GB",
      });
      expect(scoreEvent(event)).toBe(8 * 1.2);
    });
  });

  describe("tier 3 indicators (score 6)", () => {
    it("scores US ISM Manufacturing at 9 (6 * 1.5)", () => {
      const event = createEvent({
        title: "ISM Manufacturing PMI",
        country: "US",
      });
      // "ism manufacturing" matches score 6, but "pmi" also matches score 6
      // max is 6, times 1.5 US weight = 9
      expect(scoreEvent(event)).toBe(9);
    });

    it("scores JP Trade Balance at 6 (6 * 1.0)", () => {
      const event = createEvent({
        title: "Trade Balance",
        country: "JP",
      });
      expect(scoreEvent(event)).toBe(6);
    });
  });

  describe("default scoring", () => {
    it("scores unknown high-importance events at default (4 * country weight)", () => {
      const event = createEvent({
        title: "Some Obscure Indicator",
        country: "US",
      });
      expect(scoreEvent(event)).toBe(6); // 4 * 1.5
    });

    it("uses 1.0 weight for unknown countries", () => {
      const event = createEvent({
        title: "Some Indicator",
        country: "AU",
      });
      expect(scoreEvent(event)).toBe(4); // 4 * 1.0
    });
  });

  describe("country weighting", () => {
    it("US events score higher than EU events for the same indicator", () => {
      const usEvent = createEvent({ title: "GDP (QoQ)", country: "US" });
      const euEvent = createEvent({ title: "GDP (QoQ)", country: "EU" });
      expect(scoreEvent(usEvent)).toBeGreaterThan(scoreEvent(euEvent));
    });

    it("EU events score higher than JP events for the same indicator", () => {
      const euEvent = createEvent({ title: "GDP (QoQ)", country: "EU" });
      const jpEvent = createEvent({ title: "GDP (QoQ)", country: "JP" });
      expect(scoreEvent(euEvent)).toBeGreaterThan(scoreEvent(jpEvent));
    });
  });
});

// ============================================================================
// getTopEvents
// ============================================================================

describe("getTopEvents", () => {
  it("returns top N events sorted by score descending", () => {
    const events = [
      createEvent({ id: "1", title: "Trade Balance", country: "JP" }), // 6
      createEvent({ id: "2", title: "Nonfarm Payrolls", country: "US" }), // 15
      createEvent({ id: "3", title: "GDP (QoQ)", country: "EU" }), // 9.6
      createEvent({ id: "4", title: "Consumer Price Index", country: "US" }), // 15
      createEvent({ id: "5", title: "PMI", country: "DE" }), // 6.6
    ];

    const top3 = getTopEvents(events, 3);
    const ids = top3.map((e) => e.id);

    // US NFP and US CPI tied at 15 (tiebreak: same date → stable sort),
    // then EU GDP at 9.6
    expect(ids).toEqual(["2", "4", "3"]);
  });

  it("uses chronological order as tiebreaker", () => {
    const events = [
      createEvent({
        id: "late",
        title: "Nonfarm Payrolls",
        country: "US",
        date: "2026-02-20T13:30:00.000Z", // Friday
      }),
      createEvent({
        id: "early",
        title: "Consumer Price Index",
        country: "US",
        date: "2026-02-17T13:30:00.000Z", // Tuesday
      }),
    ];

    const result = getTopEvents(events, 2);
    const ids = result.map((e) => e.id);

    // Both score 15 — earlier date should come first
    expect(ids).toEqual(["early", "late"]);
  });

  it("returns all events when limit exceeds event count", () => {
    const events = [
      createEvent({ id: "1", title: "GDP", country: "US" }),
      createEvent({ id: "2", title: "CPI", country: "US" }),
    ];

    const result = getTopEvents(events, 5);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(getTopEvents([], 5)).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const events = [
      createEvent({ id: "1", title: "PMI", country: "JP" }),
      createEvent({ id: "2", title: "CPI", country: "US" }),
    ];
    const original = [...events];

    getTopEvents(events, 1);

    const ids = events.map((e) => e.id);
    const originalIds = original.map((e) => e.id);
    expect(ids).toEqual(originalIds);
  });

  it("correctly ranks a realistic week of events", () => {
    const events = [
      createEvent({
        id: "mon-pmi",
        title: "ISM Manufacturing PMI",
        country: "US",
        date: "2026-02-16T15:00:00.000Z",
      }),
      createEvent({
        id: "tue-cpi",
        title: "Consumer Price Index (MoM)",
        country: "US",
        date: "2026-02-17T13:30:00.000Z",
      }),
      createEvent({
        id: "wed-gdp-eu",
        title: "GDP (QoQ)",
        country: "EU",
        date: "2026-02-18T10:00:00.000Z",
      }),
      createEvent({
        id: "thu-claims",
        title: "Initial Jobless Claims",
        country: "US",
        date: "2026-02-19T13:30:00.000Z",
      }),
      createEvent({
        id: "thu-trade",
        title: "Trade Balance",
        country: "JP",
        date: "2026-02-19T23:50:00.000Z",
      }),
      createEvent({
        id: "fri-retail",
        title: "Retail Sales (MoM)",
        country: "US",
        date: "2026-02-20T13:30:00.000Z",
      }),
    ];

    const top5 = getTopEvents(events, 5);

    const ids = top5.map((e) => e.id);

    // Expected order by score:
    // 1. US CPI: 10 * 1.5 = 15
    // 2. US Initial Jobless Claims: 8 * 1.5 = 12
    // 3. US Retail Sales: 8 * 1.5 = 12 (tiebreak: later date than claims)
    // 4. EU GDP: 8 * 1.2 = 9.6
    // 5. US ISM Manufacturing PMI: 6 * 1.5 = 9
    expect(ids).toEqual([
      "tue-cpi",
      "thu-claims",
      "fri-retail",
      "wed-gdp-eu",
      "mon-pmi",
    ]);
  });
});
