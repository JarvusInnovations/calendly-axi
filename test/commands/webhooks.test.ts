import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webhooksCommand } from "../../src/commands/webhooks.js";
import { configPath, writeConfig } from "../../src/config.js";

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status });
}

function page(items: unknown[], nextToken: string | null = null) {
  return jsonResponse({ collection: items, pagination: { count: items.length, next_page_token: nextToken } });
}

const ORG_URI = "https://api.calendly.com/organizations/ORG789";
const SELF_URI = "https://api.calendly.com/users/ABC123";

function seedProfile() {
  writeConfig({
    version: 1,
    token: "tok_abc",
    profile_cache: {
      user_uri: SELF_URI,
      user_uuid: "ABC123",
      name: "Chris Alfano",
      email: "chris@jarv.us",
      scheduling_url: "https://calendly.com/chris",
      timezone: "America/New_York",
      organization_uri: ORG_URI,
      organization_uuid: "ORG789",
      cached_at: new Date().toISOString(),
    },
  });
}

function webhookResource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uri: "https://api.calendly.com/webhook_subscriptions/WH123",
    callback_url: "https://example.com/hook",
    created_at: "2026-01-01T00:00:00Z",
    state: "active",
    events: ["invitee.created", "invitee.canceled"],
    scope: "organization",
    organization: ORG_URI,
    creator: SELF_URI,
    ...overrides,
  };
}

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

describe("webhooks list", () => {
  it("defaults to organization scope over the cached org, drains the cursor", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page([webhookResource()]));
    const out = await webhooksCommand([]);
    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain("scope=organization");
    expect(String(url)).toContain(`organization=${encodeURIComponent(ORG_URI)}`);
    expect(String(url)).not.toContain("user=");
    expect(out).toContain("complete: true");
    expect(out).toContain("WH123");
    expect(out).toContain("invitee.created,invitee.canceled");
  });

  it("--scope user defaults --user to self", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page([]));
    const out = await webhooksCommand(["list", "--scope", "user"]);
    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain("scope=user");
    expect(String(url)).toContain(`user=${encodeURIComponent(SELF_URI)}`);
    expect(out).toContain("0 webhook subscriptions for scope=user");
  });

  it("--scope group resolves --group (bare uuid) to a full groups URI", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page([]));
    await webhooksCommand(["list", "--scope", "group", "--group", "GRP1"]);
    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain("scope=group");
    expect(String(url)).toContain(
      `group=${encodeURIComponent("https://api.calendly.com/groups/GRP1")}`,
    );
  });

  it("--scope group without --group is a client-side validation error, zero API calls", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(webhooksCommand(["list", "--scope", "group"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("--user without --scope user is rejected client-side", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(webhooksCommand(["list", "--user", "someone@example.com"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an invalid --scope value", async () => {
    seedProfile();
    await expect(webhooksCommand(["list", "--scope", "bogus"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("webhooks view", () => {
  it("renders full detail, accepting a bare uuid or a full uri", async () => {
    seedProfile();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ resource: webhookResource() }));
    const out = await webhooksCommand(["view", "WH123"]);
    expect(out).toContain("uuid: WH123");
    expect(out).toContain("callback_url");
    expect(out).toContain("https://example.com/hook");
    expect(out).toContain("state: active");
    expect(out).not.toContain("help[");
  });

  it("states plainly when retry_started_at is present — deliveries are failing", async () => {
    seedProfile();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ resource: webhookResource({ retry_started_at: "2026-08-01T00:00:00Z" }) }),
    );
    const out = await webhooksCommand(["view", "WH123"]);
    expect(out.toLowerCase()).toContain("failing");
  });
});

describe("webhooks create", () => {
  it("creates and renders detail, suggesting `sample`", async () => {
    seedProfile();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ resource: webhookResource() }, 201));
    const out = await webhooksCommand([
      "create",
      "--url",
      "https://example.com/hook",
      "--events",
      "invitee.created,invitee.canceled",
    ]);
    expect(out).toContain("WH123");
    expect(out).toContain("webhooks sample --event invitee.created");
  });

  it("rejects a non-https --url client-side, zero API calls", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(
      webhooksCommand(["create", "--url", "http://example.com/hook", "--events", "invitee.created"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an unknown event, listing valid events, zero API calls", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch");
    const err = await webhooksCommand([
      "create",
      "--url",
      "https://example.com/hook",
      "--events",
      "invitee.created,not_a_real_event",
    ]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.suggestions.join(" ")).toContain("invitee.created");
    expect(err.suggestions.join(" ")).toContain("contact.deleted");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects meeting_recap.* under the default organization scope, zero API calls", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch");
    const err = await webhooksCommand([
      "create",
      "--url",
      "https://example.com/hook",
      "--events",
      "meeting_recap.created",
    ]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("--scope user");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects routing_form_submission.created under user scope, zero API calls", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch");
    const err = await webhooksCommand([
      "create",
      "--url",
      "https://example.com/hook",
      "--events",
      "routing_form_submission.created",
      "--scope",
      "user",
    ]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("--scope organization");
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows meeting_recap.* under --scope user", async () => {
    seedProfile();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ resource: webhookResource({ scope: "user", user: SELF_URI }) }, 201),
    );
    const out = await webhooksCommand([
      "create",
      "--url",
      "https://example.com/hook",
      "--events",
      "meeting_recap.created",
      "--scope",
      "user",
    ]);
    expect(out).toContain("WH123");
  });

  it("409 duplicate: fetches and reports the existing subscription as a no-op, exit 0", async () => {
    seedProfile();
    const existing = webhookResource({ uri: "https://api.calendly.com/webhook_subscriptions/EXISTING" });
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ title: "Conflict", message: "already subscribed" }, 409))
      .mockResolvedValueOnce(page([existing]));
    const out = await webhooksCommand([
      "create",
      "--url",
      "https://example.com/hook",
      "--events",
      "invitee.created",
    ]);
    expect(out).toContain("already subscribed (no-op)");
    expect(out).toContain("EXISTING");
    expect(process.exitCode).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("--signing-key is passed through to the API but never written to config", async () => {
    seedProfile();
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.signing_key).toBe("shh_super_secret");
      return jsonResponse({ resource: webhookResource() }, 201);
    });
    await webhooksCommand([
      "create",
      "--url",
      "https://example.com/hook",
      "--events",
      "invitee.created",
      "--signing-key",
      "shh_super_secret",
    ]);
    if (existsSync(configPath())) {
      const raw = readFileSync(configPath(), "utf-8");
      expect(raw).not.toContain("shh_super_secret");
    }
  });

  it("plan-gate 403 rides the client's translation (PLAN_REQUIRED)", async () => {
    seedProfile();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ title: "Forbidden", message: "This feature requires a paid plan, please upgrade" }, 403),
    );
    await expect(
      webhooksCommand(["create", "--url", "https://example.com/hook", "--events", "invitee.created"]),
    ).rejects.toMatchObject({ code: "PLAN_REQUIRED" });
  });
});

describe("webhooks delete", () => {
  it("deletes by uuid", async () => {
    seedProfile();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 204 }));
    const out = await webhooksCommand(["delete", "WH123"]);
    expect(out).toContain("deleted");
    expect(process.exitCode).toBe(0);
  });

  it("is idempotent: already-gone (404) is a no-op, exit 0", async () => {
    seedProfile();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 404 }));
    const out = await webhooksCommand(["delete", "WH123"]);
    expect(out).toContain("already gone (no-op)");
    expect(process.exitCode).toBe(0);
  });
});

describe("webhooks sample", () => {
  it("fetches and renders a sample payload as a JSON block", async () => {
    seedProfile();
    // The live endpoint returns the delivery envelope unwrapped — no
    // `resource` wrapper (specs/api/webhooks.md, confirmed live).
    const payload = { event: "invitee.created", created_at: "2026-08-11T00:00:00Z", payload: { invitee: { name: "Ada Lovelace" } } };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(payload));
    const out = await webhooksCommand(["sample", "--event", "invitee.created"]);
    expect(out).toContain("event: invitee.created");
    expect(out).toContain("Ada Lovelace");
  });

  it("caps an enormous payload with a total-size note", async () => {
    seedProfile();
    const huge = { event: "invitee.created", blob: "x".repeat(10_000) };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(huge));
    const out = await webhooksCommand(["sample", "--event", "invitee.created"]);
    expect(out).toContain("truncated");
    expect(out).toMatch(/of \d+ chars total/);
  });

  it("rejects an unknown event, zero API calls", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(webhooksCommand(["sample", "--event", "not_a_real_event"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects meeting_recap.* under the default organization scope, zero API calls", async () => {
    seedProfile();
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(webhooksCommand(["sample", "--event", "meeting_recap.created"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
