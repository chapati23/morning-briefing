/**
 * Tests for the orchestrator module
 */

import { describe, expect, it } from "bun:test";
import { runBriefing } from "../src/orchestrator";
import type { BriefingSection, DataSource } from "../src/types";

describe("runBriefing", () => {
  const createSuccessSource = (
    name: string,
    priority: number,
    items: BriefingSection["items"] = [{ text: "Test item" }],
  ): DataSource => ({
    name,
    priority,
    fetch: async () => ({
      title: name,
      icon: "✅",
      items,
    }),
  });

  const createFailingSource = (name: string, error: string): DataSource => ({
    name,
    priority: 99,
    fetch: async () => {
      throw new Error(error);
    },
  });

  const createSlowSource = (name: string, delayMs: number): DataSource => ({
    name,
    priority: 99,
    fetch: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { title: name, icon: "🐢", items: [{ text: "Slow item" }] };
    },
  });

  it("should return sections from successful sources", async () => {
    const sources = [
      createSuccessSource("Source A", 1),
      createSuccessSource("Source B", 2),
    ];

    const briefing = await runBriefing(sources, new Date());

    expect(briefing.sections).toHaveLength(2);
    expect(briefing.failures).toHaveLength(0);
  });

  it("should handle partial failures gracefully", async () => {
    const sources = [
      createSuccessSource("Success", 1),
      createFailingSource("Failure", "Network error"),
    ];

    const briefing = await runBriefing(sources, new Date());

    expect(briefing.sections).toHaveLength(1);
    expect(briefing.failures).toHaveLength(1);
    expect(briefing.failures[0]?.source).toBe("Failure");
    expect(briefing.failures[0]?.error).toBe("Network error");
  });

  it("should handle all sources failing", async () => {
    const sources = [
      createFailingSource("Fail A", "Error A"),
      createFailingSource("Fail B", "Error B"),
    ];

    const briefing = await runBriefing(sources, new Date());

    expect(briefing.sections).toHaveLength(0);
    expect(briefing.failures).toHaveLength(2);
  });

  it("should timeout slow sources", async () => {
    const sources = [
      createSuccessSource("Fast", 1),
      createSlowSource("Slow", 5000), // 5 seconds
    ];

    // Use 100ms timeout
    const briefing = await runBriefing(sources, new Date(), 100);

    expect(briefing.sections).toHaveLength(1);
    expect(briefing.failures).toHaveLength(1);
    expect(briefing.failures[0]?.error).toContain("timed out");
  });

  it("should include date and generatedAt in briefing", async () => {
    const testDate = new Date("2026-01-15");
    const sources = [createSuccessSource("Test", 1)];

    const briefing = await runBriefing(sources, testDate);

    expect(briefing.date).toEqual(testDate);
    expect(briefing.generatedAt).toBeInstanceOf(Date);
    expect(briefing.generatedAt.getTime()).toBeGreaterThan(testDate.getTime());
  });

  it("should handle empty sources array", async () => {
    const briefing = await runBriefing([], new Date());

    expect(briefing.sections).toHaveLength(0);
    expect(briefing.failures).toHaveLength(0);
  });
});
