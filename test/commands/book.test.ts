import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookCommand } from "../../src/commands/book.js";
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

const TYPE_DETAIL = {
  resource: {
    uri: "https://api.calendly.com/event_types/T1",
    name: "Intro Call",
    active: true,
    kind: "solo",
    duration: 30,
    scheduling_url: "https://calendly.com/chris/intro",
    custom_questions: [] as Array<{ position: number; name: string; type: string; required: boolean }>,
  },
};

const INVITEE_RESOURCE = {
  resource: {
    uri: "https://api.calendly.com/scheduled_events/E1/invitees/INV1",
    event: "https://api.calendly.com/scheduled_events/E1",
    cancel_url: "https://calendly.com/cancellations/INV1",
    reschedule_url: "https://calendly.com/reschedulings/INV1",
  },
};

const REQUIRED_ARGS = [
  "--type",
  "T1",
  "--at",
  "2026-08-18T15:00:00Z",
  "--name",
  "Ada Lovelace",
  "--email",
  "ada@example.com",
];

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

describe("book: required flags", () => {
  it("missing all required flags fails VALIDATION_ERROR listing exactly the missing ones, zero API calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(bookCommand([])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
    try {
      await bookCommand([]);
      throw new Error("should have thrown");
    } catch (err) {
      const message = (err as { message: string }).message;
      expect(message).toContain("--type");
      expect(message).toContain("--at");
      expect(message).toContain("--name");
      expect(message).toContain("--email");
    }
  });

  it("missing only --email lists exactly --email, zero API calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      await bookCommand(["--type", "T1", "--at", "2026-08-18T15:00:00Z", "--name", "Ada Lovelace"]);
      throw new Error("should have thrown");
    } catch (err) {
      const message = (err as { message: string }).message;
      expect(message).toContain("--email");
      expect(message).not.toContain("--type");
      expect(message).not.toContain("--at ");
      expect(message).not.toContain("--name");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("date-only --at is rejected before any API call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(
      bookCommand(["--type", "T1", "--at", "2026-08-18", "--name", "Ada Lovelace", "--email", "ada@example.com"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("book: happy path", () => {
  it("books directly, resolving a bare-uuid --type with no sweep call", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE_DETAIL))
      .mockResolvedValueOnce(jsonResponse(INVITEE_RESOURCE));

    const out = await bookCommand(REQUIRED_ARGS);

    expect(spy).toHaveBeenCalledTimes(2); // event_type detail, then POST /invitees — no name-resolution sweep

    const [, postInit] = spy.mock.calls[1]!;
    const body = JSON.parse(String((postInit as RequestInit).body));
    expect(body.event_type).toBe("https://api.calendly.com/event_types/T1");
    expect(body.start_time).toBe("2026-08-18T15:00:00.000Z");
    expect(body.invitee).toEqual({ name: "Ada Lovelace", email: "ada@example.com", timezone: "America/New_York" });

    expect(out).toContain("event_uuid: E1");
    expect(out).toContain("Intro Call");
    expect(out).toContain("2026-08-18");
    expect(out).toContain("America/New_York");
    expect(out).toContain("ada@example.com");
    expect(out).toContain("https://calendly.com/cancellations/INV1");
    expect(out).toContain("https://calendly.com/reschedulings/INV1");
    expect(out).toContain("Calendly sent the standard confirmation notifications");
    expect(out).toContain("events view E1");
    expect(out).toContain("events cancel E1");
  });

  it("--timezone overrides the profile default", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE_DETAIL))
      .mockResolvedValueOnce(jsonResponse(INVITEE_RESOURCE));

    await bookCommand([...REQUIRED_ARGS, "--timezone", "America/Los_Angeles"]);

    const [, postInit] = spy.mock.calls[1]!;
    const body = JSON.parse(String((postInit as RequestInit).body));
    expect(body.invitee.timezone).toBe("America/Los_Angeles");
  });

  it("--location sends the parsed JSON kind object", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE_DETAIL))
      .mockResolvedValueOnce(jsonResponse(INVITEE_RESOURCE));

    await bookCommand([...REQUIRED_ARGS, "--location", '{"kind":"physical","location":"123 Main St"}']);

    const [, postInit] = spy.mock.calls[1]!;
    const body = JSON.parse(String((postInit as RequestInit).body));
    expect(body.location).toEqual({ kind: "physical", location: "123 Main St" });
  });

  it("invalid --location JSON fails VALIDATION_ERROR before booking", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(TYPE_DETAIL));
    await expect(bookCommand([...REQUIRED_ARGS, "--location", "not-json"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).toHaveBeenCalledTimes(1); // detail fetch happened, no POST
  });

  it("--guests sends a trimmed CSV as event_guests", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE_DETAIL))
      .mockResolvedValueOnce(jsonResponse(INVITEE_RESOURCE));

    const out = await bookCommand([...REQUIRED_ARGS, "--guests", "a@example.com, b@example.com"]);

    const [, postInit] = spy.mock.calls[1]!;
    const body = JSON.parse(String((postInit as RequestInit).body));
    expect(body.event_guests).toEqual(["a@example.com", "b@example.com"]);
    expect(out).toContain("a@example.com");
  });
});

describe("book: custom-question pre-validation", () => {
  const TYPE_WITH_QUESTIONS = {
    resource: {
      ...TYPE_DETAIL.resource,
      custom_questions: [
        { position: 0, name: "Company", type: "text", required: true },
        { position: 1, name: "Referral source", type: "text", required: false },
      ],
    },
  };

  it("missing a required answer fails VALIDATION_ERROR listing {position,name,required}, zero booking calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(TYPE_WITH_QUESTIONS));
    await expect(bookCommand(REQUIRED_ARGS)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).toHaveBeenCalledTimes(1); // detail fetch happened, no POST /invitees
    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(TYPE_WITH_QUESTIONS));
      await bookCommand(REQUIRED_ARGS);
      throw new Error("should have thrown");
    } catch (err) {
      const suggestions = (err as { suggestions: string[] }).suggestions.join(" ");
      expect(suggestions).toContain("position: 0");
      expect(suggestions).toContain("Company");
      expect(suggestions).toContain("required: true");
    }
  });

  it("an out-of-range --answer position fails VALIDATION_ERROR before booking", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(TYPE_WITH_QUESTIONS));
    await expect(
      bookCommand([...REQUIRED_ARGS, "--answer", "0=Acme", "--answer", "9=nope"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("repeated --answer flags accumulate (not last-wins) and map by position", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE_WITH_QUESTIONS))
      .mockResolvedValueOnce(jsonResponse(INVITEE_RESOURCE));

    await bookCommand([...REQUIRED_ARGS, "--answer", "0=Acme Inc", "--answer", "1=Referral"]);

    const [, postInit] = spy.mock.calls[1]!;
    const body = JSON.parse(String((postInit as RequestInit).body));
    expect(body.questions_and_answers).toEqual([
      { position: 0, answer: "Acme Inc" },
      { position: 1, answer: "Referral" },
    ]);
  });
});

describe("book: failure shapes", () => {
  it("409 on the booking call becomes CONFLICT suggesting `types slots`", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE_DETAIL))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ title: "Conflict", message: "slot no longer available" }), { status: 409 }),
      );
    try {
      await bookCommand(REQUIRED_ARGS);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("CONFLICT");
      expect((err as { suggestions: string[] }).suggestions.join(" ")).toContain("types slots T1");
    }
  });

  it("429 on the booking call quotes the booking-specific limits, not the general ones", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE_DETAIL))
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: "Too Many Requests" }), { status: 429 }));
    try {
      await bookCommand(REQUIRED_ARGS);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("RATE_LIMITED");
      const suggestions = (err as { suggestions: string[] }).suggestions.join(" ");
      expect(suggestions).toContain("10/min");
      expect(suggestions).toContain("50/hr");
      expect(suggestions).toContain("100/day");
    }
  });

  it("Free-plan 403 on the booking call becomes PLAN_REQUIRED naming Standard", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE_DETAIL))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ title: "Forbidden", message: "This feature requires a Standard plan or above" }),
          { status: 403 },
        ),
      );
    try {
      await bookCommand(REQUIRED_ARGS);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("PLAN_REQUIRED");
    }
  });

  it("never retries: a transient 500 on the booking call is surfaced after exactly one POST", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(TYPE_DETAIL))
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: "Server Error" }), { status: 500 }));
    await expect(bookCommand(REQUIRED_ARGS)).rejects.toMatchObject({ code: "SERVER_ERROR" });
    // event_type detail + exactly one POST /invitees — no retry duplicate.
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
