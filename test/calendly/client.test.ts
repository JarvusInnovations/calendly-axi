import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendlyRequest, getRateLimitInfo } from "../../src/calendly/client.js";
import type { Credentials } from "../../src/config.js";

const CREDS: Credentials = { token: "tok_abc", source: "config" };

beforeEach(() => {
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1";
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
});

function mockFetch(res: Response) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
}

describe("calendlyRequest", () => {
  it("injects exactly Authorization + User-Agent — no account-id header", async () => {
    const spy = mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await calendlyRequest("users/me", { credentials: CREDS });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe("https://api.calendly.com/users/me");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok_abc");
    expect(headers["User-Agent"]).toBe("calendly-axi (https://github.com/JarvusInnovations/calendly-axi)");
    expect(headers["Harvest-Account-Id"]).toBeUndefined();
  });

  it("URL-encodes query values, including full URIs", async () => {
    const spy = mockFetch(new Response(JSON.stringify({ collection: [], pagination: {} }), { status: 200 }));
    await calendlyRequest("scheduled_events", {
      credentials: CREDS,
      query: { user: "https://api.calendly.com/users/ABC123", count: 100 },
    });
    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain("user=https%3A%2F%2Fapi.calendly.com%2Fusers%2FABC123");
  });

  it("parses a successful JSON body", async () => {
    mockFetch(new Response(JSON.stringify({ resource: { name: "Chris" } }), { status: 200 }));
    const res = await calendlyRequest<{ resource: { name: string } }>("users/me", { credentials: CREDS });
    expect(res.resource.name).toBe("Chris");
  });

  it("returns an empty object for an empty (e.g. DELETE) response", async () => {
    mockFetch(new Response("", { status: 200 }));
    const res = await calendlyRequest("scheduled_events/x/cancellation", {
      method: "POST",
      credentials: CREDS,
    });
    expect(res).toEqual({});
  });

  it("throws TOKEN_INVALID (not configured) when no credentials are available", async () => {
    await expect(calendlyRequest("users/me")).rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });

  it("captures rate-limit headers", async () => {
    mockFetch(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "X-RateLimit-Limit": "500", "X-RateLimit-Remaining": "499", "X-RateLimit-Reset": "42" },
      }),
    );
    await calendlyRequest("users/me", { credentials: CREDS });
    expect(getRateLimitInfo()).toEqual({ limit: 500, remaining: 499, reset: 42 });
  });

  describe("error mapping", () => {
    it("translates 400 to VALIDATION_ERROR with details restated", async () => {
      mockFetch(
        new Response(
          JSON.stringify({
            title: "InvalidParameter",
            message: "invalid params",
            details: [{ parameter: "email", message: "is required" }],
          }),
          { status: 400 },
        ),
      );
      try {
        await calendlyRequest("scheduling_links", { method: "POST", body: {}, credentials: CREDS });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as { code: string }).code).toBe("VALIDATION_ERROR");
        expect((err as { message: string }).message).toContain("email");
      }
    });

    it("translates 401 to TOKEN_INVALID without leaking the raw body", async () => {
      mockFetch(new Response("private server stack trace", { status: 401 }));
      try {
        await calendlyRequest("users/me", { credentials: CREDS });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as { code: string }).code).toBe("TOKEN_INVALID");
        expect((err as { message: string }).message).not.toContain("stack trace");
      }
    });

    it("translates a scope-gated 403 (InsufficientScopeError) to FORBIDDEN naming the scope", async () => {
      mockFetch(
        new Response(
          JSON.stringify({ title: "InsufficientScopeError", message: "missing scope: webhooks:write" }),
          { status: 403 },
        ),
      );
      const err = await calendlyRequest("webhook_subscriptions", { method: "POST", body: {}, credentials: CREDS }).catch(
        (e) => e,
      );
      expect(err.code).toBe("FORBIDDEN");
      expect(err.message).toContain("scope");
      expect(err.suggestions.join(" ")).toContain("Regenerate");
    });

    it("translates a plan-gated 403 to PLAN_REQUIRED", async () => {
      mockFetch(
        new Response(JSON.stringify({ title: "Forbidden", message: "Please upgrade your plan" }), { status: 403 }),
      );
      const err = await calendlyRequest("invitees", { method: "POST", body: {}, credentials: CREDS }).catch((e) => e);
      expect(err.code).toBe("PLAN_REQUIRED");
    });

    it("translates a role-gated 403 to FORBIDDEN naming the role", async () => {
      mockFetch(
        new Response(JSON.stringify({ title: "Forbidden", message: "requires admin role" }), { status: 403 }),
      );
      const err = await calendlyRequest("organizations/x/event_types", { credentials: CREDS }).catch((e) => e);
      expect(err.code).toBe("FORBIDDEN");
      expect(err.message).toContain("role");
    });

    it("falls back to FORBIDDEN naming both possibilities for an ambiguous 403 body", async () => {
      mockFetch(new Response(JSON.stringify({ title: "Forbidden", message: "nope" }), { status: 403 }));
      const err = await calendlyRequest("webhook_subscriptions", { credentials: CREDS }).catch((e) => e);
      expect(err.code).toBe("FORBIDDEN");
      expect(err.suggestions.length).toBe(2);
    });

    it("translates 404 to NOT_FOUND", async () => {
      mockFetch(new Response(JSON.stringify({ title: "NotFound", message: "not found" }), { status: 404 }));
      await expect(calendlyRequest("event_types/xyz", { credentials: CREDS })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("translates 409 to CONFLICT", async () => {
      mockFetch(new Response(JSON.stringify({ title: "Conflict", message: "slot taken" }), { status: 409 }));
      await expect(
        calendlyRequest("invitees", { method: "POST", body: {}, credentials: CREDS }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("translates 429 to RATE_LIMITED, quoting X-RateLimit-Reset", async () => {
      mockFetch(new Response("", { status: 429, headers: { "X-RateLimit-Reset": "17" } }));
      const err = await calendlyRequest("scheduled_events", { credentials: CREDS }).catch((e) => e);
      expect(err.code).toBe("RATE_LIMITED");
      expect(err.suggestions.join(" ")).toContain("17");
    });

    it("translates 5xx to SERVER_ERROR", async () => {
      mockFetch(new Response("", { status: 502 }));
      await expect(calendlyRequest("users/me", { credentials: CREDS })).rejects.toMatchObject({
        code: "SERVER_ERROR",
      });
    });

    it("never leaks a raw JSON error body in the message", async () => {
      mockFetch(new Response(JSON.stringify({ status: 404, error: "Not Found" }), { status: 404 }));
      const err = await calendlyRequest("event_types/xyz", { credentials: CREDS }).catch((e) => e);
      expect(err.message).not.toContain("{");
    });
  });
});
