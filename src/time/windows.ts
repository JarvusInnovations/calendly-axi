import { AxiError } from "axi-sdk-js";

export interface ResolvedWindow {
  /** UTC ISO-8601 instant, inclusive lower bound. */
  from: string;
  /** UTC ISO-8601 instant, upper bound — undefined for an open-ended (upcoming) window. */
  to?: string;
  /** Year-stamped, human-readable label for the output header — echo this so a wrong window is visible. */
  label: string;
}

export interface WindowFlags {
  from?: string;
  to?: string;
  since?: string;
  until?: string;
  named?: string;
}

const NAMED_WINDOWS = ["today", "tomorrow", "week"] as const;
export type NamedWindow = (typeof NAMED_WINDOWS)[number];

export interface ResolveWindowOptions {
  /** Profile-cache timezone for date-only values and named windows — falls back to UTC. */
  timeZone?: string;
  now?: Date;
  /** Applied when no window flags are given. Omit entirely for an open-ended "upcoming" default. */
  default?: { since?: string; until?: string; named?: NamedWindow };
  /** Hard API cap in days — an over-cap resolved span fails fast naming the cap, never silently clamped. */
  capDays?: number;
}

const ACCEPTED_FORMS = [
  "--from <date|datetime> --to <date|datetime> (YYYY-MM-DD or full ISO datetime)",
  "--since <dur> (e.g. 7d, 24h, 2w)",
  "--until <dur> (e.g. 7d, 30d)",
  `named: ${NAMED_WINDOWS.join(", ")}`,
];

function validationError(message: string): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", [`Accepted forms: ${ACCEPTED_FORMS.join(" | ")}`]);
}

// Timezone arithmetic ──────────────────────────────────────────────
// No IANA tz database dependency — Node's built-in Intl carries one. These
// helpers convert between a wall-clock date/time in a named zone and the
// corresponding UTC instant, using the standard "format, diff, correct
// once" technique (handles DST transitions in practice).

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0=Sun .. 6=Sat */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Some locales render midnight as "24" under hour12: false.
    hour: Number(map.hour) === 24 ? 0 : Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday ?? "Sun"] ?? 0,
  };
}

function offsetMinutesAt(utcInstant: Date, timeZone: string): number {
  const p = zonedParts(utcInstant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - utcInstant.getTime()) / 60000;
}

/** Convert a wall-clock date/time in `timeZone` into the correct UTC instant. */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = offsetMinutesAt(naive, timeZone);
  let corrected = new Date(naive.getTime() - offset * 60000);
  // One more pass in case the first guess landed on the other side of a DST
  // boundary from the target wall-clock time.
  const offset2 = offsetMinutesAt(corrected, timeZone);
  if (offset2 !== offset) {
    corrected = new Date(naive.getTime() - offset2 * 60000);
  }
  return corrected;
}

function addCalendarDays(year: number, month: number, day: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function fmtDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateLabel(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return fmtDate(p.year, p.month, p.day);
}

// Parsing ────────────────────────────────────────────────────────────
function isDateOnly(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input);
}

function isFullDatetime(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input);
}

const DURATION_RE = /^(\d+)(h|d|w)$/;

function parseDuration(input: string): { amount: number; unit: "h" | "d" | "w" } | null {
  const m = DURATION_RE.exec(input);
  if (!m?.[1] || !m[2]) return null;
  return { amount: Number(m[1]), unit: m[2] as "h" | "d" | "w" };
}

function durationMs(dur: { amount: number; unit: "h" | "d" | "w" }): number {
  const HOUR = 60 * 60 * 1000;
  switch (dur.unit) {
    case "h":
      return dur.amount * HOUR;
    case "d":
      return dur.amount * 24 * HOUR;
    case "w":
      return dur.amount * 7 * 24 * HOUR;
  }
}

/** Parse a date-only or full-ISO-datetime string into a UTC instant. */
function parseInstant(input: string, timeZone: string, endOfDay: boolean): Date {
  if (isDateOnly(input)) {
    const [y, m, d] = input.split("-").map(Number) as [number, number, number];
    return endOfDay
      ? zonedToUtc(y, m, d, 23, 59, 59, timeZone)
      : zonedToUtc(y, m, d, 0, 0, 0, timeZone);
  }
  if (isFullDatetime(input)) {
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(input);
    const date = new Date(hasOffset ? input : `${input}Z`);
    if (Number.isNaN(date.getTime())) throw validationError(`Could not parse "${input}" as an ISO datetime`);
    return date;
  }
  throw validationError(`Could not parse "${input}"`);
}

function resolveNamed(named: string, now: Date, timeZone: string): ResolvedWindow {
  if (!(NAMED_WINDOWS as readonly string[]).includes(named)) {
    throw validationError(`Unknown named window: "${named}"`);
  }
  const p = zonedParts(now, timeZone);

  if (named === "today") {
    const from = zonedToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
    const to = zonedToUtc(p.year, p.month, p.day, 23, 59, 59, timeZone);
    return { from: from.toISOString(), to: to.toISOString(), label: `${fmtDate(p.year, p.month, p.day)} (today, ${timeZone})` };
  }

  if (named === "tomorrow") {
    const t = addCalendarDays(p.year, p.month, p.day, 1);
    const from = zonedToUtc(t.year, t.month, t.day, 0, 0, 0, timeZone);
    const to = zonedToUtc(t.year, t.month, t.day, 23, 59, 59, timeZone);
    return { from: from.toISOString(), to: to.toISOString(), label: `${fmtDate(t.year, t.month, t.day)} (tomorrow, ${timeZone})` };
  }

  // "week": current Monday–Sunday in `timeZone`.
  const offsetFromMonday = (p.weekday + 6) % 7; // Mon(1)->0 .. Sun(0)->6
  const mon = addCalendarDays(p.year, p.month, p.day, -offsetFromMonday);
  const sun = addCalendarDays(mon.year, mon.month, mon.day, 6);
  const from = zonedToUtc(mon.year, mon.month, mon.day, 0, 0, 0, timeZone);
  const to = zonedToUtc(sun.year, sun.month, sun.day, 23, 59, 59, timeZone);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: `${fmtDate(mon.year, mon.month, mon.day)} → ${fmtDate(sun.year, sun.month, sun.day)} (week, ${timeZone})`,
  };
}

function enforceCap(window: ResolvedWindow, capDays: number | undefined): void {
  if (capDays === undefined || window.to === undefined) return;
  const spanMs = new Date(window.to).getTime() - new Date(window.from).getTime();
  const capMs = capDays * 24 * 60 * 60 * 1000;
  if (spanMs > capMs) {
    throw new AxiError(
      `the Calendly API caps this window at ${capDays} days; narrow --from/--to`,
      "VALIDATION_ERROR",
      [`Pass --until <=${capDays}d, or narrow --from/--to to a ${capDays}-day span`],
    );
  }
}

/**
 * Resolve human time-window input into a UTC ISO-8601 `{ from, to, label }`
 * per `specs/behaviors/time-windows.md`. Precedence: explicit `--from`/`--to`,
 * then `--named`, then `--since`, then `--until`, then the command's default.
 * Unparseable input throws `VALIDATION_ERROR` listing the accepted forms
 * rather than silently falling back — a wrong window must be visible, not
 * silent. `capDays`, when given, fails fast on an over-cap span rather than
 * clamping it.
 */
export function resolveWindow(flags: WindowFlags, opts: ResolveWindowOptions = {}): ResolvedWindow {
  const timeZone = opts.timeZone ?? "UTC";
  const now = opts.now ?? new Date();

  let resolved: ResolvedWindow;

  if (flags.from !== undefined || flags.to !== undefined) {
    const fromDate = flags.from !== undefined ? parseInstant(flags.from, timeZone, false) : now;
    const toDate = flags.to !== undefined ? parseInstant(flags.to, timeZone, true) : undefined;
    resolved = {
      from: fromDate.toISOString(),
      to: toDate?.toISOString(),
      label: `${dateLabel(fromDate, timeZone)}${toDate ? ` → ${dateLabel(toDate, timeZone)}` : ""} (${timeZone})`,
    };
  } else if (flags.named !== undefined) {
    resolved = resolveNamed(flags.named, now, timeZone);
  } else if (flags.since !== undefined) {
    const dur = parseDuration(flags.since);
    if (!dur) throw validationError(`Could not parse --since "${flags.since}"`);
    const from = new Date(now.getTime() - durationMs(dur));
    resolved = {
      from: from.toISOString(),
      to: now.toISOString(),
      label: `${dateLabel(from, timeZone)} → ${dateLabel(now, timeZone)} (last ${flags.since}, ${timeZone})`,
    };
  } else if (flags.until !== undefined) {
    const dur = parseDuration(flags.until);
    if (!dur) throw validationError(`Could not parse --until "${flags.until}"`);
    const to = new Date(now.getTime() + durationMs(dur));
    resolved = {
      from: now.toISOString(),
      to: to.toISOString(),
      label: `${dateLabel(now, timeZone)} → ${dateLabel(to, timeZone)} (next ${flags.until}, ${timeZone})`,
    };
  } else if (opts.default?.named !== undefined) {
    resolved = resolveNamed(opts.default.named, now, timeZone);
  } else if (opts.default?.since !== undefined) {
    resolved = resolveWindow({ since: opts.default.since }, { ...opts, default: undefined });
  } else if (opts.default?.until !== undefined) {
    resolved = resolveWindow({ until: opts.default.until }, { ...opts, default: undefined });
  } else {
    // No flags, no default: open-ended "upcoming" — from now, no upper bound.
    resolved = { from: now.toISOString(), label: `from ${dateLabel(now, timeZone)} (${timeZone})` };
  }

  enforceCap(resolved, opts.capDays);
  return resolved;
}

/**
 * Parse a single required, unambiguous instant (`book --at`). Date-only
 * input is rejected — the API books exact slot start times, and a bare date
 * cannot resolve one.
 */
export function parseExactInstant(input: string, timeZone = "UTC"): string {
  if (isDateOnly(input)) {
    throw new AxiError(
      `"${input}" is a date, not an exact time — the Calendly API books exact slot start times`,
      "VALIDATION_ERROR",
      ["Run `calendly-axi types slots <type>` to pick an exact start time"],
    );
  }
  return parseInstant(input, timeZone, false).toISOString();
}

export { NAMED_WINDOWS };
