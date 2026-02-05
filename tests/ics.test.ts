/**
 * Tests for ICS calendar file generation
 */

import { describe, expect, it } from "bun:test";
import { generateIcsContent } from "../src/utils/ics";

describe("generateIcsContent", () => {
  const baseParams = {
    id: "12345",
    title: "🇺🇸 Nonfarm Payrolls",
    date: "2026-02-03T13:30:00.000Z",
    description: "Forecast: 180K | Previous: 227K",
    url: "https://www.tradingview.com/economic-calendar/?event=12345",
  };

  it("should generate valid ICS content with all fields", () => {
    const ics = generateIcsContent(baseParams);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//Morning Briefing//Economic Calendar//EN");
  });

  it("should include event title in SUMMARY", () => {
    const ics = generateIcsContent(baseParams);

    expect(ics).toContain("SUMMARY:🇺🇸 Nonfarm Payrolls");
  });

  it("should include unique UID based on event ID", () => {
    const ics = generateIcsContent(baseParams);

    expect(ics).toContain("UID:econ-12345@morning-briefing");
  });

  it("should format start and end times correctly", () => {
    const ics = generateIcsContent(baseParams);

    // Start time
    expect(ics).toContain("DTSTART:20260203T133000Z");
    // End time (30 minutes later)
    expect(ics).toContain("DTEND:20260203T140000Z");
  });

  it("should include description when provided", () => {
    const ics = generateIcsContent(baseParams);

    expect(ics).toContain("DESCRIPTION:Forecast: 180K | Previous: 227K");
  });

  it("should include URL when provided", () => {
    const ics = generateIcsContent(baseParams);

    expect(ics).toContain(
      "URL:https://www.tradingview.com/economic-calendar/?event=12345",
    );
  });

  it("should include at-time alarm (TRIGGER:PT0M)", () => {
    const ics = generateIcsContent(baseParams);

    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER:PT0M");
    expect(ics).toContain("ACTION:DISPLAY");
    expect(ics).toContain("DESCRIPTION:Data Release Now");
    expect(ics).toContain("END:VALARM");
  });

  it("should escape special characters in text fields", () => {
    const params = {
      ...baseParams,
      title: "Test; with, special\\characters",
      description: "Line 1\nLine 2",
    };

    const ics = generateIcsContent(params);

    expect(ics).toContain("SUMMARY:Test\\; with\\, special\\\\characters");
    expect(ics).toContain("DESCRIPTION:Line 1\\nLine 2");
  });

  it("should work without optional fields", () => {
    const minimalParams = {
      id: "99999",
      title: "Test Event",
      date: "2026-03-15T09:00:00.000Z",
    };

    const ics = generateIcsContent(minimalParams);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Test Event");
    // Should not have event description (alarm description is separate)
    const lines = ics.split("\r\n");
    const eventDescLine = lines.find(
      (line) =>
        line.startsWith("DESCRIPTION:") && !line.includes("Data Release Now"),
    );
    expect(eventDescLine).toBeUndefined();
    expect(ics).not.toContain("\r\nURL:");
  });

  it("should use CRLF line endings", () => {
    const ics = generateIcsContent(baseParams);

    expect(ics).toContain("\r\n");
    expect(ics.split("\r\n").length).toBeGreaterThan(1);
  });
});
