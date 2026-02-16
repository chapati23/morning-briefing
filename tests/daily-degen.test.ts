/**
 * Tests for the Daily Degen news source
 */

import { describe, expect, it } from "bun:test";
import {
  extractAttribution,
  formatSectionTitle,
  getOrdinalSuffix,
  parseNewsSection,
  shouldSkipItem,
  stripAttribution,
} from "../src/sources/daily-degen";

// ============================================================================
// Sample HTML Fixtures
// ============================================================================

/** Realistic HTML matching the actual Substack structure */
const buildSectionHtml = (items: string): string => `
<h3><strong>Important News And Analysis</strong></h3>
${items}
<h3><strong>Conclusion</strong></h3>
<p>Have a great day!</p>
`;

const buildNewsItem = (text: string, tweetUrl?: string): string => {
  const imageContainer = tweetUrl
    ? `<div class="captioned-image-container"><figure><a class="image-link image2 is-viewable-img" target="_blank" href="${tweetUrl}" data-component-name="Image2ToDOM"><div class="image2-inset"><picture><img src="https://example.com/screenshot.png" /></picture></div></a></figure></div>`
    : `<div class="captioned-image-container"><figure><a class="image-link image2 is-viewable-img" target="_blank" href="https://example.com/image.png"><div class="image2-inset"><picture><img src="https://example.com/screenshot.png" /></picture></div></a></figure></div>`;

  return `<p>-${text}</p>\n${imageContainer}`;
};

const buildYouTubeItem = (text: string): string => `
<p>-${text}</p>
<div class="youtube-inner"><iframe src="https://www.youtube.com/embed/abc123"></iframe></div>
`;

const SAMPLE_HTML = buildSectionHtml(
  [
    buildNewsItem(
      "Total crypto market cap still 45% below ATH's, h/t @DaanCrypto:",
      "https://x.com/DaanCrypto/status/123456",
    ),
    buildNewsItem(
      "New Aave proposal sparks debate, via @0xLouisT and @Marczeller:",
      "https://x.com/0xLouisT/status/789012",
    ),
    buildNewsItem(
      "Figure disclosed significant data breach, h/t @CoinBureau:",
      "https://x.com/coinbureau/status/345678",
    ),
    buildYouTubeItem("New video on altcoins from @coinbureau:"),
    buildNewsItem(
      "Don't forget to chase your dreams good frogs! Parting wisdom from @crypto_linn:",
      "https://x.com/crypto_linn/status/999999",
    ),
  ].join("\n"),
);

// ============================================================================
// parseNewsSection
// ============================================================================

describe("parseNewsSection", () => {
  it("extracts news items with text and tweet URLs", () => {
    const items = parseNewsSection(SAMPLE_HTML);

    expect(items.length).toBe(3);
    expect(items[0]?.tweetUrl).toBe("https://x.com/DaanCrypto/status/123456");
    expect(items[1]?.tweetUrl).toBe("https://x.com/0xLouisT/status/789012");
    expect(items[2]?.tweetUrl).toBe("https://x.com/coinbureau/status/345678");
  });

  it("filters out video/podcast/motivational items", () => {
    const items = parseNewsSection(SAMPLE_HTML);
    const texts = items.map((i) => i.text);

    expect(texts.every((t) => !t.includes("video"))).toBe(true);
    expect(texts.every((t) => !t.includes("chase your dreams"))).toBe(true);
  });

  it("extracts attribution into a separate field", () => {
    const items = parseNewsSection(SAMPLE_HTML);

    expect(items[0]?.attribution).toBe("h/t @DaanCrypto");
    expect(items[1]?.attribution).toBe("via @0xLouisT and @Marczeller");
    expect(items[2]?.attribution).toBe("h/t @CoinBureau");
  });

  it("strips attribution from the display text", () => {
    const items = parseNewsSection(SAMPLE_HTML);

    expect(items[0]?.text).toBe(
      "Total crypto market cap still 45% below ATH's",
    );
    expect(items[1]?.text).toBe("New Aave proposal sparks debate");
    expect(items[2]?.text).toBe("Figure disclosed significant data breach");
  });

  it("returns empty array when section heading is missing", () => {
    const html = "<h3>Some Other Section</h3><p>-Some item</p>";
    const items = parseNewsSection(html);
    expect(items).toEqual([]);
  });

  it("returns empty array for empty HTML", () => {
    const items = parseNewsSection("");
    expect(items).toEqual([]);
  });

  it("handles items without a tweet URL gracefully", () => {
    const html = buildSectionHtml(
      buildNewsItem("Some news without a tweet link"),
    );
    const items = parseNewsSection(html);

    expect(items.length).toBe(1);
    expect(items[0]?.text).toBe("Some news without a tweet link");
    expect(items[0]?.tweetUrl).toBeUndefined();
  });

  it("handles items with twitter.com URLs", () => {
    const html = buildSectionHtml(
      buildNewsItem(
        "Old-style twitter link, h/t @someone:",
        "https://twitter.com/someone/status/111",
      ),
    );
    const items = parseNewsSection(html);

    expect(items[0]?.tweetUrl).toBe("https://twitter.com/someone/status/111");
  });

  it("ignores non-twitter image links", () => {
    const html = buildSectionHtml(
      `<p>-Some news item:</p>
       <div class="captioned-image-container"><figure><a class="image-link image2" href="https://example.com/chart.png"><img src="https://example.com/chart.png" /></a></figure></div>`,
    );
    const items = parseNewsSection(html);

    expect(items.length).toBe(1);
    expect(items[0]?.tweetUrl).toBeUndefined();
  });
});

// ============================================================================
// shouldSkipItem
// ============================================================================

describe("shouldSkipItem", () => {
  it("skips interview items", () => {
    expect(shouldSkipItem("New @pahueg interview with @OnChainMind:")).toBe(
      true,
    );
    expect(shouldSkipItem("New interview with macro gigabrain Doomberg:")).toBe(
      true,
    );
  });

  it("skips video items", () => {
    expect(shouldSkipItem("New video on altcoins from @coinbureau:")).toBe(
      true,
    );
    expect(
      shouldSkipItem(
        "Another new @coinbureau video, on the Bitcoin mining sector:",
      ),
    ).toBe(true);
  });

  it("skips roundtable items", () => {
    expect(
      shouldSkipItem("New roundtable from @0xResearch (aired yesterday):"),
    ).toBe(true);
  });

  it("skips Pomp items (video host)", () => {
    expect(
      shouldSkipItem(
        "New Pomp x Jordi Visser video on crypto and macro and AI:",
      ),
    ).toBe(true);
  });

  it("skips 'Video just published' items", () => {
    expect(
      shouldSkipItem(
        "Video just published of Stani's recent appearance on @therollupco:",
      ),
    ).toBe(true);
  });

  it("skips guide items", () => {
    expect(shouldSkipItem("New OpenClaw guide from Alex Finn:")).toBe(true);
  });

  it("skips weekly overview items", () => {
    expect(shouldSkipItem("Weekly macro overview from Joseph Wang:")).toBe(
      true,
    );
  });

  it("skips motivational items", () => {
    expect(
      shouldSkipItem(
        "Don't forget to chase your dreams good frogs! Parting wisdom from @crypto_linn:",
      ),
    ).toBe(true);
  });

  it("keeps actual news items", () => {
    expect(
      shouldSkipItem(
        "Total crypto market cap still 45% below ATH's from last October",
      ),
    ).toBe(false);
    expect(
      shouldSkipItem(
        "New Aave proposal continues to elicit contentious debate",
      ),
    ).toBe(false);
    expect(shouldSkipItem("Figure disclosed significant data breach")).toBe(
      false,
    );
    expect(
      shouldSkipItem("Gold and silver are back up after falling a bit"),
    ).toBe(false);
  });
});

// ============================================================================
// extractAttribution
// ============================================================================

describe("extractAttribution", () => {
  it("extracts 'h/t @handle' pattern", () => {
    expect(extractAttribution("Some news, h/t @DaanCrypto:")).toBe(
      "h/t @DaanCrypto",
    );
  });

  it("extracts 'h/t [phrase] from @handle' pattern", () => {
    expect(
      extractAttribution(
        "Some news, h/t good recap of last two weeks from @thedefivillain:",
      ),
    ).toBe("h/t good recap of last two weeks from @thedefivillain");
  });

  it("extracts 'h/t this and additional news headlines from @handle'", () => {
    expect(
      extractAttribution(
        "Tomasz stepping down, h/t this and additional news headlines from @0xSalazar:",
      ),
    ).toBe("h/t this and additional news headlines from @0xSalazar");
  });

  it("extracts 'via @handle' pattern", () => {
    expect(
      extractAttribution("Aave debate, via @0xLouisT and @Marczeller:"),
    ).toBe("via @0xLouisT and @Marczeller");
  });

  it("returns undefined when no attribution found", () => {
    expect(
      extractAttribution("Just a news item with no source"),
    ).toBeUndefined();
  });
});

// ============================================================================
// stripAttribution
// ============================================================================

describe("stripAttribution", () => {
  it("strips 'h/t @handle:' from text", () => {
    expect(stripAttribution("Some news, h/t @DaanCrypto:")).toBe("Some news");
  });

  it("strips 'via @handle:' from text", () => {
    expect(
      stripAttribution("Aave debate, via @0xLouisT and @Marczeller:"),
    ).toBe("Aave debate");
  });

  it("strips complex h/t patterns", () => {
    expect(
      stripAttribution("Some news, h/t good recap from @thedefivillain:"),
    ).toBe("Some news");
  });

  it("returns text unchanged when no attribution", () => {
    expect(stripAttribution("Just some news")).toBe("Just some news");
  });

  it("handles trailing colon without attribution", () => {
    expect(stripAttribution("News item:")).toBe("News item");
  });
});

// ============================================================================
// formatSectionTitle
// ============================================================================

describe("formatSectionTitle", () => {
  it("formats date with month abbreviation and ordinal day", () => {
    const date = new Date("2026-02-14T17:33:00Z");
    expect(formatSectionTitle(date)).toBe("Crypto News, Feb 14th");
  });

  it("uses ordinal suffixes correctly", () => {
    expect(formatSectionTitle(new Date("2026-01-01T00:00:00Z"))).toBe(
      "Crypto News, Jan 1st",
    );
    expect(formatSectionTitle(new Date("2026-03-02T00:00:00Z"))).toBe(
      "Crypto News, Mar 2nd",
    );
    expect(formatSectionTitle(new Date("2026-04-03T00:00:00Z"))).toBe(
      "Crypto News, Apr 3rd",
    );
    expect(formatSectionTitle(new Date("2026-05-04T00:00:00Z"))).toBe(
      "Crypto News, May 4th",
    );
  });

  it("handles 11th, 12th, 13th (special teen cases)", () => {
    expect(formatSectionTitle(new Date("2026-06-11T00:00:00Z"))).toBe(
      "Crypto News, Jun 11th",
    );
    expect(formatSectionTitle(new Date("2026-06-12T00:00:00Z"))).toBe(
      "Crypto News, Jun 12th",
    );
    expect(formatSectionTitle(new Date("2026-06-13T00:00:00Z"))).toBe(
      "Crypto News, Jun 13th",
    );
  });

  it("handles 21st, 22nd, 23rd", () => {
    expect(formatSectionTitle(new Date("2026-07-21T00:00:00Z"))).toBe(
      "Crypto News, Jul 21st",
    );
    expect(formatSectionTitle(new Date("2026-07-22T00:00:00Z"))).toBe(
      "Crypto News, Jul 22nd",
    );
    expect(formatSectionTitle(new Date("2026-07-23T00:00:00Z"))).toBe(
      "Crypto News, Jul 23rd",
    );
  });

  it("handles 31st", () => {
    expect(formatSectionTitle(new Date("2026-08-31T00:00:00Z"))).toBe(
      "Crypto News, Aug 31st",
    );
  });
});

// ============================================================================
// getOrdinalSuffix
// ============================================================================

describe("getOrdinalSuffix", () => {
  it("returns 'st' for 1, 21, 31", () => {
    expect(getOrdinalSuffix(1)).toBe("st");
    expect(getOrdinalSuffix(21)).toBe("st");
    expect(getOrdinalSuffix(31)).toBe("st");
  });

  it("returns 'nd' for 2, 22", () => {
    expect(getOrdinalSuffix(2)).toBe("nd");
    expect(getOrdinalSuffix(22)).toBe("nd");
  });

  it("returns 'rd' for 3, 23", () => {
    expect(getOrdinalSuffix(3)).toBe("rd");
    expect(getOrdinalSuffix(23)).toBe("rd");
  });

  it("returns 'th' for teen numbers (11, 12, 13)", () => {
    expect(getOrdinalSuffix(11)).toBe("th");
    expect(getOrdinalSuffix(12)).toBe("th");
    expect(getOrdinalSuffix(13)).toBe("th");
  });

  it("returns 'th' for regular numbers", () => {
    expect(getOrdinalSuffix(4)).toBe("th");
    expect(getOrdinalSuffix(5)).toBe("th");
    expect(getOrdinalSuffix(10)).toBe("th");
    expect(getOrdinalSuffix(14)).toBe("th");
    expect(getOrdinalSuffix(20)).toBe("th");
    expect(getOrdinalSuffix(30)).toBe("th");
  });
});
