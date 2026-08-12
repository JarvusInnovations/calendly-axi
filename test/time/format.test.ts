import { describe, expect, it } from "vitest";
import { formatInZone } from "../../src/time/format.js";

describe("formatInZone", () => {
  it("formats an ISO instant in the given zone with the zone name appended", () => {
    const out = formatInZone("2026-08-18T19:00:00Z", "America/New_York");
    expect(out).toBe("2026-08-18 15:00 (America/New_York)");
  });

  it("falls back to the raw ISO string on an unparseable input", () => {
    const out = formatInZone("not-a-date", "Not/AZone");
    expect(out).toBe("not-a-date");
  });
});
