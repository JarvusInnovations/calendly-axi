import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authCommand } from "../../src/commands/auth.js";
import { configPath, writeConfig } from "../../src/config.js";

// What a `--token-stdin` read of fd 0 returns in-process (undefined = a read
// of fd 0 is a test failure), and how many times fd 0 was read at all.
const stdin = vi.hoisted(() => ({ content: undefined as string | undefined, reads: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((path: unknown, ...rest: unknown[]) => {
    if (path === 0) {
      stdin.reads++;
      if (stdin.content === undefined) throw new Error("stdin was read without --token-stdin");
      return stdin.content;
    }
    return (actual.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.readFileSync;
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

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
  stdin.content = undefined;
  stdin.reads = 0;
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

  it("writes config at 0600 and reports identity plus the hook state on a good token", async () => {
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

  it("configured + no --token: revalidates and refreshes the cache", async () => {
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

describe("auth setup never installs the session hook", () => {
  let home: string;

  beforeEach(() => {
    // Hooks enabled, with HOME somewhere disposable: if `auth setup` still
    // installed anything, it would land here and the assertions would see it.
    home = mkdtempSync(join(tmpdir(), "calendly-axi-home-"));
    vi.stubEnv("HOME", home);
    delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  function expectNothingInstalled() {
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(existsSync(join(home, ".codex"))).toBe(false);
    expect(existsSync(join(home, ".config", "opencode"))).toBe(false);
    expect(readdirSync(home)).toEqual([]);
  }

  it("the connect path reports the hook read-only and hints `setup hooks`", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(ME));
    const out = await authCommand(["setup", "--token", "pat_good"]);
    expect(out).toContain("status: connected");
    expect(out).toContain("session_hook: not installed");
    expect(out).toContain("calendly-axi setup hooks");
    expectNothingInstalled();
  });

  it("the revalidate path does not install it either", async () => {
    writeConfig({ version: 1, token: "tok_existing" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(ME));
    const out = await authCommand(["setup"]);
    expect(out).toContain("already connected (revalidated)");
    expect(out).toContain("session_hook: not installed");
    expectNothingInstalled();
  });
});

describe("auth setup token channels", () => {
  it("--token-stdin stores the piped token, minus its trailing newline", async () => {
    stdin.content = "pat_piped\n";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(ME));
    const out = await authCommand(["setup", "--token-stdin"]);
    expect(out).toContain("status: connected");
    expect(out).not.toContain("pat_piped"); // never echoed
    expect(JSON.parse(readFileSync(configPath(), "utf-8")).token).toBe("pat_piped");
    const headers = new Headers(fetchSpy.mock.calls[0]![1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer pat_piped");
  });

  it("empty stdin is USAGE with the pipe example, and nothing is requested or written", async () => {
    stdin.content = "\n";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const err = await authCommand(["setup", "--token-stdin"]).catch((e) => e);
    expect(err.code).toBe("USAGE");
    expect(err.message).toContain("stdin carried no token");
    expect(err.suggestions.join(" ")).toContain("| calendly-axi auth setup --token-stdin");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(configPath())).toBe(false);
  });

  it("--token with --token-stdin is USAGE, before stdin is touched", async () => {
    stdin.content = "pat_piped\n";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const err = await authCommand(["setup", "--token", "pat_arg", "--token-stdin"]).catch((e) => e);
    expect(err.code).toBe("USAGE");
    expect(err.message).toContain("mutually exclusive");
    expect(stdin.reads).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stdin is never read unless --token-stdin asks for it", async () => {
    // stdin.content stays undefined, so any read of fd 0 would throw.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(ME));
    await authCommand(["setup", "--token", "pat_good"]);
    await authCommand(["setup"]); // revalidate
    await authCommand(["whoami", "--refresh"]);
    await authCommand(["logout"]);
    await authCommand(["setup"]).catch(() => undefined); // unconfigured instruction
    expect(stdin.reads).toBe(0);
  });

  it("the unconfigured instruction leads with the stdin pipe and names the env var, not --token <pat>", async () => {
    const err = await authCommand(["setup"]).catch((e) => e);
    const hints = err.suggestions.join(" | ");
    expect(hints).toContain(`read -rs T && printf %s "$T" | calendly-axi auth setup --token-stdin`);
    expect(hints).toContain("CALENDLY_ACCESS_TOKEN");
    expect(hints).not.toContain("--token <pat>");
  });

  it("whoami's not-configured hint shows the stdin form", async () => {
    const out = await authCommand(["whoami"]);
    expect(out).toContain("auth setup --token-stdin");
    expect(out).not.toContain("--token <pat>");
  });

  it("rejects a stray positional instead of dropping it", async () => {
    writeConfig({ version: 1, token: "tok" });
    await expect(authCommand(["logout", "extra"])).rejects.toMatchObject({ code: "USAGE" });
    expect(existsSync(configPath())).toBe(true); // the logout did not run
  });
});

/**
 * The same contract through the real binary and a real pipe. Needs the `tsc`
 * build (`bun run build`; CI builds before it tests), so it is skipped when
 * `dist/` is absent. The child gets its own HOME and config dir, and a
 * preloaded `fetch` stub, so it touches neither the network nor the real home.
 */
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BUILT_BIN = join(REPO_ROOT, "dist", "bin", "calendly-axi.js");
const FETCH_STUB = join(REPO_ROOT, "test", "helpers", "stub-users-me.mjs");

interface Run {
  code: number | null;
  stdout: string;
  timedOut: boolean;
}

function runBuilt(args: string[], home: string, input: string | "keep-open"): Promise<Run> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", FETCH_STUB, BUILT_BIN, ...args], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        CALENDLY_AXI_CONFIG_DIR: join(home, "config"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.on("error", reject);
    // A process that waits on a stdin nobody closes would sit here forever.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 45_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, timedOut });
    });
    if (input !== "keep-open") child.stdin.end(input);
  });
}

describe.skipIf(!existsSync(BUILT_BIN))("auth setup --token-stdin through the built binary", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "calendly-axi-home-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("stores a token piped on stdin and installs no hook", async () => {
    const run = await runBuilt(["auth", "setup", "--token-stdin"], home, "pat_piped\n");
    expect(run.stdout).toContain("status: connected");
    expect(run.stdout).toContain("session_hook: not installed");
    expect(run.stdout).not.toContain("pat_piped");
    expect(run.code).toBe(0);
    expect(JSON.parse(readFileSync(join(home, "config", "config.json"), "utf-8")).token).toBe("pat_piped");
    expect(readdirSync(home)).toEqual(["config"]); // no .claude, .codex or .config/opencode
  }, 60_000);

  it("exits 2 on empty stdin", async () => {
    const run = await runBuilt(["auth", "setup", "--token-stdin"], home, "");
    expect(run.code).toBe(2);
    expect(run.stdout).toContain("code: USAGE");
    expect(existsSync(join(home, "config"))).toBe(false);
  }, 60_000);

  it("without the flag it answers at once even though stdin is an open pipe", async () => {
    const run = await runBuilt(["auth", "setup"], home, "keep-open");
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(2);
    expect(run.stdout).toContain("auth setup --token-stdin");
  }, 60_000);
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
