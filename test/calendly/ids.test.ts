import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isUri,
  kindFromUri,
  resolveEventTypeIdentifier,
  resolveIdentifier,
  uriFromUuid,
  uuidFromUri,
} from "../../src/calendly/ids.js";

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status });
}

describe("isUri", () => {
  it("distinguishes URIs from bare UUIDs", () => {
    expect(isUri("https://api.calendly.com/users/ABC123")).toBe(true);
    expect(isUri("ABC123XYZ")).toBe(false);
  });
});

describe("uuidFromUri / kindFromUri", () => {
  it("extracts the last path segment as the uuid", () => {
    expect(uuidFromUri("https://api.calendly.com/event_types/GBGBDCAADAEDCRZ2")).toBe(
      "GBGBDCAADAEDCRZ2",
    );
  });

  it("tolerates a trailing slash", () => {
    expect(uuidFromUri("https://api.calendly.com/event_types/GBGB/")).toBe("GBGB");
  });

  it("extracts the resource-kind segment", () => {
    expect(kindFromUri("https://api.calendly.com/event_types/GBGB")).toBe("event_types");
  });
});

describe("uriFromUuid", () => {
  it("builds a full URI from a bare uuid and kind", () => {
    expect(uriFromUuid("users", "ABC123")).toBe("https://api.calendly.com/users/ABC123");
  });
});

describe("resolveIdentifier", () => {
  it("expands a bare UUID into both forms", () => {
    const { uuid, uri } = resolveIdentifier("event_types", "GBGB123");
    expect(uuid).toBe("GBGB123");
    expect(uri).toBe("https://api.calendly.com/event_types/GBGB123");
  });

  it("accepts a matching-kind URI verbatim, extracting the uuid", () => {
    const { uuid, uri } = resolveIdentifier(
      "event_types",
      "https://api.calendly.com/event_types/GBGB123",
    );
    expect(uuid).toBe("GBGB123");
    expect(uri).toBe("https://api.calendly.com/event_types/GBGB123");
  });

  it("rejects a URI of the wrong kind with VALIDATION_ERROR naming both kinds", () => {
    try {
      resolveIdentifier("event_types", "https://api.calendly.com/users/ABC123");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("VALIDATION_ERROR");
      const message = (err as { message: string }).message;
      expect(message).toContain("users");
      expect(message).toContain("event_types");
    }
  });
});

describe("resolveEventTypeIdentifier", () => {
  beforeEach(() => {
    process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
    process.env.CALENDLY_ACCESS_TOKEN = "test_tok";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.CALENDLY_ACCESS_TOKEN;
  });

  it("resolves a bare legacy token directly, no API call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { uuid, uri } = await resolveEventTypeIdentifier("GBGB123", {});
    expect(uuid).toBe("GBGB123");
    expect(uri).toBe("https://api.calendly.com/event_types/GBGB123");
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves a canonical lowercase dashed UUID directly, no API call", async () => {
    // Live accounts carry this shape for most event types — a lowercase
    // UUID must never be misrouted through the name sweep.
    const spy = vi.spyOn(globalThis, "fetch");
    const { uuid, uri } = await resolveEventTypeIdentifier("4fce2d6b-c166-4d77-aeae-497a6945a41f", {});
    expect(uuid).toBe("4fce2d6b-c166-4d77-aeae-497a6945a41f");
    expect(uri).toBe("https://api.calendly.com/event_types/4fce2d6b-c166-4d77-aeae-497a6945a41f");
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves a matching-kind URI directly, no API call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { uuid } = await resolveEventTypeIdentifier("https://api.calendly.com/event_types/GBGB123", {});
    expect(uuid).toBe("GBGB123");
    expect(spy).not.toHaveBeenCalled();
  });

  it("an exact case-insensitive name match wins over a substring match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [
          { uri: "https://api.calendly.com/event_types/T1", name: "30 Minute Meeting Extended" },
          { uri: "https://api.calendly.com/event_types/T2", name: "30 minute meeting" },
        ],
        pagination: { count: 2, next_page_token: null },
      }),
    );
    const { uuid } = await resolveEventTypeIdentifier("30 Minute Meeting", {
      user: "https://api.calendly.com/users/ABC123",
    });
    expect(uuid).toBe("T2");
  });

  it("falls back to a substring match when no exact match exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [{ uri: "https://api.calendly.com/event_types/T1", name: "30 Minute Meeting Extended" }],
        pagination: { count: 1, next_page_token: null },
      }),
    );
    const { uuid } = await resolveEventTypeIdentifier("30 Minute Meeting", {});
    expect(uuid).toBe("T1");
  });

  it("throws NOT_FOUND suggesting `types list` on zero hits", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ collection: [], pagination: { count: 0, next_page_token: null } }),
    );
    const err = await resolveEventTypeIdentifier("Nonexistent Meeting", {}).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.suggestions.join(" ")).toContain("types list");
  });

  it("throws VALIDATION_ERROR listing <uuid> (<name>) candidates on an ambiguous match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [
          { uri: "https://api.calendly.com/event_types/T1", name: "30 Minute Meeting" },
          { uri: "https://api.calendly.com/event_types/T2", name: "30 Minute Meeting (Extended)" },
        ],
        pagination: { count: 2, next_page_token: null },
      }),
    );
    const err = await resolveEventTypeIdentifier("Meeting", {}).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.suggestions).toEqual(
      expect.arrayContaining(["T1 (30 Minute Meeting)", "T2 (30 Minute Meeting (Extended))"]),
    );
  });
});
