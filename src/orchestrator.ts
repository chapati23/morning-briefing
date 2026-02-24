/**
 * Orchestrator - coordinates data source fetching with fail-tolerance
 */

import type {
  Briefing,
  BriefingSection,
  DataSource,
  NotificationChannel,
  SourceFailure,
} from "./types";

// ============================================================================
// Core Orchestration
// ============================================================================

const DEFAULT_TIMEOUT_MS = 45_000;

const fetchWithTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  sourceName: string,
): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => {
        reject(new Error(`${sourceName} timed out after ${timeoutMs}ms`));
      }, timeoutMs),
    ),
  ]);

export const runBriefing = async (
  sources: readonly DataSource[],
  date: Date,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Briefing> => {
  console.log(`[orchestrator] Running briefing for ${date.toDateString()}`);
  console.log(
    `[orchestrator] Sources: ${sources.map((s) => s.name).join(", ")}`,
  );

  const results = await Promise.allSettled(
    sources.map((source) =>
      fetchWithTimeout(
        source.fetch(date),
        source.timeoutMs ?? timeoutMs,
        source.name,
      ),
    ),
  );

  const sections: BriefingSection[] = [];
  const failures: SourceFailure[] = [];

  results.forEach((result, i) => {
    const source = sources[i];
    if (!source) return;

    if (result.status === "fulfilled") {
      console.log(`[orchestrator] ✓ ${source.name} succeeded`);
      const value = result.value;
      if (Array.isArray(value)) {
        sections.push(...value);
      } else {
        sections.push(value);
      }
    } else {
      const errorMessage =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error(`[orchestrator] ✗ ${source.name} failed: ${errorMessage}`);
      failures.push({ source: source.name, error: errorMessage });
    }
  });

  // Filter out sections with no items (e.g., conditional sources with nothing to report)
  const nonEmptySections = sections.filter((s) => s.items.length > 0);
  if (failures.length > 0) {
    const failureSection: BriefingSection = {
      title: "⚠️ Source Failures",
      icon: "⚠️",
      items: failures.map((f) => ({
        text: `${f.source}: ${f.error}`,
        sentiment: "negative" as const,
      })),
    };
    nonEmptySections.push(failureSection);
  }

  // Sort sections by priority (lower = higher in briefing)
  // Use startsWith to match titles that include additional info (e.g., "ETF Flows from Fri, Jan 30")
  const sortedSections = [...nonEmptySections].sort((a, b) => {
    const priorityA =
      sources.find((s) => a.title.startsWith(s.name))?.priority ?? 99;
    const priorityB =
      sources.find((s) => b.title.startsWith(s.name))?.priority ?? 99;
    return priorityA - priorityB;
  });

  return {
    date,
    sections: sortedSections,
    failures,
    generatedAt: new Date(),
  };
};

// ============================================================================
// Notification Delivery
// ============================================================================

export const sendBriefing = async (
  briefing: Briefing,
  channels: readonly NotificationChannel[],
): Promise<void> => {
  console.log(
    `[orchestrator] Sending briefing via ${channels.length} channel(s)`,
  );

  const results = await Promise.allSettled(
    channels.map((channel) => channel.send(briefing)),
  );

  results.forEach((result, i) => {
    const channel = channels[i];
    if (!channel) return;

    if (result.status === "fulfilled") {
      console.log(`[orchestrator] ✓ Sent via ${channel.name}`);
    } else {
      const errorMessage =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error(
        `[orchestrator] ✗ Failed to send via ${channel.name}: ${errorMessage}`,
      );
    }
  });
};

// ============================================================================
// Full Pipeline
// ============================================================================

export const runFullBriefing = async (
  sources: readonly DataSource[],
  channels: readonly NotificationChannel[],
  date: Date = new Date(),
): Promise<Briefing> => {
  const briefing = await runBriefing(sources, date);

  if (channels.length > 0) {
    await sendBriefing(briefing, channels);
  }

  return briefing;
};
