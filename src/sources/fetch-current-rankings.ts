import type { DailyAppRanking, DailySnapshot } from "../utils";
import {
  fetchFinanceRankings,
  fetchOverallRankings,
} from "./appstore-rankings";
import { TRACKED_APPS } from "./tracked-apps";

/** Fetch current rankings for all tracked apps from both sources in parallel. */
export const fetchCurrentRankings = async (): Promise<DailySnapshot> => {
  const [overallResult, financeResult] = await Promise.allSettled([
    fetchOverallRankings(),
    fetchFinanceRankings(),
  ]);

  const overallMap =
    overallResult.status === "fulfilled" ? overallResult.value : null;
  const financeMap =
    financeResult.status === "fulfilled" ? financeResult.value : null;

  if (overallResult.status === "rejected") {
    console.warn(
      "[appstore-rankings] Overall rankings fetch failed:",
      overallResult.reason instanceof Error
        ? overallResult.reason.message
        : overallResult.reason,
    );
  }
  if (financeResult.status === "rejected") {
    console.warn(
      "[appstore-rankings] Finance rankings fetch failed:",
      financeResult.reason instanceof Error
        ? financeResult.reason.message
        : financeResult.reason,
    );
  }

  // If both failed, throw
  if (!overallMap && !financeMap) {
    throw new Error("Both ranking sources failed");
  }

  const snapshot: Record<string, DailyAppRanking> = {};
  for (const app of TRACKED_APPS) {
    snapshot[app.bundleId] = {
      overall: overallMap?.get(app.itunesId) ?? null,
      finance: financeMap?.get(app.bundleId) ?? null,
    };
  }

  return snapshot;
};
