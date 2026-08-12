import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homeCommand } from "../../src/commands/home.js";
import { writeConfig } from "../../src/config.js";

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status });
}

const ME = {
  resource: {
    uri: "https://api.calendly.com/users/ABC123",
    name: "Chris Alfano",
    email: "chris@jarv.us",
    scheduling_url: "https://calendly.com/chris",
    timezone: "America/New_York",
    current_organization: "https://api.calendly.com/organizations/ORG789",
  },
};

beforeEach(() => {
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1";
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
  delete process.env.CALENDLY_ACCESS_TOKEN;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
  delete process.env.CALENDLY_ACCESS_TOKEN;
  process.exitCode = 0;
});

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

describe("home: unconfigured", () => {
  it("makes no API call and shows the setup instruction, exit 0", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const out = await homeCommand([]);
    expect(out).toContain("status: not configured");
    expect(out).toContain("auth setup");
    expect(spy).not.toHaveBeenCalled();
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe("home: configured", () => {
  it("shows identity (zero API calls for it) plus up to 5 upcoming rows from one live call", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [
          {
            uri: "https://api.calendly.com/scheduled_events/EVT1",
            name: "Intro Call",
            start_time: "2026-08-18T15:00:00Z",
            invitees_counter: { active: 1, limit: 1 },
          },
          {
            uri: "https://api.calendly.com/scheduled_events/EVT2",
            name: "Follow-up",
            start_time: "2026-08-19T15:00:00Z",
            invitees_counter: { active: 1, limit: 2 },
          },
        ],
      }),
    );
    const out = await homeCommand([]);
    expect(spy).toHaveBeenCalledTimes(1); // identity from cache, one live call
    expect(out).toContain("account: Chris Alfano <chris@jarv.us>");
    expect(out).toContain("upcoming[2]{uuid,start,name,invitees}:");
    expect(out).toContain("EVT1");
    expect(out).toContain("Intro Call");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("shows a definitive empty-state line when there are zero active events", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ collection: [] }));
    const out = await homeCommand([]);
    expect(out).toContain("upcoming: no active events scheduled");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("caps at 5 rows even when more are returned (server-side count=5, but guard the render too)", async () => {
    seedCache();
    const events = Array.from({ length: 5 }, (_, i) => ({
      uri: `https://api.calendly.com/scheduled_events/EVT${i}`,
      name: `Meeting ${i}`,
      start_time: "2026-08-18T15:00:00Z",
      invitees_counter: { active: 1, limit: 1 },
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ collection: events }));
    const out = await homeCommand([]);
    expect(out).toContain("upcoming[5]{uuid,start,name,invitees}:");
  });

  it("renders start times in the profile timezone", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [
          {
            uri: "https://api.calendly.com/scheduled_events/EVT1",
            name: "Intro Call",
            start_time: "2026-08-18T15:00:00Z",
            invitees_counter: { active: 1, limit: 1 },
          },
        ],
      }),
    );
    const out = await homeCommand([]);
    expect(out).toContain("America/New_York");
  });

  it("suggests the booking loop first, doctor only when nothing is degraded", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ collection: [] }));
    const out = await homeCommand([]);
    expect(out).toMatch(/help\[3\]:/);
    expect(out).toContain("calendly-axi events");
    expect(out).toContain("calendly-axi link");
    expect(out).toContain("calendly-axi types");
    expect(out).not.toContain("calendly-axi doctor");
  });
});

describe("home: degraded (API unreachable / token invalid)", () => {
  it("keeps cached identity, states the problem, hints doctor, never throws, exit 0", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 401 }));
    const out = await homeCommand([]);
    expect(out).toContain("account: Chris Alfano <chris@jarv.us>");
    expect(out).toContain("status:");
    expect(out).not.toContain("upcoming[");
    expect(out).toMatch(/help\[4\]:/);
    expect(out).toContain("calendly-axi doctor");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("never leaks a raw error body", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("some backend stack trace", { status: 500 }));
    const out = await homeCommand([]);
    expect(out).not.toContain("stack trace");
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe("home: env-only bootstrap (no config file, scoping.md)", () => {
  it("bootstraps self once (unpersisted) and performs a scoped list, exit 0", async () => {
    process.env.CALENDLY_ACCESS_TOKEN = "env_tok";
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME)) // bootstrap users/me
      .mockResolvedValueOnce(jsonResponse({ collection: [] })); // scheduled_events
    const out = await homeCommand([]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out).toContain("account: Chris Alfano <chris@jarv.us>");
    expect(out).toContain("upcoming: no active events scheduled");
    expect(process.exitCode ?? 0).toBe(0);

    const [scheduledEventsUrl] = spy.mock.calls[1]!;
    expect(String(scheduledEventsUrl)).toContain("user=https%3A%2F%2Fapi.calendly.com%2Fusers%2FABC123");
  });
});

describe("home: flags", () => {
  it("rejects an unknown flag without making a request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(homeCommand(["--nope"])).rejects.toMatchObject({ code: "UNKNOWN_FLAG" });
    expect(spy).not.toHaveBeenCalled();
  });
});
