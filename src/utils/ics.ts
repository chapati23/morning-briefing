/**
 * ICS Calendar File Generation
 *
 * Generates .ics files for economic calendar events that can be
 * imported into Apple Calendar, Google Calendar, or any calendar app.
 */

// ============================================================================
// Types
// ============================================================================

export interface IcsEventParams {
  readonly id: string;
  readonly title: string;
  readonly date: string; // ISO 8601 format
  readonly description?: string;
  readonly url?: string;
}

// ============================================================================
// ICS Generation
// ============================================================================

/**
 * Generate ICS file content from event parameters.
 *
 * Creates a calendar event with:
 * - 30-minute duration
 * - At-time alert (TRIGGER:PT0M)
 * - Properly escaped text fields
 */
export const generateIcsContent = (params: IcsEventParams): string => {
  const { id, title, date, description, url } = params;

  const startDate = new Date(date);
  const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // +30 minutes

  const dtStart = formatIcsDate(startDate);
  const dtEnd = formatIcsDate(endDate);
  const dtstamp = formatIcsDate(new Date());
  const uid = `econ-${id}@morning-briefing`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Morning Briefing//Economic Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(title)}`,
  ];

  if (description) {
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  }

  if (url) {
    lines.push(`URL:${url}`);
  }

  // At-time alert - fires when event starts
  lines.push(
    "BEGIN:VALARM",
    "TRIGGER:PT0M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Data Release Now",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );

  return lines.join("\r\n");
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a Date as ICS datetime (YYYYMMDDTHHMMSSZ)
 */
const formatIcsDate = (date: Date): string => {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
};

/**
 * Escape special characters in ICS text fields.
 *
 * ICS requires:
 * - Backslash escaped as \\
 * - Semicolon escaped as \;
 * - Comma escaped as \,
 * - Newlines as \n
 */
const escapeIcsText = (text: string): string => {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
};
