/**
 * Shared test utilities and factory functions
 */

import { mock } from "bun:test";
import type {
  Briefing,
  BriefingItem,
  BriefingSection,
  DataSource,
  NotificationChannel,
} from "../src/types";

// ============================================================================
// Briefing Factories
// ============================================================================

/**
 * Create a test briefing with optional overrides.
 */
export const createTestBriefing = (
  overrides?: Partial<Briefing>,
): Briefing => ({
  date: new Date("2026-01-15"),
  sections: [],
  failures: [],
  generatedAt: new Date(),
  ...overrides,
});

/**
 * Create a test briefing section with optional overrides.
 */
export const createTestSection = (
  overrides?: Partial<BriefingSection>,
): BriefingSection => ({
  title: "Test Section",
  icon: "✅",
  items: [{ text: "Test item" }],
  ...overrides,
});

/**
 * Create a test briefing item with optional overrides.
 */
export const createTestItem = (
  overrides?: Partial<BriefingItem>,
): BriefingItem => ({
  text: "Test item",
  ...overrides,
});

// ============================================================================
// Data Source Factories
// ============================================================================

/**
 * Create a data source that successfully returns a section.
 */
export const createSuccessSource = (
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

/**
 * Create a data source that always fails with the specified error.
 */
export const createFailingSource = (
  name: string,
  error: string,
): DataSource => ({
  name,
  priority: 99,
  fetch: async () => {
    throw new Error(error);
  },
});

/**
 * Create a data source that delays for a specified time before succeeding.
 */
export const createSlowSource = (
  name: string,
  delayMs: number,
): DataSource => ({
  name,
  priority: 99,
  fetch: async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { title: name, icon: "🐢", items: [{ text: "Slow item" }] };
  },
});

/**
 * Create a data source with a mock fetch function for verification.
 */
export const createMockSource = (
  name: string,
  priority: number,
  section?: BriefingSection,
): DataSource & { fetchMock: ReturnType<typeof mock> } => {
  const fetchMock = mock(() =>
    Promise.resolve(
      section ?? {
        title: name,
        icon: "✅",
        items: [{ text: "Mock item" }],
      },
    ),
  );

  return {
    name,
    priority,
    fetch: fetchMock,
    fetchMock,
  };
};

// ============================================================================
// Notification Channel Factories
// ============================================================================

/**
 * Create a notification channel that always succeeds.
 */
export const createSuccessChannel = (
  name: string = "Test Channel",
): NotificationChannel & { sendMock: ReturnType<typeof mock> } => {
  const sendMock = mock(() => Promise.resolve());
  return {
    name,
    send: sendMock,
    sendMock,
  };
};

/**
 * Create a notification channel that always fails.
 */
export const createFailingChannel = (
  name: string,
  error: string = `${name} failed`,
): NotificationChannel => ({
  name,
  send: mock(() => Promise.reject(new Error(error))),
});

// ============================================================================
// Date Helpers
// ============================================================================

/**
 * Create a date for a specific weekday.
 * Useful for testing trading day logic.
 */
export const getWeekday = (
  year: number,
  month: number,
  weekday:
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday",
): Date => {
  const weekdayMap = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  // Start from the 1st of the month and find the first matching weekday
  const date = new Date(year, month, 1);
  const targetDay = weekdayMap[weekday];
  const currentDay = date.getDay();
  const daysToAdd = (targetDay - currentDay + 7) % 7;
  date.setDate(date.getDate() + daysToAdd);

  return date;
};

/**
 * Create a date relative to today.
 */
export const getDaysFromNow = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Check if a section contains an item with matching text.
 */
export const sectionContainsItem = (
  section: BriefingSection,
  text: string,
): boolean => {
  return section.items.some((item) => item.text.includes(text));
};

/**
 * Check if a briefing contains a section with matching title.
 */
export const briefingContainsSection = (
  briefing: Briefing,
  title: string,
): boolean => {
  return briefing.sections.some((section) => section.title.includes(title));
};

/**
 * Find a section in a briefing by title prefix.
 */
export const findSectionByTitle = (
  briefing: Briefing,
  titlePrefix: string,
): BriefingSection | undefined => {
  return briefing.sections.find((section) =>
    section.title.startsWith(titlePrefix),
  );
};
