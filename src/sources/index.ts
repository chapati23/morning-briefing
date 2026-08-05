/**
 * Data Source Registry
 *
 * Add new sources here and they'll automatically be included in the briefing.
 */

import { config } from "../config";
import type { DataSource } from "../types";

import {
  economicCalendarSource,
  mockEconomicCalendarSource,
} from "./economic-calendar";
import { etfFlowsSource, mockETFFlowsSource } from "./etf-flows";
import {
  mockOvernightFuturesSource,
  overnightFuturesSource,
} from "./overnight-futures";
import {
  appStoreRankingsSource,
  mockAppStoreRankingsSource,
} from "./appstore-rankings";
import {
  congressTradesSource,
  mockCongressTradesSource,
} from "./congress-trades";
import {
  mockPolymarketMoversSource,
  mockPolymarketOddsShiftsSource,
  mockPolymarketTopMarketsSource,
  polymarketMoversSource,
  polymarketOddsShiftsSource,
  polymarketTopMarketsSource,
} from "./polymarket";

// ============================================================================
// Source Registry
// ============================================================================

// All available sources - add new ones here
const getRealSources = (): DataSource[] => [
  etfFlowsSource,
  overnightFuturesSource,
  economicCalendarSource,
  polymarketMoversSource,
  polymarketOddsShiftsSource,
  polymarketTopMarketsSource,
  appStoreRankingsSource,
  congressTradesSource,
];

const getMockSources = (): DataSource[] => [
  mockETFFlowsSource,
  mockOvernightFuturesSource,
  mockEconomicCalendarSource,
  mockPolymarketMoversSource,
  mockPolymarketOddsShiftsSource,
  mockPolymarketTopMarketsSource,
  mockAppStoreRankingsSource,
  mockCongressTradesSource,
];

const ALL_SOURCES = (): DataSource[] => {
  const cfg = config();
  return cfg.useMockData ? getMockSources() : getRealSources();
};

// ============================================================================
// Source Access
// ============================================================================

export const getAllSources = (): readonly DataSource[] => ALL_SOURCES();

export const getSourceByName = (name: string): DataSource => {
  const sources = ALL_SOURCES();
  const source = sources.find((s) => s.name === name);
  if (!source) {
    const available = sources.map((s) => s.name).join(", ");
    throw new Error(`Unknown source: ${name}. Available: ${available}`);
  }
  return source;
};

// ============================================================================
// Mock Source for Testing
// ============================================================================

export const createMockSource = (
  name: string,
  priority: number = 99,
): DataSource => ({
  name,
  priority,
  fetch: async () => ({
    title: name,
    icon: "🧪",
    items: [
      { text: "Mock item 1", detail: "This is mock data" },
      { text: "Mock item 2", sentiment: "neutral" as const },
    ],
    summary: "Mock source for testing",
  }),
});
