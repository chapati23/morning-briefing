/**
 * Data Source Registry
 *
 * Add new sources here and they'll automatically be included in the briefing.
 */

import { config } from "../config";
import type { DataSource } from "../types";

// Import sources
import { dailyDegenNewsSource, mockDailyDegenNewsSource } from "./daily-degen";
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
  mockOpenSeaVoyagesSource,
  openSeaVoyagesSource,
} from "./opensea-voyages";
import {
  appStoreRankingsSource,
  mockAppStoreRankingsSource,
} from "./appstore-rankings";
import {
  mockPolymarketMoversSource,
  mockPolymarketTopMarketsSource,
  polymarketMoversSource,
  polymarketTopMarketsSource,
} from "./polymarket";

// ============================================================================
// Source Registry
// ============================================================================

// All available sources - add new ones here
const getRealSources = (): DataSource[] => [
  dailyDegenNewsSource,
  etfFlowsSource,
  overnightFuturesSource,
  economicCalendarSource,
  polymarketMoversSource,
  polymarketTopMarketsSource,
  appStoreRankingsSource,
  openSeaVoyagesSource,
];

const getMockSources = (): DataSource[] => [
  mockDailyDegenNewsSource,
  mockETFFlowsSource,
  mockOvernightFuturesSource,
  mockEconomicCalendarSource,
  mockPolymarketMoversSource,
  mockPolymarketTopMarketsSource,
  mockAppStoreRankingsSource,
  mockOpenSeaVoyagesSource,
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
