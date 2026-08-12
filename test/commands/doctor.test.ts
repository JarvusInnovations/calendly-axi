import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doctorCommand } from "../../src/commands/doctor.js";
import { writeConfig } from "../../src/config.js";

function jsonResponse(obj: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(obj), { status, headers });
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
const ORG = { resource: { uri: "https://api.calendly.com/organizations/ORG789", name: "Jarvus" } };
const RATE_HEADERS = { "X-RateLimit-Limit": "500", "X-RateLimit-Remaining": "499", "X-RateLimit-Reset": "42" };

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "calendly-axi-home-"));
  vi.stubEnv("HOME", home);
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1"; // hooks check reports "skipped" — isolated per-test below
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
  delete process.env.CALENDLY_ACCESS_TOKEN;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
  delete process.env.CALENDLY_ACCESS_TOKEN;
  process.exitCode = 0;
});

function seedConfiguredCache() {
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

describe("doctor: credentials check", () => {
  it("fails fast with no live calls when no credentials are configured", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const out = await doctorCommand([]);
    expect(out).toContain("healthy: false");
    expect(out).toMatch(/credentials,fail/);
    expect(out).toMatch(/token,skipped/);
    expect(out).toMatch(/organization,skipped/);
    expect(spy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("doctor: token check", () => {
  it("fails the token check and skips organization when users/me fails", async () => {
    seedConfiguredCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 401 }));
    const out = await doctorCommand([]);
    expect(out).toContain("healthy: false");
    expect(out).toMatch(/token,fail/);
    expect(out).toMatch(/organization,skipped/);
    expect(process.exitCode).toBe(1);
  });
});

describe("doctor: organization check", () => {
  it("fails only the organization check when the org fetch fails", async () => {
    seedConfiguredCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME, 200, RATE_HEADERS))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    const out = await doctorCommand([]);
    expect(out).toContain("healthy: false");
    expect(out).toMatch(/token,ok/);
    expect(out).toMatch(/organization,fail/);
    expect(process.exitCode).toBe(1);
  });
});

describe("doctor: healthy path", () => {
  it("reports all ok plus rate-limit headroom on a fully healthy setup", async () => {
    seedConfiguredCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME, 200, RATE_HEADERS))
      .mockResolvedValueOnce(jsonResponse(ORG, 200, RATE_HEADERS));
    const out = await doctorCommand([]);
    expect(out).toContain("healthy: true");
    expect(out).toMatch(/credentials,ok/);
    expect(out).toMatch(/token,ok/);
    expect(out).toMatch(/organization,ok/);
    expect(out).toMatch(/rate-limit headroom,ok,499\/500 remaining/);
    expect(process.exitCode).toBe(0);
  });

  it("flags the Free-tier 50/min ceiling when the limit header reports it", async () => {
    seedConfiguredCache();
    const freeHeaders = { "X-RateLimit-Limit": "50", "X-RateLimit-Remaining": "12", "X-RateLimit-Reset": "9" };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME, 200, freeHeaders))
      .mockResolvedValueOnce(jsonResponse(ORG, 200, freeHeaders));
    const out = await doctorCommand([]);
    expect(out).toContain("Free-tier ceiling");
  });
});

describe("doctor: hooks check", () => {
  it("reports skipped when CALENDLY_AXI_DISABLE_HOOKS=1 is set", async () => {
    seedConfiguredCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(jsonResponse(ORG));
    const out = await doctorCommand([]);
    expect(out).toMatch(/hooks,skipped/);
  });

  it("fails the hooks check alone when hooks are enabled but nothing is installed", async () => {
    delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
    seedConfiguredCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(jsonResponse(ORG));
    const out = await doctorCommand([]);
    expect(out).toMatch(/credentials,ok/);
    expect(out).toMatch(/token,ok/);
    expect(out).toMatch(/organization,ok/);
    expect(out).toMatch(/hooks,fail/);
    expect(out).toContain("healthy: false");
    expect(process.exitCode).toBe(1);
  });

  it("passes the hooks check when installed and pointing at the current executable", async () => {
    delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
    seedConfiguredCache();
    const { realpathSync, symlinkSync } = await import("node:fs");
    const symlinkPath = join(home, "calendly-axi");
    symlinkSync(realpathSync(resolve(process.argv[1] ?? "")), symlinkPath);
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [{ matcher: "", hooks: [{ type: "command", command: symlinkPath, timeout: 10 }] }],
          },
        },
        null,
        2,
      ),
    );
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(jsonResponse(ORG));
    const out = await doctorCommand([]);
    expect(out).toMatch(/hooks,ok/);
    expect(out).toContain("healthy: true");
    expect(process.exitCode).toBe(0);
  });
});

describe("doctor: flags", () => {
  it("rejects an unknown flag", async () => {
    await expect(doctorCommand(["--nope"])).rejects.toMatchObject({ code: "UNKNOWN_FLAG" });
  });
});
