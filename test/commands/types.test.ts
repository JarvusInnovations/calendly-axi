import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { typesCommand } from "../../src/commands/types.js";
import { writeConfig } from "../../src/config.js";

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status });
}

const PROFILE = {
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
};

beforeEach(() => {
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1"; // never touch real ~/.claude during these tests
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
  delete process.env.CALENDLY_ACCESS_TOKEN;
  writeConfig(PROFILE);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
  delete process.env.CALENDLY_ACCESS_TOKEN;
  process.exitCode = 0;
});

describe("types list", () => {
  it("lists active types name-ascending with scheduling_url, no active column by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [
          {
            uri: "https://api.calendly.com/event_types/T1",
            name: "Intro Call",
            duration: 30,
            kind: "solo",
            scheduling_url: "https://calendly.com/chris/intro",
            active: true,
          },
        ],
        pagination: { count: 1, next_page_token: null },
      }),
    );
    const out = await typesCommand([]);
    expect(out).toContain("types[1]{uuid,name,duration,kind,scheduling_url}:");
    expect(out).toContain("T1");
    expect(out).toContain("Intro Call");
    expect(out).toContain("scheduling_url");
    expect(out).not.toContain("active,"); // no active column outside --all

    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain("active=true");
    expect(String(url)).toContain("sort=name%3Aasc");
    expect(String(url)).toContain("user=");
  });

  it("--all adds the active column and sends no active filter", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [
          {
            uri: "https://api.calendly.com/event_types/T1",
            name: "Intro Call",
            duration: 30,
            kind: "solo",
            scheduling_url: "https://calendly.com/chris/intro",
            active: false,
          },
        ],
        pagination: { count: 1, next_page_token: null },
      }),
    );
    const out = await typesCommand(["list", "--all"]);
    expect(out).toContain("types[1]{uuid,name,active,duration,kind,scheduling_url}:");
    const [url] = spy.mock.calls[0]!;
    expect(String(url)).not.toContain("active=");
  });

  it("--org scopes to the organization and a role-gate 403 is translated", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ title: "Forbidden", message: "requires admin role" }), { status: 403 }),
      );
    await expect(typesCommand(["list", "--org"])).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain("organization=");
    expect(String(url)).not.toContain("user=");
  });

  it("is a definitive zero when the active list is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ collection: [], pagination: { count: 0, next_page_token: null } }),
    );
    const out = await typesCommand([]);
    expect(out).toContain("types: 0 active event types for Chris Alfano");
  });
});

describe("types view", () => {
  const TYPE = {
    resource: {
      uri: "https://api.calendly.com/event_types/T1",
      name: "Intro Call",
      active: true,
      kind: "solo",
      duration: 30,
      scheduling_url: "https://calendly.com/chris/intro",
      color: "#000000",
      description_plain: "x".repeat(600),
      locations: [{ kind: "physical", location: "123 Main St" }],
      custom_questions: [{ position: 0, name: "Company", type: "text", required: true }],
      profile: { owner: "https://api.calendly.com/users/ABC123" },
    },
  };

  it("resolves a bare uuid with no sweep call and truncates a long description with a --full hint", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(TYPE));
    const out = await typesCommand(["view", "T1"]);
    expect(spy).toHaveBeenCalledTimes(1); // direct GET only, no name-resolution sweep
    expect(out).toContain("description_total_chars: 600");
    expect(out).toMatch(/help\[1\]:/);
    expect(out).toContain("--full");
    expect(out).not.toContain("x".repeat(600)); // truncated, not the full 600
  });

  it("--full shows the untruncated description with no help block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(TYPE));
    const out = await typesCommand(["view", "T1", "--full"]);
    expect(out).toContain("x".repeat(600));
    expect(out).not.toContain("help[");
  });

  it("resolves a human name via the event-types sweep, then fetches the detail", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          collection: [{ uri: "https://api.calendly.com/event_types/T1", name: "Intro Call" }],
          pagination: { count: 1, next_page_token: null },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(TYPE));
    const out = await typesCommand(["view", "Intro Call"]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out).toContain("Intro Call");
  });

  it("renders custom questions, locations, and owner", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(TYPE));
    const out = await typesCommand(["view", "T1", "--full"]);
    expect(out).toContain("locations[1]{kind,display}:");
    expect(out).toContain("123 Main St");
    expect(out).toContain("custom_questions[1]{position,name,type,required}:");
    expect(out).toContain("Company");
    expect(out).toContain("owner:");
    expect(out).toContain("https://api.calendly.com/users/ABC123");
  });
});

describe("types slots", () => {
  const TYPE = {
    resource: {
      uri: "https://api.calendly.com/event_types/T1",
      name: "Intro Call",
      active: true,
      kind: "solo",
      duration: 30,
      scheduling_url: "https://calendly.com/chris/intro",
    },
  };

  it("defaults to a 7-day window and renders available slots with local+ISO start, complete: true", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE))
      .mockResolvedValueOnce(
        jsonResponse({
          collection: [
            { status: "available", start_time: "2026-08-12T15:00:00Z", invitees_remaining: 1, scheduling_url: "x" },
          ],
        }),
      );
    const out = await typesCommand(["slots", "T1"]);
    expect(out).toContain("slots[1]{start,invitees_remaining}:");
    expect(out).toContain("2026-08-12T15:00:00Z");
    expect(out).toContain("complete: true");

    const url = String(spy.mock.calls[1]![0]);
    expect(url).toContain("event_type=");
    expect(url).toContain("start_time=");
    expect(url).toContain("end_time=");
  });

  it("a 32-day request is rejected with the cap named", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(TYPE));
    await expect(
      typesCommand(["slots", "T1", "--from", "2026-08-11", "--to", "2026-09-12"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("an empty window is a definitive line with widen/availability hints", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE))
      .mockResolvedValueOnce(jsonResponse({ collection: [] }));
    const out = await typesCommand(["slots", "T1"]);
    expect(out).toContain("no availability for");
    expect(out).toContain("Intro Call");
    expect(out).toContain("Widen the window");
    expect(out).toContain("types availability T1");
  });

  it("rejects --from without a paired --to before making any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(typesCommand(["slots", "T1", "--from", "2026-08-11"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("types availability", () => {
  it("renders the read path (rules + timezone) when --rules is omitted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [{ timezone: "America/New_York", rules: [{ type: "wday", wday: "monday", intervals: [] }] }],
      }),
    );
    const out = await typesCommand(["availability", "T1"]);
    expect(out).toContain("event_type: T1");
    expect(out).toContain("America/New_York");
  });

  it("reports a definitive empty state when there are no schedules", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ collection: [] }));
    const out = await typesCommand(["availability", "T1"]);
    expect(out).toContain("no availability schedules found for T1");
  });

  it("--rules stays NOT_IMPLEMENTED, naming types-write", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(typesCommand(["availability", "T1", "--rules", "{}"])).rejects.toMatchObject({
      code: "NOT_IMPLEMENTED",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("types create/update", () => {
  // create/update throw synchronously (matching every other stub command),
  // not as a rejected promise — see typesCommand's doc comment.
  it("stay NOT_IMPLEMENTED, naming types-write, before any request", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(() => typesCommand(["create"])).toThrow(expect.objectContaining({ code: "NOT_IMPLEMENTED" }));
    expect(() => typesCommand(["update", "T1"])).toThrow(expect.objectContaining({ code: "NOT_IMPLEMENTED" }));
    expect(spy).not.toHaveBeenCalled();
  });
});
