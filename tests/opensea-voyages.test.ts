/**
 * Tests for OpenSea Voyages data source parsing
 */

import { describe, expect, it } from "bun:test";
import { extractOtpCode, parseVoyages } from "../src/sources/opensea-voyages";

// ============================================================================
// extractOtpCode
// ============================================================================

describe("extractOtpCode", () => {
  it("extracts a 6-digit code", () => {
    expect(
      extractOtpCode("Your code is 721714. It expires in 10 minutes."),
    ).toBe("721714");
  });

  it("extracts a 6-digit code from HTML", () => {
    expect(extractOtpCode("<p>Code: 123456</p>")).toBe("123456");
  });

  it("falls back to 4-digit code", () => {
    expect(extractOtpCode("Your code: 9876")).toBe("9876");
  });

  it("prefers 6-digit over 4-digit", () => {
    expect(extractOtpCode("ref 1234 code 567890 end")).toBe("567890");
  });

  it("returns undefined for no digits", () => {
    expect(extractOtpCode("No code here")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractOtpCode("")).toBeUndefined();
  });

  it("ignores numbers longer than 6 digits", () => {
    // \b boundary means 1234567 won't match as a 6-digit code
    expect(extractOtpCode("Order 1234567")).toBeUndefined();
  });
});

// ============================================================================
// parseVoyages - based on real OpenSea rewards page structure
// ============================================================================

describe("parseVoyages", () => {
  it("extracts voyage entries anchored by ENDING IN", () => {
    const pageText = `
      +250
      EPIC
      TOKEN SWAP
      ENDING IN 2M
      Purchase any token on any chain ($50 USD Minimum)
      Purchase any token on any chain ($50 USD Minimum) to level up your chest!
      View Tokens
      +100
      UNCOMMON
      NFT PURCHASE
      ENDING IN 1D
      Buy NFT from a verified Art collection on any chain ($10 minimum)
      Pick up a minimum $10+ USD of any NFT from any Art verified collection
      View Collections
    `;

    const voyages = parseVoyages(pageText);

    expect(voyages).toHaveLength(2);
    expect(voyages[0]?.name).toBe(
      "Purchase any token on any chain ($50 USD Minimum)",
    );
    expect(voyages[0]?.description).toContain("EPIC");
    expect(voyages[0]?.description).toContain("TOKEN SWAP");
    expect(voyages[0]?.description).toContain("+250 XP");
    expect(voyages[0]?.description).toContain("ENDING IN 2M");

    expect(voyages[1]?.name).toBe(
      "Buy NFT from a verified Art collection on any chain ($10 minimum)",
    );
    expect(voyages[1]?.description).toContain("UNCOMMON");
    expect(voyages[1]?.description).toContain("+100 XP");
  });

  it("returns empty array for page with no ENDING IN lines", () => {
    const pageText = `
      Discover
      Collections
      The largest NFT marketplace
      Rewards
      Settings
    `;

    expect(parseVoyages(pageText)).toHaveLength(0);
  });

  it("handles empty page text", () => {
    expect(parseVoyages("")).toHaveLength(0);
  });

  it("handles single voyage", () => {
    const pageText = `
      +50
      COMMON
      TOKEN SWAP
      ENDING IN 5H
      Swap any token pair on Ethereum
    `;

    const voyages = parseVoyages(pageText);
    expect(voyages).toHaveLength(1);
    expect(voyages[0]?.name).toBe("Swap any token pair on Ethereum");
    expect(voyages[0]?.description).toContain("COMMON");
    expect(voyages[0]?.description).toContain("+50 XP");
  });

  it("skips ENDING IN lines with no following title", () => {
    const pageText = `
      ENDING IN 2M
    `;

    expect(parseVoyages(pageText)).toHaveLength(0);
  });

  it("formats description with dot-separated parts", () => {
    const pageText = `
      +250
      EPIC
      TOKEN SWAP
      ENDING IN 14M
      Purchase any token
    `;

    const voyages = parseVoyages(pageText);
    expect(voyages[0]?.description).toBe(
      "EPIC · TOKEN SWAP · +250 XP · ENDING IN 14M",
    );
  });
});
