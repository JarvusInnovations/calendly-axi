import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventsCommand } from "../../src/commands/events.js";
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

function collection(items: unknown[], nextPageToken: string | null = null) {
  return jsonResponse({
    collection: items,
    pagination: { count: items.length, next_page_token: nextPageToken },
  });
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    uri: "https://api.calendly.com/scheduled_events/EVT1",
    name: "Intro Call",
    status: "active",
    start_time: "2026-08-18T19:00:00Z",
    end_time: "2026-08-18T19:30:00Z",
    invitees_counter: { total: 1, active: 1, limit: 1 },
    ...overrides,
  };
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

describe("events list: defaults", () => {
  it("self-scoped, status active, ascending sort, upcoming window, drained result", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      collection([
        event(),
        event({ uri: "https://api.calendly.com/scheduled_events/EVT2", name: "Follow-up" }),
      ]),
    );

    const out = await eventsCommand([]);

    const [url] = spy.mock.calls[0]!;
    const q = queryOf(url);
    expect(q.get("user")).toBe("https://api.calendly.com/users/ABC123");
    expect(q.get("organization")).toBeNull();
    expect(q.get("status")).toBe("active");
    expect(q.get("sort")).toBe("start_time:asc");
    expect(q.get("min_start_time")).toBeTruthy();
    expect(q.get("max_start_time")).toBeNull();

    expect(out).toContain("scope: Chris Alfano");
    expect(out).toContain("status: active");
    expect(out).toMatch(/window: from \d{4}-\d{2}-\d{2} \(America\/New_York\)/);
    expect(out).toContain("count: 2");
    expect(out).toContain("complete: true");
    expect(out).toContain("events[2]{uuid,start,name,invitees}:");
    expect(out).toContain("EVT1");
    expect(out).toContain("Intro Call");
    expect(out).toContain("EVT2");
    expect(out).toContain("events view <uuid>");
    expect(out).toContain("events invitees <uuid>");
  });

  it("shows a definitive empty state naming scope, status, and window", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([]));
    const out = await eventsCommand([]);
    expect(out).toMatch(/events: "0 active events for Chris Alfano, from \d{4}-\d{2}-\d{2}/);
  });
});

describe("events list: window and sort flip", () => {
  it("--since flips sort to descending and scopes the window to a lookback", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([event()]));
    await eventsCommand(["--since", "7d"]);
    const [url] = spy.mock.calls[0]!;
    const q = queryOf(url);
    expect(q.get("sort")).toBe("start_time:desc");
    expect(q.get("min_start_time")).toBeTruthy();
    expect(q.get("max_start_time")).toBeTruthy();
  });

  it("a --to in the past flips sort to descending", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([event()]));
    await eventsCommand(["--from", "2020-01-01", "--to", "2020-01-08"]);
    const [url] = spy.mock.calls[0]!;
    expect(queryOf(url).get("sort")).toBe("start_time:desc");
  });

  it("--until (a future window) keeps ascending sort", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([event()]));
    await eventsCommand(["--until", "14d"]);
    const [url] = spy.mock.calls[0]!;
    expect(queryOf(url).get("sort")).toBe("start_time:asc");
  });

  it("--window today resolves a calendar-aligned window and echoes it in the header", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([event()]));
    const out = await eventsCommand(["--window", "today"]);
    const [url] = spy.mock.calls[0]!;
    const q = queryOf(url);
    expect(q.get("min_start_time")).toBeTruthy();
    expect(q.get("max_start_time")).toBeTruthy();
    expect(out).toContain("today");
  });

  it("--window combined with --from is a VALIDATION_ERROR naming the conflict, zero API calls", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    const err = await eventsCommand(["--window", "today", "--from", "2026-08-11"]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("--window");
    expect(err.message).toContain("--from");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("events list: status", () => {
  it("--status canceled is sent to the API and adds the status column", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(collection([event({ status: "canceled" })]));
    const out = await eventsCommand(["--status", "canceled"]);
    const [url] = spy.mock.calls[0]!;
    expect(queryOf(url).get("status")).toBe("canceled");
    expect(out).toContain("events[1]{uuid,start,name,invitees,status}:");
  });

  it("rejects an invalid --status value", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(eventsCommand(["--status", "bogus"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("events list: scoping", () => {
  it("--org widens to organization scope with no user param", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([]));
    const out = await eventsCommand(["--org"]);
    const [url] = spy.mock.calls[0]!;
    const q = queryOf(url);
    expect(q.get("organization")).toBe("https://api.calendly.com/organizations/ORG789");
    expect(q.get("user")).toBeNull();
    expect(out).toContain("scope: organization");
  });

  it("--user <uuid> scopes to another user without a network lookup", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([]));
    await eventsCommand(["--user", "OTHERUUID"]);
    expect(spy).toHaveBeenCalledTimes(1); // only the scheduled_events call
    const [url] = spy.mock.calls[0]!;
    expect(queryOf(url).get("user")).toBe("https://api.calendly.com/users/OTHERUUID");
  });

  it("a role-gate FORBIDDEN on --org appends the drop---org suggestion", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ title: "Forbidden", message: "requires admin role" }), { status: 403 }),
    );
    const err = await eventsCommand(["--org"]).catch((e) => e);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.suggestions.join(" ")).toContain("Drop --org to use self scope");
  });

  it("a FORBIDDEN without --org is left untouched (no drop---org suggestion)", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ title: "Forbidden", message: "missing scope" }), { status: 403 }),
    );
    const err = await eventsCommand([]).catch((e) => e);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.suggestions.join(" ")).not.toContain("Drop --org");
  });
});

describe("events list: --limit and pagination summary", () => {
  it("reports 'more available' plus a raise-limit hint when the limit stops a fuller cursor", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      collection([event(), event({ uri: "https://api.calendly.com/scheduled_events/EVT2" })], "PAGE2"),
    );
    const out = await eventsCommand(["--limit", "1"]);
    expect(out).toContain("more available");
    expect(out).toContain("complete: false");
    expect(out).toContain("Raise --limit or narrow the window");
    expect(out).toContain("events[1]{uuid,start,name,invitees}:");
  });

  it("rejects a non-integer --limit", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(eventsCommand(["--limit", "abc"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("--limit 0 drains explicitly", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([event()]));
    const out = await eventsCommand(["--limit", "0"]);
    expect(out).toContain("complete: true");
  });
});

describe("events view", () => {
  it("renders full detail: times in profile tz + ISO, event type, location, hosts, guests", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          resource: {
            uri: "https://api.calendly.com/scheduled_events/EVT1",
            name: "Intro Call",
            status: "active",
            start_time: "2026-08-18T19:00:00Z",
            end_time: "2026-08-18T19:30:00Z",
            event_type: "https://api.calendly.com/event_types/ET1",
            location: { type: "google_conference", join_url: "https://meet.google.com/xyz" },
            event_memberships: [{ user: "https://api.calendly.com/users/ABC123", user_name: "Chris Alfano" }],
            event_guests: [{ email: "guest@example.com" }],
            invitees_counter: { total: 1, active: 1, limit: 1 },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ resource: { name: "30 Minute Meeting" } }));

    const out = await eventsCommand(["view", "EVT1"]);

    expect(out).toContain("uuid: EVT1");
    expect(out).toContain("uri:");
    expect(out).toContain("scheduled_events/EVT1");
    expect(out).toContain("name: Intro Call");
    expect(out).toContain("status: active");
    expect(out).toContain("America/New_York");
    expect(out).toContain("start_iso:");
    expect(out).toContain("2026-08-18T19:00:00Z");
    expect(out).toContain("30 Minute Meeting");
    expect(out).toContain("google_conference");
    expect(out).toContain("meet.google.com");
    expect(out).toContain("Chris Alfano");
    expect(out).toContain("guest@example.com");
    expect(out).not.toContain("cancellation");
  });

  it("includes a cancellation block when the event is canceled", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          resource: {
            uri: "https://api.calendly.com/scheduled_events/EVT1",
            name: "Intro Call",
            status: "canceled",
            start_time: "2026-08-18T19:00:00Z",
            end_time: "2026-08-18T19:30:00Z",
            event_type: "https://api.calendly.com/event_types/ET1",
            cancellation: { canceled_by: "Chris Alfano", reason: "conflict", canceler_type: "host" },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ resource: { name: "30 Minute Meeting" } }));

    const out = await eventsCommand(["view", "EVT1"]);
    expect(out).toContain("cancellation:");
    expect(out).toContain("conflict");
  });

  it("accepts a full URI as well as a bare UUID", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          resource: {
            uri: "https://api.calendly.com/scheduled_events/EVT1",
            name: "Intro Call",
            status: "active",
            start_time: "2026-08-18T19:00:00Z",
            end_time: "2026-08-18T19:30:00Z",
          },
        }),
      );
    await eventsCommand(["view", "https://api.calendly.com/scheduled_events/EVT1"]);
    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain("/scheduled_events/EVT1");
  });

  it("requires the event argument", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(eventsCommand(["view"])).rejects.toMatchObject({ code: "USAGE" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("events invitees", () => {
  function invitee(overrides: Record<string, unknown> = {}) {
    return {
      uri: "https://api.calendly.com/scheduled_events/EVT1/invitees/INV1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      status: "active",
      timezone: "America/New_York",
      no_show: null,
      questions_and_answers: [],
      cancel_url: "https://calendly.com/cancellations/INV1",
      reschedule_url: "https://calendly.com/reschedulings/INV1",
      ...overrides,
    };
  }

  it("drains the cursor and renders the default list schema", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([invitee(), invitee({ uri: "https://api.calendly.com/scheduled_events/EVT1/invitees/INV2", no_show: { uri: "x" } })]));
    const out = await eventsCommand(["invitees", "EVT1"]);
    expect(out).toContain("invitees[2]{uuid,name,email,status,no_show}:");
    expect(out).toContain("Ada Lovelace");
    expect(out).toContain("no");
    expect(out).toContain("yes");
    expect(out).toContain("events invitees EVT1 --email <invitee-email>");
    expect(out).toContain("events cancel EVT1");
  });

  it("shows a definitive empty state", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([]));
    const out = await eventsCommand(["invitees", "EVT1"]);
    expect(out).toContain("0 invitees found for event EVT1");
  });

  it("--email with exactly one match renders full detail (Q&A, cancel/reschedule URLs)", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      collection([
        invitee({
          questions_and_answers: [{ question: "Company?", answer: "Jarvus", position: 0 }],
        }),
      ]),
    );
    const out = await eventsCommand(["invitees", "EVT1", "--email", "ada@example.com"]);
    expect(out).toContain("questions_and_answers[1]{question,answer,position}:");
    expect(out).toContain("Company?");
    expect(out).toContain("cancel_url:");
    expect(out).toContain("reschedule_url:");
    expect(out).toContain(
      "events no-show https://api.calendly.com/scheduled_events/EVT1/invitees/INV1",
    );
    expect(out).toContain("events cancel EVT1");
  });

  it("--email with several matches falls back to the list", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      collection([invitee(), invitee({ uri: "https://api.calendly.com/scheduled_events/EVT1/invitees/INV2" })]),
    );
    const out = await eventsCommand(["invitees", "EVT1", "--email", "shared@example.com"]);
    expect(out).toContain("invitees[2]{uuid,name,email,status,no_show}:");
  });

  it("renders the tracking UTM block when any field is non-null", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      collection([
        invitee({
          tracking: {
            utm_campaign: null,
            utm_source: "newsletter",
            utm_medium: null,
            utm_content: null,
            utm_term: null,
            salesforce_uuid: null,
          },
        }),
      ]),
    );
    const out = await eventsCommand(["invitees", "EVT1", "--email", "ada@example.com"]);
    expect(out).toContain("tracking:");
    expect(out).toContain("utm_source: newsletter");
    expect(out).toContain("utm_campaign:");
  });

  it("omits the tracking block entirely when every field is null", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      collection([
        invitee({
          tracking: {
            utm_campaign: null,
            utm_source: null,
            utm_medium: null,
            utm_content: null,
            utm_term: null,
            salesforce_uuid: null,
          },
        }),
      ]),
    );
    const out = await eventsCommand(["invitees", "EVT1", "--email", "ada@example.com"]);
    expect(out).not.toContain("tracking:");
  });

  it("omits the tracking block when the invitee has no tracking field at all", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(collection([invitee()]));
    const out = await eventsCommand(["invitees", "EVT1", "--email", "ada@example.com"]);
    expect(out).not.toContain("tracking:");
  });
});

describe("events cancel", () => {
  function scheduledEvent(overrides: Record<string, unknown> = {}) {
    return {
      uri: "https://api.calendly.com/scheduled_events/EVT1",
      name: "Intro Call",
      status: "active",
      start_time: "2026-08-18T19:00:00Z",
      end_time: "2026-08-18T19:30:00Z",
      ...overrides,
    };
  }

  it("cancels an active event and reports invitees notified", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ resource: scheduledEvent() }))
      .mockResolvedValueOnce(jsonResponse({}));

    const out = await eventsCommand(["cancel", "EVT1", "--reason", "scheduling conflict"]);

    expect(spy).toHaveBeenCalledTimes(2);
    const [cancelUrl, cancelInit] = spy.mock.calls[1]!;
    expect(String(cancelUrl)).toContain("/scheduled_events/EVT1/cancellation");
    expect(JSON.parse(String((cancelInit as RequestInit).body))).toEqual({ reason: "scheduling conflict" });

    expect(out).toContain("canceled:");
    expect(out).toContain("Intro Call");
    expect(out).toContain("invitees notified");
  });

  it("omits a body when --reason is not given", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ resource: scheduledEvent() }))
      .mockResolvedValueOnce(jsonResponse({}));

    await eventsCommand(["cancel", "EVT1"]);

    const [, cancelInit] = spy.mock.calls[1]!;
    expect((cancelInit as RequestInit).body).toBeUndefined();
  });

  it("already-canceled event is a no-op, exit 0, detected from the pre-fetch", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ resource: scheduledEvent({ status: "canceled" }) }));

    const out = await eventsCommand(["cancel", "EVT1"]);

    expect(spy).toHaveBeenCalledTimes(1); // no cancellation POST once already canceled
    expect(out).toContain("event already canceled (no-op)");
  });

  it("a double-cancel race (API rejects post-fetch) is translated to the same no-op", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ resource: scheduledEvent() }))
      .mockResolvedValueOnce(
        jsonResponse({ title: "InvalidCancellation", message: "This event is already canceled" }, 400),
      );

    const out = await eventsCommand(["cancel", "EVT1"]);
    expect(out).toContain("event already canceled (no-op)");
  });

  it("requires the event argument", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(eventsCommand(["cancel"])).rejects.toMatchObject({ code: "USAGE" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("events no-show", () => {
  const inviteeUri = "https://api.calendly.com/scheduled_events/EVT1/invitees/INV1";

  it("marks an invitee as a no-show", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ resource: {} }));

    const out = await eventsCommand(["no-show", inviteeUri]);

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain("/invitee_no_shows");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ invitee: inviteeUri });
    expect(out).toContain("no-show marked");
    expect(out).toContain("INV1");
  });

  it("marking an already-marked invitee is a no-op, exit 0", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ title: "InvalidInvitee", message: "This invitee is already marked as a no-show" }, 400),
    );

    const out = await eventsCommand(["no-show", inviteeUri]);
    expect(out).toContain("already marked as no-show (no-op)");
  });

  it("rejects a bare invitee uuid without --event, naming the --event fix, zero API calls", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    const err = await eventsCommand(["no-show", "INV1"]).catch((e) => e as { code: string; suggestions: string[] });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.suggestions.join(" ")).toContain("--event <event-uuid>");
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts a bare invitee uuid with --event, constructing the nested URI", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ resource: {} }, 201));
    const out = await eventsCommand(["no-show", "INV1", "--event", "EVT1"]);
    const [, init] = spy.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body)).invitee).toBe(
      "https://api.calendly.com/scheduled_events/EVT1/invitees/INV1",
    );
    expect(out).toContain("no-show marked");
  });

  it("accepts --event as a full event URI for a bare invitee uuid", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ resource: {} }, 201));
    await eventsCommand(["no-show", "INV1", "--event", "https://api.calendly.com/scheduled_events/EVT1"]);
    const [, init] = spy.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body)).invitee).toBe(
      "https://api.calendly.com/scheduled_events/EVT1/invitees/INV1",
    );
  });

  it("--undo fetches the invitee via the URI's embedded event uuid and deletes via no_show.uri", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          resource: { uri: inviteeUri, no_show: { uri: "https://api.calendly.com/invitee_no_shows/NS1" } },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const out = await eventsCommand(["no-show", inviteeUri, "--undo"]);

    const [getUrl] = spy.mock.calls[0]!;
    expect(String(getUrl)).toContain("/scheduled_events/EVT1/invitees/INV1");
    const [delUrl, delInit] = spy.mock.calls[1]!;
    expect(String(delUrl)).toContain("/invitee_no_shows/NS1");
    expect((delInit as RequestInit).method).toBe("DELETE");
    expect(out).toContain("no-show cleared");
  });

  it("--undo on an invitee with no no_show mark is a no-op, exit 0, without a DELETE call", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ resource: { uri: inviteeUri, no_show: null } }));

    const out = await eventsCommand(["no-show", inviteeUri, "--undo"]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toContain("not marked as no-show (no-op)");
  });

  it("--undo also rejects a bare invitee uuid", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(eventsCommand(["no-show", "INV1", "--undo"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("requires the invitee argument", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(eventsCommand(["no-show"])).rejects.toMatchObject({ code: "USAGE" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("events answers", () => {
  function typeNameResponse(name = "30 Minute Meeting") {
    return jsonResponse({ resource: { name } });
  }

  function answersEvent(overrides: Record<string, unknown> = {}) {
    return {
      uri: "https://api.calendly.com/scheduled_events/EVT1",
      name: "Intro Call",
      status: "active",
      start_time: "2026-08-10T10:00:00Z",
      end_time: "2026-08-10T10:30:00Z",
      event_type: "https://api.calendly.com/event_types/ET1",
      invitees_counter: { total: 1, active: 1, limit: 1 },
      ...overrides,
    };
  }

  function answersInvitee(overrides: Record<string, unknown> = {}) {
    return {
      uri: "https://api.calendly.com/scheduled_events/EVT1/invitees/INV1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      status: "active",
      questions_and_answers: [],
      tracking: {
        utm_campaign: null,
        utm_source: null,
        utm_medium: null,
        utm_content: null,
        utm_term: null,
        salesforce_uuid: null,
      },
      ...overrides,
    };
  }

  it("requires --type, zero API calls", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    const err = await eventsCommand(["answers"]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("--type");
    expect(spy).not.toHaveBeenCalled();
  });

  it("drains multi-page events, filters client-side by type, drains each match's invitees, one row per Q&A sorted start-desc", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(typeNameResponse())
      .mockResolvedValueOnce(
        collection(
          [
            answersEvent(), // EVT1, ET1, 2026-08-10 — matches
            answersEvent({
              uri: "https://api.calendly.com/scheduled_events/EVT2",
              event_type: "https://api.calendly.com/event_types/ET2", // other type — excluded
            }),
          ],
          "PAGE2",
        ),
      )
      .mockResolvedValueOnce(
        collection([
          answersEvent({
            uri: "https://api.calendly.com/scheduled_events/EVT3",
            start_time: "2026-08-12T10:00:00Z", // later — should sort first
          }),
        ]),
      )
      .mockResolvedValueOnce(
        collection([
          answersInvitee({
            questions_and_answers: [{ question: "Company?", answer: "Jarvus", position: 0 }],
          }),
        ]),
      )
      .mockResolvedValueOnce(
        collection([
          answersInvitee({
            uri: "https://api.calendly.com/scheduled_events/EVT3/invitees/INV2",
            email: "grace@example.com",
            questions_and_answers: [{ question: "Role?", answer: "Engineer", position: 0 }],
          }),
        ]),
      );

    const out = await eventsCommand(["answers", "--type", "ET1"]);

    expect(spy).toHaveBeenCalledTimes(5);
    // event_type filter never reaches the events-list query — client-side only.
    const eventsUrl = queryOf(spy.mock.calls[1]![0]);
    expect(eventsUrl.get("event_type")).toBeNull();
    // EVT2's invitees are never fetched — filtered out before the invitee drain.
    expect(String(spy.mock.calls[3]![0])).toContain("/scheduled_events/EVT1/invitees");
    expect(String(spy.mock.calls[4]![0])).toContain("/scheduled_events/EVT3/invitees");

    expect(out).toContain("type: 30 Minute Meeting");
    expect(out).toContain("events: 2");
    expect(out).toContain("invitees: 2");
    expect(out).toContain("answers[2]{start,email,question,answer}:");

    // Sorted start-desc: EVT3 (Engineer, 08-12) before EVT1 (Jarvus, 08-10).
    expect(out.indexOf("Engineer")).toBeLessThan(out.indexOf("Jarvus"));
  });

  it("--utm swaps the schema to one row per invitee's UTM fields", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(typeNameResponse())
      .mockResolvedValueOnce(collection([answersEvent()]))
      .mockResolvedValueOnce(
        collection([
          answersInvitee({
            tracking: {
              utm_campaign: "summer-sale",
              utm_source: "newsletter",
              utm_medium: "email",
              utm_content: null,
              utm_term: null,
              salesforce_uuid: null,
            },
          }),
        ]),
      );

    const out = await eventsCommand(["answers", "--type", "ET1", "--utm"]);

    expect(out).toContain("answers[1]{start,email,utm_source,utm_medium,utm_campaign}:");
    expect(out).toContain("newsletter");
    expect(out).toContain("email");
    expect(out).toContain("summer-sale");
  });

  it("--status all drops the status filter from both the events and invitees queries", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(typeNameResponse())
      .mockResolvedValueOnce(collection([answersEvent()]))
      .mockResolvedValueOnce(collection([answersInvitee()]));

    await eventsCommand(["answers", "--type", "ET1", "--status", "all"]);

    expect(queryOf(spy.mock.calls[1]![0]).get("status")).toBeNull();
    expect(queryOf(spy.mock.calls[2]![0]).get("status")).toBeNull();
  });

  it("defaults --status to active on both queries", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(typeNameResponse())
      .mockResolvedValueOnce(collection([answersEvent()]))
      .mockResolvedValueOnce(collection([answersInvitee()]));

    await eventsCommand(["answers", "--type", "ET1"]);

    expect(queryOf(spy.mock.calls[1]![0]).get("status")).toBe("active");
    expect(queryOf(spy.mock.calls[2]![0]).get("status")).toBe("active");
  });

  it("rejects an invalid --status value, zero API calls", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(eventsCommand(["answers", "--type", "ET1", "--status", "bogus"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("defaults the window to --since 30d", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(typeNameResponse())
      .mockResolvedValueOnce(collection([]));

    const out = await eventsCommand(["answers", "--type", "ET1"]);

    const eventsUrl = queryOf(spy.mock.calls[1]![0]);
    expect(eventsUrl.get("min_start_time")).toBeTruthy();
    expect(eventsUrl.get("max_start_time")).toBeTruthy();
    expect(out).toContain("last 30d");
  });

  it("a definitive empty state names the type, window, and zero counts when no events match", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(typeNameResponse())
      .mockResolvedValueOnce(collection([]));

    const out = await eventsCommand(["answers", "--type", "ET1"]);
    expect(out).toContain("0 answers for");
    expect(out).toContain("30 Minute Meeting");
    expect(out).toContain("events: 0");
    expect(out).toContain("invitees: 0");
  });

  it("a definitive empty state when events match but carry no Q&A answers", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(typeNameResponse())
      .mockResolvedValueOnce(collection([answersEvent()]))
      .mockResolvedValueOnce(collection([answersInvitee({ questions_and_answers: [] })]));

    const out = await eventsCommand(["answers", "--type", "ET1"]);
    expect(out).toContain("events: 1");
    expect(out).toContain("invitees: 1");
    expect(out).toContain("0 answers for");
  });

  it("--window combined with --since is a VALIDATION_ERROR naming the conflict, no events sweep", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(typeNameResponse());
    const err = await eventsCommand(["answers", "--type", "ET1", "--window", "today", "--since", "7d"]).catch(
      (e) => e,
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("--window");
    // The type-name fetch happens before window resolution (same shape as
    // `types slots`), but the events sweep never fires.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("--org widens both name resolution and the event sweep to organization scope", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(typeNameResponse())
      .mockResolvedValueOnce(collection([]));

    await eventsCommand(["answers", "--type", "ET1", "--org"]);

    const eventsUrl = queryOf(spy.mock.calls[1]![0]);
    expect(eventsUrl.get("organization")).toBe("https://api.calendly.com/organizations/ORG789");
    expect(eventsUrl.get("user")).toBeNull();
  });

  it("resolves --type by name against self scope, then reuses the resolved uuid", async () => {
    seedCache();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        collection([{ uri: "https://api.calendly.com/event_types/ET1", name: "30 Minute Meeting" }]),
      )
      .mockResolvedValueOnce(typeNameResponse())
      .mockResolvedValueOnce(collection([]));

    await eventsCommand(["answers", "--type", "30 Minute Meeting"]);

    const nameSweepUrl = queryOf(spy.mock.calls[0]![0]);
    expect(nameSweepUrl.get("user")).toBe("https://api.calendly.com/users/ABC123");
    expect(String(spy.mock.calls[1]![0])).toContain("/event_types/ET1");
  });
});
