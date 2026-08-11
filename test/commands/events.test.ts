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
