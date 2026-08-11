import { describe, expect, it } from "vitest";
import { NAMED_WINDOWS, parseExactInstant, resolveWindow } from "../../src/time/windows.js";

// Fixed instant: 2026-08-11T18:30:00Z (a Tuesday) — August, so America/New_York
// is stably EDT (UTC-4) with no DST-transition edge cases in play.
const NOW = new Date("2026-08-11T18:30:00Z");
const NY = "America/New_York";

describe("resolveWindow — relative durations", () => {
  it("--since 7d resolves a lookback ending now", () => {
    const w = resolveWindow({ since: "7d" }, { now: NOW });
    expect(w.from).toBe(new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
    expect(w.to).toBe(NOW.toISOString());
    expect(w.label).toContain("last 7d");
  });

  it("--until 30d resolves a lookahead starting now", () => {
    const w = resolveWindow({ until: "30d" }, { now: NOW });
    expect(w.from).toBe(NOW.toISOString());
    expect(w.to).toBe(new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString());
    expect(w.label).toContain("next 30d");
  });

  it("supports h/w duration units too", () => {
    const sinceHours = resolveWindow({ since: "24h" }, { now: NOW });
    expect(sinceHours.from).toBe(new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString());

    const untilWeeks = resolveWindow({ until: "2w" }, { now: NOW });
    expect(untilWeeks.to).toBe(new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString());
  });
});

describe("resolveWindow — named windows", () => {
  it("lists exactly today/tomorrow/week", () => {
    expect(NAMED_WINDOWS).toEqual(["today", "tomorrow", "week"]);
  });

  it("'today' resolves start/end of the current day in the given timezone", () => {
    const w = resolveWindow({ named: "today" }, { now: NOW, timeZone: NY });
    // Aug 11 00:00 America/New_York (EDT, UTC-4) == 04:00Z; 23:59:59 == Aug 12 03:59:59Z.
    expect(w.from).toBe("2026-08-11T04:00:00.000Z");
    expect(w.to).toBe("2026-08-12T03:59:59.000Z");
    expect(w.label).toContain("2026-08-11");
    expect(w.label).toContain("today");
    expect(w.label).toContain(NY);
  });

  it("'tomorrow' resolves the next calendar day in the given timezone", () => {
    const w = resolveWindow({ named: "tomorrow" }, { now: NOW, timeZone: NY });
    expect(w.from).toBe("2026-08-12T04:00:00.000Z");
    expect(w.to).toBe("2026-08-13T03:59:59.000Z");
  });

  it("'week' resolves the current Monday–Sunday in the given timezone", () => {
    // NOW is Tuesday 2026-08-11 in NY — week is Mon 2026-08-10 .. Sun 2026-08-16.
    const w = resolveWindow({ named: "week" }, { now: NOW, timeZone: NY });
    expect(w.from).toBe("2026-08-10T04:00:00.000Z");
    expect(w.to).toBe("2026-08-17T03:59:59.000Z");
    expect(w.label).toContain("2026-08-10 → 2026-08-16");
  });

  it("rejects an unknown named window", () => {
    expect(() => resolveWindow({ named: "someday" }, { now: NOW })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});

describe("resolveWindow — explicit --from/--to", () => {
  it("date-only values resolve start/end of day in the profile timezone", () => {
    const w = resolveWindow({ from: "2026-08-11", to: "2026-08-12" }, { timeZone: NY });
    expect(w.from).toBe("2026-08-11T04:00:00.000Z");
    expect(w.to).toBe("2026-08-13T03:59:59.000Z");
  });

  it("falls back to UTC when no timezone is supplied", () => {
    const w = resolveWindow({ from: "2026-08-11" }, { now: NOW });
    expect(w.from).toBe("2026-08-11T00:00:00.000Z");
  });

  it("full ISO datetimes pass through as given", () => {
    const w = resolveWindow({ from: "2026-08-11T15:30:00Z", to: "2026-08-12T09:00:00Z" });
    expect(w.from).toBe("2026-08-11T15:30:00.000Z");
    expect(w.to).toBe("2026-08-12T09:00:00.000Z");
  });
});

describe("resolveWindow — no flags, no default", () => {
  it("resolves an open-ended upcoming window: from now, no upper bound", () => {
    const w = resolveWindow({}, { now: NOW });
    expect(w.from).toBe(NOW.toISOString());
    expect(w.to).toBeUndefined();
  });
});

describe("resolveWindow — command defaults", () => {
  it("applies a default named window when no flags are given", () => {
    const w = resolveWindow({}, { now: NOW, timeZone: NY, default: { named: "today" } });
    expect(w.label).toContain("today");
  });

  it("applies a default --until when no flags are given (e.g. busy's 7-day default)", () => {
    const w = resolveWindow({}, { now: NOW, default: { until: "7d" } });
    expect(w.to).toBe(new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
  });
});

describe("resolveWindow — hard caps", () => {
  it("fails fast on an over-cap span, naming the cap, without clamping", () => {
    try {
      resolveWindow({ from: "2026-01-01", to: "2026-02-15" }, { capDays: 7 });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("VALIDATION_ERROR");
      expect((err as { message: string }).message).toContain("7 days");
    }
  });

  it("allows an under-cap span through untouched", () => {
    const w = resolveWindow({ until: "5d" }, { now: NOW, capDays: 7 });
    expect(w.to).toBe(new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString());
  });

  it("ignores the cap for an open-ended window (no `to`)", () => {
    expect(() => resolveWindow({}, { now: NOW, capDays: 7 })).not.toThrow();
  });
});

describe("resolveWindow — unparseable input", () => {
  it("lists the accepted forms for junk --since input", () => {
    try {
      resolveWindow({ since: "banana" }, { now: NOW });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("VALIDATION_ERROR");
      const suggestions = (err as { suggestions: string[] }).suggestions.join(" ");
      expect(suggestions).toContain("--since");
      expect(suggestions).toContain("--until");
      expect(suggestions).toContain("today");
    }
  });

  it("lists the accepted forms for junk --from input", () => {
    expect(() => resolveWindow({ from: "not-a-date" }, { now: NOW })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});

describe("parseExactInstant", () => {
  it("rejects date-only input — the API books exact slot start times", () => {
    expect(() => parseExactInstant("2026-08-18")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("accepts a full ISO datetime and returns it normalized", () => {
    expect(parseExactInstant("2026-08-18T15:00:00Z")).toBe("2026-08-18T15:00:00.000Z");
  });
});
