import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProfile, resolveScope, resolveSelf } from "../../src/calendly/scope.js";
import { writeConfig, type Credentials } from "../../src/config.js";

const CREDS: Credentials = { token: "tok_abc", source: "config" };

const ME = {
  resource: {
    uri: "https://api.calendly.com/users/ABC123",
    name: "Chris Alfano",
    email: "chris@jarv.us",
    scheduling_url: "https://calendly.com/chris",
    timezone: "America/New_York",
    current_organization: "https://api.calendly.com/organizations/ORG789",
  },
};

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status });
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

describe("fetchProfile", () => {
  it("shapes users/me into a ProfileCache using current_organization", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(ME));
    const profile = await fetchProfile(CREDS);
    expect(profile).toMatchObject({
      user_uri: "https://api.calendly.com/users/ABC123",
      user_uuid: "ABC123",
      name: "Chris Alfano",
      email: "chris@jarv.us",
      scheduling_url: "https://calendly.com/chris",
      timezone: "America/New_York",
      organization_uri: "https://api.calendly.com/organizations/ORG789",
      organization_uuid: "ORG789",
    });
    expect(typeof profile.cached_at).toBe("string");
  });

  it("falls back to organization_memberships when current_organization is absent", async () => {
    const meNoOrg = { resource: { ...ME.resource, current_organization: undefined } };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(meNoOrg))
      .mockResolvedValueOnce(
        jsonResponse({
          collection: [
            {
              uri: "https://api.calendly.com/organization_memberships/MEMBER1",
              organization: "https://api.calendly.com/organizations/FALLBACK",
              user: { uri: "https://api.calendly.com/users/ABC123" },
            },
          ],
        }),
      );
    const profile = await fetchProfile(CREDS);
    expect(profile.organization_uri).toBe("https://api.calendly.com/organizations/FALLBACK");
    expect(profile.organization_uuid).toBe("FALLBACK");
  });

  it("throws SERVER_ERROR when neither current_organization nor a membership is found", async () => {
    const meNoOrg = { resource: { ...ME.resource, current_organization: undefined } };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(meNoOrg))
      .mockResolvedValueOnce(jsonResponse({ collection: [] }));
    await expect(fetchProfile(CREDS)).rejects.toMatchObject({ code: "SERVER_ERROR" });
  });
});

describe("resolveSelf", () => {
  it("returns the cached profile without an API call when config has one", async () => {
    writeConfig({
      version: 1,
      token: "tok",
      profile_cache: {
        user_uri: "https://api.calendly.com/users/CACHED",
        user_uuid: "CACHED",
        name: "Cached User",
        email: "cached@example.com",
        scheduling_url: "https://calendly.com/cached",
        timezone: "UTC",
        organization_uri: "https://api.calendly.com/organizations/ORG",
        organization_uuid: "ORG",
        cached_at: new Date().toISOString(),
      },
    });
    const spy = vi.spyOn(globalThis, "fetch");
    const self = await resolveSelf(CREDS);
    expect(self.name).toBe("Cached User");
    expect(spy).not.toHaveBeenCalled();
  });

  it("bootstraps via users/me per call, without writing config, when no cache exists", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(jsonResponse(ME));
    const self = await resolveSelf(CREDS);
    expect(self.name).toBe("Chris Alfano");
    expect(spy).toHaveBeenCalledTimes(1);
    // Bootstrap must not persist — a second call bootstraps again (still uncached).
    await resolveSelf(CREDS);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("resolveScope", () => {
  function seedCache() {
    writeConfig({
      version: 1,
      token: "tok",
      profile_cache: {
        user_uri: "https://api.calendly.com/users/SELF",
        user_uuid: "SELF",
        name: "Self",
        email: "self@example.com",
        scheduling_url: "https://calendly.com/self",
        timezone: "UTC",
        organization_uri: "https://api.calendly.com/organizations/ORG",
        organization_uuid: "ORG",
        cached_at: new Date().toISOString(),
      },
    });
  }

  it("defaults to the cached self as user scope", async () => {
    seedCache();
    const scope = await resolveScope({}, CREDS);
    expect(scope).toEqual({ user: "https://api.calendly.com/users/SELF" });
  });

  it("--org widens to organization scope with no user param", async () => {
    seedCache();
    const scope = await resolveScope({ org: true }, CREDS);
    expect(scope).toEqual({ organization: "https://api.calendly.com/organizations/ORG" });
  });

  it("--user <uuid> resolves via resolveIdentifier, not organization_memberships", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch");
    const scope = await resolveScope({ user: "OTHERUUID" }, CREDS);
    expect(scope).toEqual({ user: "https://api.calendly.com/users/OTHERUUID" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("--org combined with --user sends both params", async () => {
    seedCache();
    const scope = await resolveScope({ org: true, user: "https://api.calendly.com/users/OTHERUUID" }, CREDS);
    expect(scope).toEqual({
      organization: "https://api.calendly.com/organizations/ORG",
      user: "https://api.calendly.com/users/OTHERUUID",
    });
  });

  it("--user <email> resolves via organization_memberships scoped to the cached org", async () => {
    seedCache();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [{ uri: "m1", organization: "org", user: { uri: "https://api.calendly.com/users/FOUND" } }],
      }),
    );
    const scope = await resolveScope({ user: "someone@example.com" }, CREDS);
    expect(scope).toEqual({ user: "https://api.calendly.com/users/FOUND" });
    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain("organization_memberships");
    expect(String(url)).toContain("email=someone%40example.com");
  });

  it("--user <email> with zero hits throws NOT_FOUND", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ collection: [] }));
    await expect(resolveScope({ user: "nobody@example.com" }, CREDS)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("--user <email> with multiple hits throws VALIDATION_ERROR listing candidates", async () => {
    seedCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        collection: [
          { uri: "m1", organization: "org", user: { uri: "https://api.calendly.com/users/A", name: "A" } },
          { uri: "m2", organization: "org", user: { uri: "https://api.calendly.com/users/B", name: "B" } },
        ],
      }),
    );
    const err = await resolveScope({ user: "dup@example.com" }, CREDS).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.suggestions).toHaveLength(2);
  });

  it("bootstraps self once (unpersisted) when no cache exists yet", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(ME));
    const scope = await resolveScope({}, CREDS);
    expect(scope).toEqual({ user: "https://api.calendly.com/users/ABC123" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
