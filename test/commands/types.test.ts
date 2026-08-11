import { mkdtempSync, writeFileSync } from "node:fs";
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

  it("--rules PATCHes availability_rule and renders the response", async () => {
    const rule = {
      rules: [{ type: "wday", wday: "monday", intervals: [{ from: "09:00", to: "17:00" }] }],
      timezone: "America/New_York",
    };
    const spy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (url, init) => {
      expect(String(url)).toContain("event_type_availability_schedules");
      expect(String(url)).toContain("event_type=");
      expect((init as RequestInit).method).toBe("PATCH");
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toEqual({ availability_rule: rule });
      return jsonResponse({ collection: [rule] });
    });
    const out = await typesCommand(["availability", "T1", "--rules", JSON.stringify(rule)]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toContain("status: updated");
    expect(out).toContain("America/New_York");
  });

  it("--rules @file reads and PATCHes the file's JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "calendly-axi-fixture-"));
    const file = join(dir, "rules.json");
    const rule = { rules: [], timezone: "UTC" };
    writeFileSync(file, JSON.stringify(rule));
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toEqual({ availability_rule: rule });
      return jsonResponse({ collection: [rule] });
    });
    await typesCommand(["availability", "T1", "--rules", `@${file}`]);
  });

  it("malformed --rules JSON is a VALIDATION_ERROR before any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(typesCommand(["availability", "T1", "--rules", "{not json"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("types create", () => {
  const CREATED = {
    resource: {
      uri: "https://api.calendly.com/event_types/NEW1",
      name: "Intro Call",
      active: true,
      kind: "solo",
      duration: 30,
      scheduling_url: "https://calendly.com/chris/intro",
      profile: { owner: "https://api.calendly.com/users/ABC123" },
    },
  };

  it("creates a solo type with owner from the profile cache, and renders the detail view", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toEqual({ name: "Intro Call", owner: "https://api.calendly.com/users/ABC123", duration: 30 });
      return jsonResponse(CREATED, 201);
    });
    const out = await typesCommand(["create", "--name", "Intro Call", "--duration", "30"]);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain("/event_types");
    expect((init as RequestInit).method).toBe("POST");
    expect(out).toContain("NEW1");
    expect(out).toContain("scheduling_url");
  });

  it("--inactive creates an inactive type", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.active).toBe(false);
      return jsonResponse(CREATED, 201);
    });
    await typesCommand(["create", "--name", "Intro Call", "--duration", "30", "--inactive"]);
  });

  it("--locations parses inline JSON into the request body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.locations).toEqual([{ kind: "physical", location: "123 Main St" }]);
      return jsonResponse(CREATED, 201);
    });
    await typesCommand([
      "create",
      "--name",
      "Intro Call",
      "--duration",
      "30",
      "--locations",
      '[{"kind":"physical","location":"123 Main St"}]',
    ]);
  });

  it("--locations @file round-trips a physical + custom kind fixture through the create request/response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "calendly-axi-fixture-"));
    const file = join(dir, "locations.json");
    const fixtureLocations = [
      { kind: "physical", location: "123 Main St" },
      { kind: "custom", location: "Zoom link in confirmation email" },
    ];
    writeFileSync(file, JSON.stringify(fixtureLocations));
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.locations).toEqual(fixtureLocations);
      return jsonResponse({ resource: { ...CREATED.resource, locations: fixtureLocations } }, 201);
    });
    const out = await typesCommand(["create", "--name", "Intro Call", "--duration", "30", "--locations", `@${file}`]);
    expect(out).toContain("123 Main St");
    expect(out).toContain("Zoom link in confirmation email");
  });

  it("malformed --locations JSON is a VALIDATION_ERROR before any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(
      typesCommand(["create", "--name", "Intro Call", "--duration", "30", "--locations", "{not json"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a bad --locations kind: the API's 400 with per-field details is restated, exit 2", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          title: "Invalid Parameters",
          message: "Bad request",
          details: [{ parameter: "locations[0].kind", message: "is not a valid location kind" }],
        },
        400,
      ),
    );
    const err = await typesCommand([
      "create",
      "--name",
      "Intro Call",
      "--duration",
      "30",
      "--locations",
      '[{"kind":"not_a_real_kind"}]',
    ]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("locations[0].kind: is not a valid location kind");
  });

  it("--name is required, zero API calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(typesCommand(["create", "--duration", "30"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("--duration is required and must be a positive number, zero API calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(typesCommand(["create", "--name", "Intro Call"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      typesCommand(["create", "--name", "Intro Call", "--duration", "not-a-number"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a 400 with per-field details is restated by the client's error translation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        { title: "Invalid Parameters", message: "Bad request", details: [{ parameter: "color", message: "must be a valid hex color" }] },
        400,
      ),
    );
    const err = await typesCommand(["create", "--name", "Intro Call", "--duration", "30", "--color", "notacolor"]).catch(
      (e) => e,
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("color: must be a valid hex color");
  });

  describe("--one-off", () => {
    it("POSTs to one_off_event_types with a single date parsed into a date_range", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body).toEqual({
          name: "Ad-hoc Sync",
          host: "https://api.calendly.com/users/ABC123",
          duration: 15,
          date_setting: { type: "date_range", start_date: "2026-08-18", end_date: "2026-08-18" },
        });
        return jsonResponse(CREATED, 201);
      });
      const out = await typesCommand([
        "create",
        "--one-off",
        "--name",
        "Ad-hoc Sync",
        "--duration",
        "15",
        "--date",
        "2026-08-18",
      ]);
      const [url] = spy.mock.calls[0]!;
      expect(String(url)).toContain("/one_off_event_types");
      expect(out).toContain("NEW1");
    });

    it("parses a date range, --timezone, and --co-hosts", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body.date_setting).toEqual({ type: "date_range", start_date: "2026-08-18", end_date: "2026-08-20" });
        expect(body.timezone).toBe("America/New_York");
        expect(body.co_hosts).toEqual([
          "https://api.calendly.com/users/COHOST1",
          "https://api.calendly.com/users/COHOST2",
        ]);
        return jsonResponse(CREATED, 201);
      });
      await typesCommand([
        "create",
        "--one-off",
        "--name",
        "Ad-hoc Sync",
        "--duration",
        "15",
        "--date",
        "2026-08-18..2026-08-20",
        "--timezone",
        "America/New_York",
        "--co-hosts",
        "COHOST1,COHOST2",
      ]);
    });

    it("--date is required with --one-off, zero API calls", async () => {
      const spy = vi.spyOn(globalThis, "fetch");
      await expect(
        typesCommand(["create", "--one-off", "--name", "Ad-hoc Sync", "--duration", "15"]),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(spy).not.toHaveBeenCalled();
    });

    it("a malformed --date is a VALIDATION_ERROR before any request", async () => {
      const spy = vi.spyOn(globalThis, "fetch");
      await expect(
        typesCommand(["create", "--one-off", "--name", "Ad-hoc Sync", "--duration", "15", "--date", "not-a-date"]),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe("types update", () => {
  const soloType = (overrides: Record<string, unknown> = {}) => ({
    resource: {
      uri: "https://api.calendly.com/event_types/T1",
      name: "Intro Call",
      active: true,
      kind: "solo",
      duration: 30,
      scheduling_url: "https://calendly.com/chris/intro",
      ...overrides,
    },
  });

  it("--active and --inactive together are rejected, zero API calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(typesCommand(["update", "T1", "--active", "--inactive"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("malformed --locations JSON is rejected before any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(typesCommand(["update", "T1", "--locations", "{not json"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("no flags supplied is a no-op, exit 0, GET only (no PATCH)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(soloType()));
    const out = await typesCommand(["update", "T1"]);
    expect(out).toContain("no-op");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("--inactive on an already-inactive type is a no-op, GET only", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(soloType({ active: false })));
    const out = await typesCommand(["update", "T1", "--inactive"]);
    expect(out).toContain("no-op");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("--inactive on an active type PATCHes active:false", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(soloType({ active: true })))
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body).toEqual({ active: false });
        return jsonResponse(soloType({ active: false }));
      });
    const out = await typesCommand(["update", "T1", "--inactive"]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((spy.mock.calls[1]![1] as RequestInit).method).toBe("PATCH");
    expect(out).toContain("T1");
  });

  it("only the supplied fields land in the PATCH body", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(soloType()))
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body).toEqual({ name: "New Name" });
        return jsonResponse(soloType({ name: "New Name" }));
      });
    await typesCommand(["update", "T1", "--name", "New Name"]);
  });

  it("a group event type surfaces the solo-only boundary without attempting a PATCH", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(soloType({ kind: "group" })));
    const err = await typesCommand(["update", "T1", "--name", "New Name"]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message.toLowerCase()).toContain("solo");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
