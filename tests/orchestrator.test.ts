/**
 * Tests for the orchestrator module
 */

import { describe, expect, it, mock } from "bun:test";
import {
  runBriefing,
  runFullBriefing,
  sendBriefing,
} from "../src/orchestrator";
import type {
  Briefing,
  BriefingSection,
  DataSource,
  NotificationChannel,
} from "../src/types";

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

  it("should sort sections by priority", async () => {
    // Create sources with specific priorities (out of order)
    const sources = [
      createSuccessSource("Low Priority", 10),
      createSuccessSource("High Priority", 1),
      createSuccessSource("Medium Priority", 5),
    ];

    const briefing = await runBriefing(sources, new Date());

    expect(briefing.sections).toHaveLength(3);
    expect(briefing.sections[0]?.title).toBe("High Priority");
    expect(briefing.sections[1]?.title).toBe("Medium Priority");
    expect(briefing.sections[2]?.title).toBe("Low Priority");
  });

  it("should exclude sections with empty items array", async () => {
    const sources = [
      createSuccessSource("Has Items", 1, [{ text: "Real data" }]),
      createSuccessSource("Empty Source", 2, []),
    ];

    const briefing = await runBriefing(sources, new Date());

    expect(briefing.sections).toHaveLength(1);
    expect(briefing.sections[0]?.title).toBe("Has Items");
  });

  it("should not count empty sections as failures", async () => {
    const sources = [createSuccessSource("Empty Source", 1, [])];

    const briefing = await runBriefing(sources, new Date());

    expect(briefing.sections).toHaveLength(0);
    expect(briefing.failures).toHaveLength(0);
  });

  it("should include non-empty sections when mixed with empty ones", async () => {
    const sources = [
      createSuccessSource("Empty A", 1, []),
      createSuccessSource("Has Data", 2, [{ text: "Data" }]),
      createSuccessSource("Empty B", 3, []),
      createSuccessSource("Also Has Data", 4, [{ text: "More data" }]),
    ];

    const briefing = await runBriefing(sources, new Date());

    expect(briefing.sections).toHaveLength(2);
    expect(briefing.sections[0]?.title).toBe("Has Data");
    expect(briefing.sections[1]?.title).toBe("Also Has Data");
    expect(briefing.failures).toHaveLength(0);
  });
});

// ============================================================================
// sendBriefing
// ============================================================================

describe("sendBriefing", () => {
  const createTestBriefing = (): Briefing => ({
    date: new Date("2026-01-15"),
    sections: [
      { title: "Test Section", icon: "📊", items: [{ text: "Test item" }] },
    ],
    failures: [],
    generatedAt: new Date(),
  });

  type ChannelWithMock = {
    channel: NotificationChannel;
    sendMock: ReturnType<typeof mock>;
  };

  const createSuccessChannel = (name: string): ChannelWithMock => {
    const sendMock = mock(() => Promise.resolve());
    return { channel: { name, send: sendMock }, sendMock };
  };

  const createFailingChannel = (name: string): ChannelWithMock => {
    const sendMock = mock(() => Promise.reject(new Error(`${name} failed`)));
    return { channel: { name, send: sendMock }, sendMock };
  };

  it("should send to all channels", async () => {
    const briefing = createTestBriefing();
    const { channel: channel1, sendMock: send1 } =
      createSuccessChannel("Channel 1");
    const { channel: channel2, sendMock: send2 } =
      createSuccessChannel("Channel 2");

    await sendBriefing(briefing, [channel1, channel2]);

    expect(send1).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledTimes(1);
  });

  it("should continue when one channel fails", async () => {
    const briefing = createTestBriefing();
    const { channel: successChannel, sendMock: successSend } =
      createSuccessChannel("Success");
    const { channel: failingChannel, sendMock: failingSend } =
      createFailingChannel("Failing");

    // Should not throw even though one channel fails
    await sendBriefing(briefing, [failingChannel, successChannel]);

    expect(failingSend).toHaveBeenCalledTimes(1);
    expect(successSend).toHaveBeenCalledTimes(1);
  });

  it("should handle empty channels array", async () => {
    const briefing = createTestBriefing();

    // Should not throw
    await sendBriefing(briefing, []);
  });

  it("should handle all channels failing", async () => {
    const briefing = createTestBriefing();
    const { channel: channel1, sendMock: send1 } =
      createFailingChannel("Fail 1");
    const { channel: channel2, sendMock: send2 } =
      createFailingChannel("Fail 2");

    // Should not throw even when all channels fail
    await sendBriefing(briefing, [channel1, channel2]);

    expect(send1).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// runFullBriefing
// ============================================================================

describe("runFullBriefing", () => {
  const createSuccessSource = (name: string, priority: number): DataSource => ({
    name,
    priority,
    fetch: async () => ({
      title: name,
      icon: "✅",
      items: [{ text: "Test item" }],
    }),
  });

  type ChannelWithMock = {
    channel: NotificationChannel;
    sendMock: ReturnType<typeof mock>;
  };

  const createSuccessChannel = (): ChannelWithMock => {
    const sendMock = mock(() => Promise.resolve());
    return { channel: { name: "Test Channel", send: sendMock }, sendMock };
  };

  it("should run sources and send to channels", async () => {
    const sources = [createSuccessSource("Source", 1)];
    const { channel, sendMock } = createSuccessChannel();

    const briefing = await runFullBriefing(sources, [channel]);

    expect(briefing.sections).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("should skip channel sending when no channels provided", async () => {
    const sources = [createSuccessSource("Source", 1)];

    const briefing = await runFullBriefing(sources, []);

    expect(briefing.sections).toHaveLength(1);
    // No channels to verify - just ensure it doesn't throw
  });

  it("should use current date by default", async () => {
    const sources = [createSuccessSource("Source", 1)];
    const before = new Date();

    const briefing = await runFullBriefing(sources, []);

    const after = new Date();
    expect(briefing.date.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(briefing.date.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should use provided date", async () => {
    const sources = [createSuccessSource("Source", 1)];
    const customDate = new Date("2026-06-15");

    const briefing = await runFullBriefing(sources, [], customDate);

    expect(briefing.date).toEqual(customDate);
  });

  it("should return briefing with failures when sources fail", async () => {
    const sources: DataSource[] = [
      {
        name: "Failing Source",
        priority: 1,
        fetch: async () => {
          throw new Error("Source error");
        },
      },
    ];
    const { channel, sendMock } = createSuccessChannel();

    const briefing = await runFullBriefing(sources, [channel]);

    expect(briefing.sections).toHaveLength(0);
    expect(briefing.failures).toHaveLength(1);
    // Channel should still be called with the (partially failed) briefing
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
