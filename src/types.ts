/**
 * Core type definitions for the Morning Briefing system
 */

// ============================================================================
// Data Source Types
// ============================================================================

export interface DataSource {
  readonly name: string;
  readonly priority: number; // Lower = higher in briefing
  fetch(date: Date): Promise<BriefingSection>;
}

export interface BriefingSection {
  readonly title: string;
  readonly icon: string;
  readonly items: readonly BriefingItem[];
  readonly summary?: string;
}

export interface BriefingItem {
  readonly text: string;
  readonly detail?: string;
  readonly time?: Date;
  readonly url?: string;
  readonly calendarUrl?: string; // GCS URL for calendar ICS download
  readonly sentiment?: Sentiment;
}

export type Sentiment = "positive" | "negative" | "neutral";

// ============================================================================
// Briefing Output Types
// ============================================================================

export interface Briefing {
  readonly date: Date;
  readonly sections: readonly BriefingSection[];
  readonly failures: readonly SourceFailure[];
  readonly generatedAt: Date;
}

export interface SourceFailure {
  readonly source: string;
  readonly error: string;
}

// ============================================================================
// Notification Channel Types
// ============================================================================

export interface NotificationChannel {
  readonly name: string;
  send(briefing: Briefing): Promise<void>;
}

// ============================================================================
// Config Types
// ============================================================================

export interface AppConfig {
  readonly timezone: string;
  readonly useMockData: boolean;
  readonly logLevel: LogLevel;
  readonly port: number;
  readonly telegram: TelegramConfig;
}

export interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

// ============================================================================
// Market Data Types
// ============================================================================

export interface ETFFlow {
  readonly ticker: string;
  readonly name: string;
  readonly flow: number; // Positive = inflow, negative = outflow
  readonly date: Date;
}
