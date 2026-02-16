/**
 * End-to-End Tests for the Full Briefing Pipeline
 *
 * These tests verify the complete flow from data sources through
 * formatting and notification delivery, using mock implementations.
 */

import { describe, expect, it, mock } from "bun:test";
import { formatBriefingForTelegram } from "../../src/channels/telegram";
import { runFullBriefing } from "../../src/orchestrator";
import type { DataSource, NotificationChannel } from "../../src/types";
import {
  createFailingSource,
  createSuccessChannel,
  createSuccessSource,
  createTestBriefing,
  createTestSection,
} from "../helpers";

// ============================================================================
// Full Pipeline Integration Tests
// ============================================================================

describe("Full Briefing Pipeline", () => {
  describe("source collection and aggregation", () => {
    it("should aggregate sections from multiple sources in priority order", async () => {
      const sources: DataSource[] = [
        createSuccessSource("ETF Flows", 2, [
          { text: "SPY: +$500M" },
          { text: "QQQ: -$200M" },
        ]),
        createSuccessSource("Economic Calendar", 1, [
          { text: "FOMC Meeting @ 2:00 PM" },
        ]),
        createSuccessSource("Polymarket", 3, [
          { text: "Bitcoin $100k: 45% (+5%)" },
        ]),
      ];

      const briefing = await runFullBriefing(sources, []);

      expect(briefing.sections).toHaveLength(3);
      expect(briefing.sections[0]?.title).toBe("Economic Calendar");
      expect(briefing.sections[1]?.title).toBe("ETF Flows");
      expect(briefing.sections[2]?.title).toBe("Polymarket");
    });

    it("should include partial results when some sources fail", async () => {
      const sources: DataSource[] = [
        createSuccessSource("Working Source", 1, [{ text: "Success data" }]),
        createFailingSource("Broken Source", "API unavailable"),
      ];

      const briefing = await runFullBriefing(sources, []);

      expect(briefing.sections).toHaveLength(1);
      expect(briefing.sections[0]?.title).toBe("Working Source");
      expect(briefing.failures).toHaveLength(1);
      expect(briefing.failures[0]?.source).toBe("Broken Source");
    });

    it("should produce an empty briefing when all sources fail", async () => {
      const sources: DataSource[] = [
        createFailingSource("Source A", "Error A"),
        createFailingSource("Source B", "Error B"),
      ];

      const briefing = await runFullBriefing(sources, []);

      expect(briefing.sections).toHaveLength(0);
      expect(briefing.failures).toHaveLength(2);
    });
  });

  describe("conditional section inclusion", () => {
    it("should exclude sources that return empty items from the briefing", async () => {
      const sources: DataSource[] = [
        createSuccessSource("ETF Flows", 1, [{ text: "SPY: +$500M" }]),
        createSuccessSource("OpenSea Voyages", 2, []), // No voyages available
        createSuccessSource("Polymarket", 3, [{ text: "Bitcoin $100k: 45%" }]),
      ];

      const briefing = await runFullBriefing(sources, []);

      expect(briefing.sections).toHaveLength(2);
      expect(briefing.sections[0]?.title).toBe("ETF Flows");
      expect(briefing.sections[1]?.title).toBe("Polymarket");
      // Empty source should not appear as a failure
      expect(briefing.failures).toHaveLength(0);
    });

    it("should exclude empty sections from Telegram formatting", async () => {
      const sources: DataSource[] = [
        createSuccessSource("Economic Calendar", 1, [{ text: "FOMC Meeting" }]),
        createSuccessSource("Empty Source", 2, []),
      ];

      const briefing = await runFullBriefing(
        sources,
        [],
        new Date("2026-01-15"),
      );
      const formatted = formatBriefingForTelegram(briefing);

      expect(formatted).toContain("Economic Calendar");
      expect(formatted).not.toContain("Empty Source");
    });
  });

  describe("channel notification delivery", () => {
    it("should deliver briefing to all channels", async () => {
      const sources = [createSuccessSource("Test Source", 1)];
      const channel1 = createSuccessChannel("Telegram");
      const channel2 = createSuccessChannel("Slack");

      await runFullBriefing(sources, [channel1, channel2]);

      expect(channel1.sendMock).toHaveBeenCalledTimes(1);
      expect(channel2.sendMock).toHaveBeenCalledTimes(1);
    });

    it("should deliver briefing even when some channels fail", async () => {
      const sources = [createSuccessSource("Test Source", 1)];
      const successChannel = createSuccessChannel("Success");
      const failingChannel: NotificationChannel = {
        name: "Failing",
        send: mock(() => Promise.reject(new Error("Network error"))),
      };

      // Should not throw
      await runFullBriefing(sources, [failingChannel, successChannel]);

      expect(successChannel.sendMock).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// Telegram Formatting Integration Tests
// ============================================================================

describe("Telegram Formatting Integration", () => {
  describe("complete briefing formatting", () => {
    it("should format a briefing with multiple sections", () => {
      const briefing = createTestBriefing({
        date: new Date("2026-01-15"),
        sections: [
          createTestSection({
            title: "ETF Flows",
            icon: "📊",
            items: [{ text: "SPY: +$500M" }, { text: "QQQ: -$200M" }],
          }),
          createTestSection({
            title: "Economic Calendar",
            icon: "📅",
            items: [{ text: "FOMC Meeting @ 2:00 PM" }],
          }),
        ],
      });

      const formatted = formatBriefingForTelegram(briefing);

      // Verify header has date as bold title
      expect(formatted).toMatch(/^\*.*15, 2026.*\*/);
      expect(formatted).not.toContain("Morning Briefing");

      // Verify section titles are present (escaped)
      expect(formatted).toContain("ETF Flows");
      expect(formatted).toContain("Economic Calendar");

      // Verify section separators
      expect(formatted).toContain("──────────────");
    });

    it("should include failed sources section when there are failures", () => {
      const briefing = createTestBriefing({
        sections: [createTestSection({ title: "Working Source", icon: "✅" })],
        failures: [{ source: "Broken Source", error: "API timeout" }],
      });

      const formatted = formatBriefingForTelegram(briefing);

      expect(formatted).toContain("Failed Sources");
      expect(formatted).toContain("Broken Source");
    });

    it("should properly escape special markdown characters", () => {
      const briefing = createTestBriefing({
        sections: [
          createTestSection({
            title: "Test-Section (With Special_Chars)",
            icon: "📊",
            items: [{ text: "Price: $100.50 (up 5%)" }],
          }),
        ],
      });

      const formatted = formatBriefingForTelegram(briefing);

      // Should contain escaped characters (in title and non-money parts)
      expect(formatted).toContain("\\-"); // hyphen in title
      expect(formatted).toContain("\\("); // parentheses
      expect(formatted).toContain("\\)");
      expect(formatted).toContain("\\_"); // underscore in title
      // Note: period in $100.50 is inside backticks, so not escaped
      expect(formatted).toContain("`$100.50`");
    });
  });

  describe("item formatting with money values", () => {
    it("should format items with money values in monospace", () => {
      const briefing = createTestBriefing({
        sections: [
          createTestSection({
            title: "ETF Flows",
            icon: "📊",
            items: [{ text: "SPY: +$500M" }, { text: "QQQ: -$200M" }],
          }),
        ],
      });

      const formatted = formatBriefingForTelegram(briefing);

      // Money values should be in backticks
      expect(formatted).toContain("`+$500M`");
      expect(formatted).toContain("`-$200M`");
    });
  });
});

// ============================================================================
// Realistic Scenario Tests
// ============================================================================

describe("Realistic Briefing Scenarios", () => {
  it("should handle a typical morning briefing flow", async () => {
    // Simulate realistic sources
    const economicCalendar: DataSource = {
      name: "Economic Calendar",
      priority: 1,
      fetch: async () => ({
        title: "Economic Calendar",
        icon: "📅",
        items: [
          { text: "8:30 AM - Initial Jobless Claims (Est: 220K)" },
          { text: "10:00 AM - New Home Sales (Est: 680K)" },
          { text: "2:00 PM - FOMC Meeting Minutes" },
        ],
      }),
    };

    const etfFlows: DataSource = {
      name: "ETF Flows",
      priority: 2,
      fetch: async () => ({
        title: "ETF Flows from Wed, Jan 14",
        icon: "📊",
        items: [
          { text: "SPY: +$1.2B (3 day avg: +$800M)" },
          { text: "QQQ: -$500M (3 day avg: -$200M)" },
          { text: "IWM: +$150M (3 day avg: +$50M)" },
        ],
      }),
    };

    const polymarket: DataSource = {
      name: "Polymarket",
      priority: 3,
      fetch: async () => ({
        title: "Polymarket Predictions",
        icon: "🎰",
        items: [
          { text: "Fed rate cut March: 35% (-5%)" },
          { text: "S&P 500 above 6000 EOY: 65% (+10%)" },
        ],
      }),
    };

    const channel = createSuccessChannel("Telegram");
    const briefing = await runFullBriefing(
      [economicCalendar, etfFlows, polymarket],
      [channel],
      new Date("2026-01-15"),
    );

    // Verify structure
    expect(briefing.sections).toHaveLength(3);
    expect(briefing.failures).toHaveLength(0);

    // Verify ordering by priority
    expect(briefing.sections[0]?.title).toBe("Economic Calendar");
    expect(briefing.sections[1]?.title).toContain("ETF Flows");
    expect(briefing.sections[2]?.title).toContain("Polymarket");

    // Verify channel was called
    expect(channel.sendMock).toHaveBeenCalledTimes(1);

    // Verify formatting works
    const formatted = formatBriefingForTelegram(briefing);
    expect(formatted).toMatch(/^\*.+\*/);
    expect(formatted).toContain("Economic Calendar");
    expect(formatted).toContain("ETF Flows");
    expect(formatted).toContain("Polymarket");
    expect(formatted).toContain("FOMC");
  });

  it("should gracefully handle partial source failures", async () => {
    const workingSource: DataSource = {
      name: "Economic Calendar",
      priority: 1,
      fetch: async () => ({
        title: "Economic Calendar",
        icon: "📅",
        items: [{ text: "No major events today" }],
      }),
    };

    const brokenSource: DataSource = {
      name: "ETF Flows",
      priority: 2,
      fetch: async () => {
        throw new Error("ETF data provider unavailable");
      },
    };

    const channel = createSuccessChannel("Telegram");
    const briefing = await runFullBriefing(
      [workingSource, brokenSource],
      [channel],
    );

    // Should have one section and one failure
    expect(briefing.sections).toHaveLength(1);
    expect(briefing.failures).toHaveLength(1);
    expect(briefing.failures[0]?.source).toBe("ETF Flows");

    // Formatting should include failure notice
    const formatted = formatBriefingForTelegram(briefing);
    expect(formatted).toContain("Failed Sources");
    expect(formatted).toContain("ETF Flows");
  });
});
