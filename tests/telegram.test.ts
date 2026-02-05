/**
 * Tests for Telegram formatting functions
 */

import { describe, expect, it } from "bun:test";
import {
  escapeMarkdown,
  escapeMarkdownInCode,
  escapeUrlForMarkdown,
  formatBriefingForTelegram,
  formatSection,
  formatTextWithMonospace,
  formatTime,
  getSentimentEmoji,
} from "../src/channels/telegram";
import type { Briefing, BriefingSection } from "../src/types";

// ============================================================================
// escapeMarkdown
// ============================================================================

describe("escapeMarkdown", () => {
  it("escapes underscore", () => {
    expect(escapeMarkdown("test_value")).toBe("test\\_value");
  });

  it("escapes asterisk", () => {
    expect(escapeMarkdown("*bold*")).toBe("\\*bold\\*");
  });

  it("escapes brackets and parentheses", () => {
    expect(escapeMarkdown("[link](url)")).toBe("\\[link\\]\\(url\\)");
  });

  it("escapes math operators", () => {
    expect(escapeMarkdown("2+2=4")).toBe("2\\+2\\=4");
  });

  it("escapes tilde and backtick", () => {
    expect(escapeMarkdown("~strikethrough~ `code`")).toBe(
      "\\~strikethrough\\~ \\`code\\`",
    );
  });

  it("escapes period and exclamation", () => {
    expect(escapeMarkdown("Hello! Test.")).toBe("Hello\\! Test\\.");
  });

  it("escapes hash and pipe", () => {
    expect(escapeMarkdown("#heading | column")).toBe("\\#heading \\| column");
  });

  it("escapes braces", () => {
    expect(escapeMarkdown("{value}")).toBe("\\{value\\}");
  });

  it("escapes backslash", () => {
    expect(escapeMarkdown("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  it("escapes greater than", () => {
    expect(escapeMarkdown("a > b")).toBe("a \\> b");
  });

  it("escapes hyphen", () => {
    expect(escapeMarkdown("item-1")).toBe("item\\-1");
  });

  it("handles multiple special characters", () => {
    expect(escapeMarkdown("Test_value [with] (chars)!")).toBe(
      "Test\\_value \\[with\\] \\(chars\\)\\!",
    );
  });

  it("handles empty string", () => {
    expect(escapeMarkdown("")).toBe("");
  });

  it("handles plain text without special chars", () => {
    expect(escapeMarkdown("Hello World")).toBe("Hello World");
  });
});

// ============================================================================
// escapeUrlForMarkdown
// ============================================================================

describe("escapeUrlForMarkdown", () => {
  it("escapes closing parenthesis", () => {
    expect(escapeUrlForMarkdown("https://example.com/path)")).toBe(
      "https://example.com/path\\)",
    );
  });

  it("escapes backslash", () => {
    expect(escapeUrlForMarkdown("https://example.com/path\\value")).toBe(
      "https://example.com/path\\\\value",
    );
  });

  it("does not escape other special characters", () => {
    expect(
      escapeUrlForMarkdown("https://example.com/path?a=1&b=2#section"),
    ).toBe("https://example.com/path?a=1&b=2#section");
  });

  it("handles URL with parenthesis - only closing needs escape", () => {
    // Only ) and \ need escaping in URLs for MarkdownV2
    expect(escapeUrlForMarkdown("https://example.com/page_(info)")).toBe(
      "https://example.com/page_(info\\)",
    );
  });

  it("handles empty string", () => {
    expect(escapeUrlForMarkdown("")).toBe("");
  });
});

// ============================================================================
// escapeMarkdownInCode
// ============================================================================

describe("escapeMarkdownInCode", () => {
  it("escapes backtick", () => {
    expect(escapeMarkdownInCode("value`test")).toBe("value\\`test");
  });

  it("escapes backslash", () => {
    expect(escapeMarkdownInCode("path\\value")).toBe("path\\\\value");
  });

  it("does not escape other characters", () => {
    expect(escapeMarkdownInCode("$145.2M")).toBe("$145.2M");
  });

  it("handles empty string", () => {
    expect(escapeMarkdownInCode("")).toBe("");
  });
});

// ============================================================================
// formatTextWithMonospace
// ============================================================================

describe("formatTextWithMonospace", () => {
  it("wraps positive dollar amount in monospace", () => {
    // Money values get wrapped in backticks without escaping inside
    expect(formatTextWithMonospace("BTC ETFs: +$145.2M")).toBe(
      "BTC ETFs: `+$145.2M`",
    );
  });

  it("wraps negative dollar amount in monospace", () => {
    expect(formatTextWithMonospace("ETH ETFs: -$23.1M")).toBe(
      "ETH ETFs: `-$23.1M`",
    );
  });

  it("wraps dollar amount without sign in monospace", () => {
    expect(formatTextWithMonospace("Volume: $500K")).toBe("Volume: `$500K`");
  });

  it("handles multiple dollar amounts", () => {
    expect(formatTextWithMonospace("In: +$100M Out: -$50M")).toBe(
      "In: `+$100M` Out: `-$50M`",
    );
  });

  it("handles text without dollar amounts", () => {
    expect(formatTextWithMonospace("No money here")).toBe("No money here");
  });

  it("escapes markdown in non-money parts", () => {
    // Non-money parts get markdown escaping, money parts get backticks
    expect(formatTextWithMonospace("Price [test]: $100")).toBe(
      "Price \\[test\\]: `$100`",
    );
  });

  it("handles empty string", () => {
    expect(formatTextWithMonospace("")).toBe("");
  });

  it("handles dollar amounts with commas", () => {
    expect(formatTextWithMonospace("Total: $1,234,567")).toBe(
      "Total: `$1,234,567`",
    );
  });

  it("handles B suffix for billions", () => {
    expect(formatTextWithMonospace("Market cap: $1.5B")).toBe(
      "Market cap: `$1.5B`",
    );
  });
});

// ============================================================================
// getSentimentEmoji
// ============================================================================

describe("getSentimentEmoji", () => {
  it("returns green circle for positive", () => {
    expect(getSentimentEmoji("positive")).toBe("🟢");
  });

  it("returns red circle for negative", () => {
    expect(getSentimentEmoji("negative")).toBe("🔴");
  });

  it("returns empty string for neutral", () => {
    expect(getSentimentEmoji("neutral")).toBe("");
  });

  it("returns empty string for undefined", () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- explicitly testing undefined handling
    expect(getSentimentEmoji(undefined)).toBe("");
  });
});

// ============================================================================
// formatTime
// ============================================================================

describe("formatTime", () => {
  it("formats morning time correctly", () => {
    // 9:30 AM UTC = 10:30 AM Europe/Berlin (winter time)
    const date = new Date("2026-01-15T09:30:00Z");
    const result = formatTime(date);
    // Should be in format like "10:30 AM"
    expect(result).toMatch(/^\d{1,2}:\d{2}\s[AP]M$/);
  });

  it("formats afternoon time correctly", () => {
    const date = new Date("2026-01-15T14:00:00Z");
    const result = formatTime(date);
    expect(result).toMatch(/^\d{1,2}:\d{2}\s[AP]M$/);
  });

  it("formats midnight correctly", () => {
    const date = new Date("2026-01-15T00:00:00Z");
    const result = formatTime(date);
    expect(result).toMatch(/^\d{1,2}:\d{2}\s[AP]M$/);
  });
});

// ============================================================================
// formatSection
// ============================================================================

describe("formatSection", () => {
  it("formats basic section with title and icon", () => {
    const section: BriefingSection = {
      title: "Test Section",
      icon: "📊",
      items: [],
    };
    const result = formatSection(section);
    expect(result).toBe("📊 *Test Section*");
  });

  it("formats section with summary", () => {
    const section: BriefingSection = {
      title: "Test Section",
      icon: "📊",
      items: [],
      summary: "This is a summary",
    };
    const result = formatSection(section);
    expect(result).toContain("_This is a summary_");
  });

  it("formats section with simple item", () => {
    const section: BriefingSection = {
      title: "Test",
      icon: "📊",
      items: [{ text: "Item one" }],
    };
    const result = formatSection(section);
    expect(result).toContain("• Item one");
  });

  it("formats item with positive sentiment", () => {
    const section: BriefingSection = {
      title: "Test",
      icon: "📊",
      items: [{ text: "Good news", sentiment: "positive" }],
    };
    const result = formatSection(section);
    expect(result).toContain("🟢");
  });

  it("formats item with negative sentiment", () => {
    const section: BriefingSection = {
      title: "Test",
      icon: "📊",
      items: [{ text: "Bad news", sentiment: "negative" }],
    };
    const result = formatSection(section);
    expect(result).toContain("🔴");
  });

  it("formats item with URL as linked title", () => {
    const section: BriefingSection = {
      title: "Test",
      icon: "📊",
      items: [{ text: "Link item", url: "https://example.com" }],
    };
    const result = formatSection(section);
    // Title should be linked instead of having an arrow link at the end
    expect(result).toContain("[Link item](https://example.com)");
  });

  it("formats ETF-style item with only value+emoji linked", () => {
    const section: BriefingSection = {
      title: "Test",
      icon: "📊",
      items: [
        {
          text: "BTC ETFs: +$145.2M",
          url: "https://farside.co.uk/btc/",
          sentiment: "positive",
        },
      ],
    };
    const result = formatSection(section);
    // Label should NOT be linked, only the value and emoji
    expect(result).toContain("BTC ETFs:");
    expect(result).toContain("[`+$145.2M` 🟢](https://farside.co.uk/btc/)");
    // Should NOT have the whole thing linked
    expect(result).not.toContain("[BTC ETFs:");
  });

  it("formats item with detail", () => {
    const section: BriefingSection = {
      title: "Test",
      icon: "📊",
      items: [{ text: "Item", detail: "Detail line" }],
    };
    const result = formatSection(section);
    expect(result).toContain("_Detail line_");
  });

  it("formats item with multi-line detail", () => {
    const section: BriefingSection = {
      title: "Test",
      icon: "📊",
      items: [{ text: "Item", detail: "Line 1\nLine 2" }],
    };
    const result = formatSection(section);
    expect(result).toContain("_Line 1_");
    expect(result).toContain("_Line 2_");
  });

  it("formats sub-items with different bullet", () => {
    const section: BriefingSection = {
      title: "Test",
      icon: "📊",
      items: [{ text: "  Sub item" }],
    };
    const result = formatSection(section);
    expect(result).toContain("◦ Sub item");
  });

  it("escapes special characters in title", () => {
    const section: BriefingSection = {
      title: "Test_Section",
      icon: "📊",
      items: [],
    };
    const result = formatSection(section);
    expect(result).toContain("Test\\_Section");
  });

  it("formats calendar item with time link", () => {
    const section: BriefingSection = {
      title: "Test",
      icon: "📊",
      items: [
        {
          text: "Event",
          time: new Date("2026-01-15T10:00:00Z"),
          calendarUrl: "https://calendar.google.com/event",
        },
      ],
    };
    const result = formatSection(section);
    expect(result).toMatch(/\[.*\]\(https:\/\/calendar\.google\.com\/event\)/);
  });
});

// ============================================================================
// formatBriefingForTelegram
// ============================================================================

describe("formatBriefingForTelegram", () => {
  const createTestBriefing = (overrides?: Partial<Briefing>): Briefing => ({
    date: new Date("2026-01-15"),
    sections: [],
    failures: [],
    generatedAt: new Date(),
    ...overrides,
  });

  it("includes header with date", () => {
    const briefing = createTestBriefing();
    const result = formatBriefingForTelegram(briefing);
    expect(result).toContain("🌅 *Morning Briefing*");
    expect(result).toContain("January");
    expect(result).toContain("15");
    expect(result).toContain("2026");
  });

  it("includes section separator before each section", () => {
    const briefing = createTestBriefing({
      sections: [
        { title: "Section 1", icon: "📊", items: [] },
        { title: "Section 2", icon: "📈", items: [] },
      ],
    });
    const result = formatBriefingForTelegram(briefing);
    // Should have separators (escaped)
    expect(result).toContain("──────────────");
  });

  it("formats failures section when present", () => {
    const briefing = createTestBriefing({
      failures: [{ source: "ETF Flows", error: "Network timeout" }],
    });
    const result = formatBriefingForTelegram(briefing);
    expect(result).toContain("⚠️ *Failed Sources*");
    expect(result).toContain("ETF Flows");
    expect(result).toContain("Network timeout");
  });

  it("does not include failures section when empty", () => {
    const briefing = createTestBriefing({ failures: [] });
    const result = formatBriefingForTelegram(briefing);
    expect(result).not.toContain("Failed Sources");
  });

  it("formats multiple failures", () => {
    const briefing = createTestBriefing({
      failures: [
        { source: "Source A", error: "Error A" },
        { source: "Source B", error: "Error B" },
      ],
    });
    const result = formatBriefingForTelegram(briefing);
    expect(result).toContain("Source A");
    expect(result).toContain("Source B");
  });

  it("escapes special characters in failure messages", () => {
    const briefing = createTestBriefing({
      failures: [{ source: "Test_Source", error: "Error [detail]" }],
    });
    const result = formatBriefingForTelegram(briefing);
    expect(result).toContain("Test\\_Source");
    expect(result).toContain("\\[detail\\]");
  });
});
