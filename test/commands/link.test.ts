import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkCommand } from "../../src/commands/link.js";
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

beforeEach(() => {
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1";
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
});

describe("link", () => {
  it("resolves a bare uuid, mints a single-use link, and reports the resolved type", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          resource: { booking_url: "https://calendly.com/d/abc-123/30min-clone" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ resource: { name: "30 Minute Meeting", duration: 30 } }),
      );

    const out = await linkCommand(["ET1"]);

    const [createUrl, createInit] = spy.mock.calls[0]!;
    expect(String(createUrl)).toContain("/scheduling_links");
    const body = JSON.parse(String((createInit as RequestInit).body));
    expect(body).toEqual({
      max_event_count: 1,
      owner: "https://api.calendly.com/event_types/ET1",
      owner_type: "EventType",
    });

    expect(out).toContain("booking_url:");
    expect(out).toContain("30min-clone");
    expect(out).toContain("ET1");
    expect(out).toContain("30 Minute Meeting");
    expect(out).toContain("duration: 30");
    expect(out).toContain("single_use:");
    expect(out).toContain("one booking");
    expect(out).toContain("events --email <invitee-email>");
    expect(out).toContain("link <other-event-type>");
  });

  it("resolves a name via the event-types sweep before minting the link", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          collection: [{ uri: "https://api.calendly.com/event_types/ET1", name: "30 Minute Meeting" }],
          pagination: { count: 1, next_page_token: null },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ resource: { booking_url: "https://calendly.com/d/abc-123/30min" } }))
      .mockResolvedValueOnce(jsonResponse({ resource: { name: "30 Minute Meeting", duration: 30 } }));

    const out = await linkCommand(["30 Minute Meeting"]);

    const [sweepUrl] = spy.mock.calls[0]!;
    expect(String(sweepUrl)).toContain("/event_types");
    expect(String(sweepUrl)).toContain("user=");
    expect(out).toContain("booking_url:");
    expect(out).toContain("30 Minute Meeting");
  });

  it("requires the event-type argument", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(linkCommand([])).rejects.toMatchObject({ code: "USAGE" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an unknown flag without making a request", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(linkCommand(["ET1", "--totally-bogus-flag"])).rejects.toMatchObject({ code: "UNKNOWN_FLAG" });
    expect(spy).not.toHaveBeenCalled();
  });
});
