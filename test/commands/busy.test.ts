import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { busyCommand } from "../../src/commands/busy.js";
import { writeConfig } from "../../src/config.js";

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status });
}

function seedCache() {
  writeConfig({
    version: 1,
    token: "tok",
    profile_cache: {
      user_uri: "https://api.calendly.com/users/ABC123",
      user_uuid: "ABC123",
      name: "Chris Alfano",
      email: "chris@jarv.us",
      scheduling_url: "https://calendly.com/chris",
      timezone: "America/New_York",
      organization_uri: "https://api.calendly.com/organizations/ORG789",
      organization_uuid: "ORG789",
      cached_at: new Date().toISOString(),
    },
  });
}

function queryOf(url: unknown): URLSearchParams {
  return new URL(String(url)).searchParams;
}

beforeEach(() => {
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1";
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
});

describe("busy: defaults", () => {
  it("defaults to next 7 days, self scope, and reports complete: true", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [
          {
            type: "calendly",
            start_time: "2026-08-12T15:00:00Z",
            end_time: "2026-08-12T15:30:00Z",
            event: "https://api.calendly.com/scheduled_events/EVT1",
          },
        ],
      }),
    );
    // second call: the calendly-row name enrichment lookup
    spy.mockResolvedValueOnce(jsonResponse({ resource: { name: "Intro Call" } }));

    const out = await busyCommand([]);

    const [url] = spy.mock.calls[0]!;
    const q = queryOf(url);
    expect(q.get("user")).toBe("https://api.calendly.com/users/ABC123");
    expect(q.get("start_time")).toBeTruthy();
    expect(q.get("end_time")).toBeTruthy();

    expect(out).toContain("for: Chris Alfano");
    expect(out).toContain("complete: true");
    expect(out).toContain("busy[1]{start,end,type,name}:");
    expect(out).toContain("calendly");
    expect(out).toContain("Intro Call");
    expect(out).toContain("types slots <type>");
  });

  it("shows a definitive empty state naming who and the window", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ collection: [] }));
    const out = await busyCommand([]);
    expect(out).toMatch(/busy: "no busy intervals for Chris Alfano in /);
  });
});

describe("busy: rows", () => {
  it("renders both calendly and external rows, sorted by start", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [
          { type: "external", start_time: "2026-08-13T15:00:00Z", end_time: "2026-08-13T16:00:00Z" },
          {
            type: "calendly",
            start_time: "2026-08-12T15:00:00Z",
            end_time: "2026-08-12T15:30:00Z",
            event: "https://api.calendly.com/scheduled_events/EVT1",
          },
        ],
      }),
    );
    // name lookup for the one calendly row
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ resource: { name: "Intro Call" } }));

    const out = await busyCommand([]);
    expect(out).toContain("busy[2]{start,end,type,name}:");
    // external row present → no connected-calendar caveat
    expect(out).not.toContain("no external-calendar rows");
    const calendlyIdx = out.indexOf("Intro Call");
    const externalIdx = out.indexOf("external");
    expect(calendlyIdx).toBeGreaterThan(-1);
    expect(externalIdx).toBeGreaterThan(-1);
  });

  it("adds the connected-calendar caveat when no external rows appear", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ collection: [] }));
    const out = await busyCommand([]);
    expect(out).toContain("no external-calendar rows appeared");
  });

  it("degrades gracefully when the per-row name lookup fails", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          collection: [
            {
              type: "calendly",
              start_time: "2026-08-12T15:00:00Z",
              end_time: "2026-08-12T15:30:00Z",
              event: "https://api.calendly.com/scheduled_events/EVT1",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 404 }));

    const out = await busyCommand([]);
    expect(out).toContain("busy[1]{start,end,type,name}:");
  });
});

describe("busy: window cap", () => {
  it("--until 10d fails fast naming the 7-day cap, no request made", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    const err = await busyCommand(["--until", "10d"]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("7 days");
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts exactly a 7-day window", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ collection: [] }));
    await expect(busyCommand(["--until", "7d"])).resolves.toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("busy: --user", () => {
  it("widens to another user without duplicating the self bootstrap", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ collection: [] }));
    const out = await busyCommand(["--user", "OTHERUUID"]);
    expect(spy).toHaveBeenCalledTimes(1); // only the user_busy_times call — cached self, uuid needs no lookup
    const [url] = spy.mock.calls[0]!;
    expect(queryOf(url).get("user")).toBe("https://api.calendly.com/users/OTHERUUID");
    expect(out).toContain("for: OTHERUUID");
  });
});

describe("busy: flags", () => {
  it("rejects an unknown flag without making a request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(busyCommand(["--nope"])).rejects.toMatchObject({ code: "UNKNOWN_FLAG" });
    expect(spy).not.toHaveBeenCalled();
  });
});
