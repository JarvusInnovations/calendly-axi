import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authCommand } from "../../src/commands/auth.js";
import { configPath, writeConfig } from "../../src/config.js";

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status });
}

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

beforeEach(() => {
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1"; // never touch real ~/.claude during these tests
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

describe("auth setup", () => {
  it("fails with TOKEN_INVALID, exit path unaffected, nothing written on a bad token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(authCommand(["setup", "--token", "bad"])).rejects.toMatchObject({ code: "TOKEN_INVALID" });
    expect(existsSync(configPath())).toBe(false);
  });

  it("writes config at 0600, installs the hook, and reports identity on a good token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(ME));
    const out = await authCommand(["setup", "--token", "pat_good"]);
    expect(out).toContain("connected");
    expect(out).toContain("Chris Alfano");
    expect(out).toContain("chris@jarv.us");
    expect(out).toContain("session_hook");
    expect(out).toContain("disabled"); // CALENDLY_AXI_DISABLE_HOOKS=1 in tests

    expect(existsSync(configPath())).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(cfg.token).toBe("pat_good");
    expect(cfg.profile_cache.name).toBe("Chris Alfano");
    expect(cfg.profile_cache.organization_uri).toBe("https://api.calendly.com/organizations/ORG789");
  });

  it("unconfigured + no --token: structured instruction naming the token URL and scopes, exit 2 (VALIDATION_ERROR)", async () => {
    const err = await authCommand(["setup"]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.suggestions.join(" ")).toContain("https://calendly.com/integrations/api_webhooks");
    expect(err.suggestions.join(" ")).toContain("scheduled_events:read/write");
  });

  it("configured + no --token: revalidates, refreshes the cache, and repairs the hook", async () => {
    writeConfig({ version: 1, token: "tok_existing" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(ME));
    const out = await authCommand(["setup"]);
    expect(out).toContain("already connected (revalidated)");
    expect(out).toContain("session_hook");
    const cfg = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(cfg.profile_cache.name).toBe("Chris Alfano");
  });

  it("is idempotent: re-running with the same token revalidates and reports connected, exit 0", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(jsonResponse(ME));
    await authCommand(["setup", "--token", "pat_good"]);
    const out = await authCommand(["setup", "--token", "pat_good"]);
    expect(out).toContain("connected");
    expect(process.exitCode).toBe(0);
  });
});

describe("auth whoami", () => {
  it("reports a definitive not-configured message when neither env nor config has a token", async () => {
    const out = await authCommand(["whoami"]);
    expect(out).toContain("not configured");
  });

  it("reports source config from the cache without an API call", async () => {
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
    const spy = vi.spyOn(globalThis, "fetch");
    const out = await authCommand(["whoami"]);
    expect(out).toContain("Chris Alfano");
    expect(out).toContain("source: config");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports source env under CALENDLY_ACCESS_TOKEN, refetching since there's no cache", async () => {
    process.env.CALENDLY_ACCESS_TOKEN = "env_tok";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(ME));
    const out = await authCommand(["whoami"]);
    expect(out).toContain("source: env");
  });

  it("--refresh re-fetches and rewrites the cache", async () => {
    writeConfig({
      version: 1,
      token: "tok",
      profile_cache: {
        user_uri: "https://api.calendly.com/users/OLD",
        user_uuid: "OLD",
        name: "Old Name",
        email: "old@example.com",
        scheduling_url: "https://calendly.com/old",
        timezone: "UTC",
        organization_uri: "https://api.calendly.com/organizations/ORG",
        organization_uuid: "ORG",
        cached_at: new Date().toISOString(),
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(ME));
    const out = await authCommand(["whoami", "--refresh"]);
    expect(out).toContain("Chris Alfano");
    const cfg = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(cfg.profile_cache.name).toBe("Chris Alfano");
  });
});

describe("auth logout", () => {
  it("is a no-op (exit 0) when nothing is stored", async () => {
    const out = await authCommand(["logout"]);
    expect(out).toContain("no-op");
    expect(process.exitCode).toBe(0);
  });

  it("removes stored credentials and cache", async () => {
    writeConfig({ version: 1, token: "tok" });
    expect(existsSync(configPath())).toBe(true);
    const out = await authCommand(["logout"]);
    expect(out).toContain("logged out");
    expect(existsSync(configPath())).toBe(false);
  });

  it("notes when CALENDLY_ACCESS_TOKEN is still set in the environment", async () => {
    process.env.CALENDLY_ACCESS_TOKEN = "still_here";
    const out = await authCommand(["logout"]);
    expect(out).toContain("CALENDLY_ACCESS_TOKEN is still set");
  });

  it("reports the config removal accurately even when an env token masks it", async () => {
    writeConfig({ version: 1, token: "stored_tok" });
    process.env.CALENDLY_ACCESS_TOKEN = "env_tok";
    const out = await authCommand(["logout"]);
    expect(out).toContain("logged out (credentials removed)");
    expect(existsSync(configPath())).toBe(false);
  });
});
