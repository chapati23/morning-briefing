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

  const sections: Array<{ section: BriefingSection; priority: number }> = [];
  const failures: SourceFailure[] = [];

  results.forEach((result, i) => {
    const source = sources[i];
    if (!source) return;

    if (result.status === "fulfilled") {
      console.log(`[orchestrator] ✓ ${source.name} succeeded`);
      const value = result.value;
      if (Array.isArray(value)) {
        sections.push(
          ...value.map((section) => ({ section, priority: source.priority })),
        );
      } else {
        sections.push({ section: value, priority: source.priority });
      }
    } else {
      const errorMessage =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error(`[orchestrator] ✗ ${source.name} failed: ${errorMessage}`);
      failures.push({ source: source.name, error: errorMessage });
      // #region agent log
      fetch(
        "http://127.0.0.1:7243/ingest/d6ee0ffd-8589-4f61-9fea-0e32c75a8eff",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "07314d",
          },
          body: JSON.stringify({
            sessionId: "07314d",
            location: "orchestrator.ts:source failure",
            message: "source failed",
            data: { sourceName: source.name, errorMessage },
            timestamp: Date.now(),
            hypothesisId: "H5",
          }),
        },
      ).catch(() => {});
      // #endregion
    }
  });

  // Filter out sections with no items (e.g., conditional sources with nothing to report)
  const nonEmptySections = sections.filter(
    ({ section }) => section.items.length > 0,
  );
  if (failures.length > 0) {
    const failureSection: BriefingSection = {
      title: "⚠️ Source Failures",
      icon: "⚠️",
      items: failures.map((f) => ({
        text: `${f.source}: ${f.error}`,
        sentiment: "negative" as const,
      })),
    };
    nonEmptySections.push({ section: failureSection, priority: 99 });
  }

  // Sort sections by source priority (lower = higher in briefing),
  // preserving multi-section source ordering regardless of section title.
  const sortedSections = [...nonEmptySections]
    .sort((a, b) => a.priority - b.priority)
    .map(({ section }) => section);

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
