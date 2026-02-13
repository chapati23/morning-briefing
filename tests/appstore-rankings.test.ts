/**
 * Tests for App Store Rankings source
 *
 * Covers: trend computation, trend formatting, date key formatting,
 * position formatting, sentiment derivation, and history pruning.
 * Network-dependent fetching is not tested here.
 */

import { describe, expect, it } from "bun:test";
import {
  computeTrend,
  formatPositionText,
  formatTrendDelta,
  formatTrendLine,
  getSentiment,
} from "../src/sources/appstore-rankings";
import { formatDateKey, pruneOldEntries } from "../src/utils/rankings-storage";
import type { RankingsHistory } from "../src/utils/rankings-storage";

// ============================================================================
// formatDateKey
// ============================================================================

describe("formatDateKey", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(formatDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("pads single-digit months and days", () => {
    expect(formatDateKey(new Date(2026, 1, 3))).toBe("2026-02-03");
  });

  it("handles December correctly", () => {
    expect(formatDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

// ============================================================================
// computeTrend
// ============================================================================

describe("computeTrend", () => {
  const refDate = new Date(2026, 1, 13); // Feb 13, 2026

  const makeHistory = (
    dateKey: string,
    bundleId: string,
    overall: number | null,
    finance: number | null,
  ): RankingsHistory => ({
    [dateKey]: {
      [bundleId]: { overall, finance },
    },
  });

  it("returns null when no historical data exists", () => {
    const result = computeTrend({}, 35, "com.test", "finance", 1, refDate);
    expect(result).toBeNull();
  });

  it("computes positive delta when rank improved (lower number)", () => {
    // Yesterday was #50, today is #35 → improved by 15
    const history = makeHistory("2026-02-12", "com.test", null, 50);
    const result = computeTrend(history, 35, "com.test", "finance", 1, refDate);
    expect(result).toEqual({ delta: 15, isNew: false, isOut: false });
  });

  it("computes negative delta when rank worsened (higher number)", () => {
    // Yesterday was #20, today is #35 → worsened by 15
    const history = makeHistory("2026-02-12", "com.test", null, 20);
    const result = computeTrend(history, 35, "com.test", "finance", 1, refDate);
    expect(result).toEqual({ delta: -15, isNew: false, isOut: false });
  });

  it("returns zero delta when rank unchanged", () => {
    const history = makeHistory("2026-02-12", "com.test", null, 35);
    const result = computeTrend(history, 35, "com.test", "finance", 1, refDate);
    expect(result).toEqual({ delta: 0, isNew: false, isOut: false });
  });

  it("marks as NEW when previously unranked, now ranked", () => {
    const history = makeHistory("2026-02-12", "com.test", null, null);
    const result = computeTrend(history, 35, "com.test", "finance", 1, refDate);
    expect(result).toEqual({ delta: 0, isNew: true, isOut: false });
  });

  it("marks as OUT when previously ranked, now unranked", () => {
    const history = makeHistory("2026-02-12", "com.test", null, 50);
    const result = computeTrend(
      history,
      null,
      "com.test",
      "finance",
      1,
      refDate,
    );
    expect(result).toEqual({ delta: 0, isNew: false, isOut: true });
  });

  it("returns null when both past and current are unranked", () => {
    const history = makeHistory("2026-02-12", "com.test", null, null);
    const result = computeTrend(
      history,
      null,
      "com.test",
      "finance",
      1,
      refDate,
    );
    expect(result).toBeNull();
  });

  it("computes 7-day trend correctly", () => {
    // 7 days ago (Feb 6) was #100, today is #35 → improved by 65
    const history = makeHistory("2026-02-06", "com.test", null, 100);
    const result = computeTrend(history, 35, "com.test", "finance", 7, refDate);
    expect(result).toEqual({ delta: 65, isNew: false, isOut: false });
  });

  it("computes 30-day trend correctly", () => {
    // 30 days ago (Jan 14) was #200, today is #50 → improved by 150
    const history = makeHistory("2026-01-14", "com.test", null, 200);
    const result = computeTrend(
      history,
      50,
      "com.test",
      "finance",
      30,
      refDate,
    );
    expect(result).toEqual({ delta: 150, isNew: false, isOut: false });
  });

  it("works for overall field too", () => {
    const history = makeHistory("2026-02-12", "com.test", 80, null);
    const result = computeTrend(history, 35, "com.test", "overall", 1, refDate);
    expect(result).toEqual({ delta: 45, isNew: false, isOut: false });
  });

  it("returns null when app entry is missing from historical snapshot", () => {
    const history: RankingsHistory = {
      "2026-02-12": {
        "com.other-app": { overall: null, finance: 10 },
      },
    };
    const result = computeTrend(history, 35, "com.test", "finance", 1, refDate);
    expect(result).toBeNull();
  });
});

// ============================================================================
// formatTrendDelta
// ============================================================================

describe("formatTrendDelta", () => {
  it("formats positive delta with up arrow", () => {
    expect(formatTrendDelta({ delta: 15, isNew: false, isOut: false })).toBe(
      "↑15",
    );
  });

  it("formats negative delta with down arrow", () => {
    expect(formatTrendDelta({ delta: -8, isNew: false, isOut: false })).toBe(
      "↓8",
    );
  });

  it("formats zero delta as dash", () => {
    expect(formatTrendDelta({ delta: 0, isNew: false, isOut: false })).toBe(
      "—",
    );
  });

  it("formats NEW entry", () => {
    expect(formatTrendDelta({ delta: 0, isNew: true, isOut: false })).toBe(
      "NEW",
    );
  });

  it("formats OUT entry", () => {
    expect(formatTrendDelta({ delta: 0, isNew: false, isOut: true })).toBe(
      "OUT",
    );
  });
});

// ============================================================================
// formatTrendLine
// ============================================================================

describe("formatTrendLine", () => {
  const up5 = { delta: 5, isNew: false, isOut: false };
  const down3 = { delta: -3, isNew: false, isOut: false };
  const newEntry = { delta: 0, isNew: true, isOut: false };

  it("returns undefined when no trends are available", () => {
    expect(formatTrendLine({ daily: null, weekly: null, monthly: null })).toBe(
      undefined,
    );
  });

  it("formats a single daily trend", () => {
    expect(formatTrendLine({ daily: up5, weekly: null, monthly: null })).toBe(
      "↑5 daily",
    );
  });

  it("formats daily and weekly trends", () => {
    expect(formatTrendLine({ daily: up5, weekly: down3, monthly: null })).toBe(
      "↑5 daily · ↓3 weekly",
    );
  });

  it("formats all three trends", () => {
    expect(
      formatTrendLine({ daily: up5, weekly: down3, monthly: newEntry }),
    ).toBe("↑5 daily · ↓3 weekly · NEW monthly");
  });

  it("formats only weekly and monthly (no daily)", () => {
    expect(formatTrendLine({ daily: null, weekly: down3, monthly: up5 })).toBe(
      "↓3 weekly · ↑5 monthly",
    );
  });
});

// ============================================================================
// getSentiment
// ============================================================================

describe("getSentiment", () => {
  it("returns undefined when no trends are available", () => {
    expect(
      getSentiment({ daily: null, weekly: null, monthly: null }),
    ).toBeUndefined();
  });

  it("returns positive for weekly upward trend", () => {
    expect(
      getSentiment({
        daily: null,
        weekly: { delta: 10, isNew: false, isOut: false },
        monthly: null,
      }),
    ).toBe("positive");
  });

  it("returns negative for weekly downward trend", () => {
    expect(
      getSentiment({
        daily: null,
        weekly: { delta: -5, isNew: false, isOut: false },
        monthly: null,
      }),
    ).toBe("negative");
  });

  it("returns neutral for weekly zero delta", () => {
    expect(
      getSentiment({
        daily: null,
        weekly: { delta: 0, isNew: false, isOut: false },
        monthly: null,
      }),
    ).toBe("neutral");
  });

  it("returns positive for NEW entry", () => {
    expect(
      getSentiment({
        daily: null,
        weekly: { delta: 0, isNew: true, isOut: false },
        monthly: null,
      }),
    ).toBe("positive");
  });

  it("returns negative for OUT entry", () => {
    expect(
      getSentiment({
        daily: null,
        weekly: { delta: 0, isNew: false, isOut: true },
        monthly: null,
      }),
    ).toBe("negative");
  });

  it("falls back to daily when weekly is null", () => {
    expect(
      getSentiment({
        daily: { delta: 8, isNew: false, isOut: false },
        weekly: null,
        monthly: null,
      }),
    ).toBe("positive");
  });

  it("prefers weekly over daily when both are present", () => {
    expect(
      getSentiment({
        daily: { delta: 10, isNew: false, isOut: false },
        weekly: { delta: -5, isNew: false, isOut: false },
        monthly: null,
      }),
    ).toBe("negative");
  });
});

// ============================================================================
// formatPositionText
// ============================================================================

describe("formatPositionText", () => {
  const app = { name: "Coinbase", bundleId: "com.test", itunesId: "123" };

  it("shows unranked when both overall and finance are null", () => {
    expect(formatPositionText(app, { overall: null, finance: null })).toBe(
      "Coinbase: unranked",
    );
  });

  it("shows both ranks when both are present", () => {
    expect(formatPositionText(app, { overall: 35, finance: 12 })).toBe(
      "Coinbase: #35 overall · #12 Finance",
    );
  });

  it("shows only finance when overall is null", () => {
    expect(formatPositionText(app, { overall: null, finance: 128 })).toBe(
      "Coinbase: #128 Finance",
    );
  });

  it("shows only overall when finance is null", () => {
    expect(formatPositionText(app, { overall: 50, finance: null })).toBe(
      "Coinbase: #50 overall",
    );
  });

  it("uses app name in output", () => {
    const poly = { name: "Polymarket", bundleId: "com.poly", itunesId: "456" };
    expect(formatPositionText(poly, { overall: null, finance: 80 })).toBe(
      "Polymarket: #80 Finance",
    );
  });
});

// ============================================================================
// pruneOldEntries
// ============================================================================

describe("pruneOldEntries", () => {
  const refDate = new Date(2026, 1, 13); // Feb 13, 2026

  it("keeps entries within retention period", () => {
    const history: RankingsHistory = {
      "2026-02-13": {
        "com.test": { overall: 35, finance: 12 },
      },
    };

    const pruned = pruneOldEntries(history, refDate);
    expect(Object.keys(pruned)).toContain("2026-02-13");
  });

  it("removes entries older than 90 days", () => {
    const history: RankingsHistory = {
      "2025-11-01": {
        "com.test": { overall: 35, finance: 12 },
      },
      "2026-02-13": {
        "com.test": { overall: 30, finance: 10 },
      },
    };

    const pruned = pruneOldEntries(history, refDate);
    expect(Object.keys(pruned)).not.toContain("2025-11-01");
    expect(Object.keys(pruned)).toContain("2026-02-13");
  });

  it("returns empty object when all entries are old", () => {
    const history: RankingsHistory = {
      "2025-10-01": {
        "com.test": { overall: 35, finance: 12 },
      },
    };

    const pruned = pruneOldEntries(history, refDate);
    expect(Object.keys(pruned)).toHaveLength(0);
  });

  it("handles empty history", () => {
    const pruned = pruneOldEntries({}, refDate);
    expect(pruned).toEqual({});
  });

  it("keeps entries exactly at the 90-day boundary", () => {
    // 90 days before Feb 13 = Nov 15
    const history: RankingsHistory = {
      "2025-11-15": {
        "com.test": { overall: 35, finance: 12 },
      },
    };
    const pruned = pruneOldEntries(history, refDate);
    expect(Object.keys(pruned)).toContain("2025-11-15");
  });
});
