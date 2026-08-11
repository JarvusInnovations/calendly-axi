import { describe, expect, it } from "vitest";
import {
  isUri,
  kindFromUri,
  resolveIdentifier,
  uriFromUuid,
  uuidFromUri,
} from "../../src/calendly/ids.js";

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
