/**
 * Format an ISO instant as a compact profile-timezone string
 * (`2026-08-18 15:00 (America/New_York)`) for display in list rows and
 * detail views — see the "times in profile timezone alongside ISO" rule in
 * `specs/commands/events.md`. Falls back to the raw ISO string if the zone
 * or instant can't be formatted (never throws — this is a display helper).
 *
 * Ported out of `commands/home.ts`'s original local helper so `events` and
 * `busy` can share it too.
 */
export function formatInZone(iso: string, timeZone: string): string {
  try {
    const date = new Date(iso);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${timeZone})`;
  } catch {
    return iso;
  }
}
