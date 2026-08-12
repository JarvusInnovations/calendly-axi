import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";
import { setupCommand } from "../../src/commands/setup.js";

let home: string;
const claudePath = () => join(home, ".claude", "settings.json");
const codexPath = () => join(home, ".codex", "hooks.json");

function group(command: string) {
  return { matcher: "", hooks: [{ type: "command", command, timeout: 10 }] };
}

function writeClaude(commands: string[]) {
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(claudePath(), JSON.stringify({ hooks: { SessionStart: commands.map(group) } }, null, 2));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "calendly-axi-home-"));
  vi.stubEnv("HOME", home);
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
});

describe("setup hooks status", () => {
  it("reports installed + command when our hook is present (others ignored)", async () => {
    writeClaude(["gh-axi", "calendly-axi"]);
    const out = await setupCommand(["hooks", "status"]);
    expect(out).toContain("hooks[3]{agent,installed,command,current}:");
    expect(out).toMatch(/Claude Code,true,calendly-axi/);
    expect(out).toMatch(/Codex,false,/); // no codex file
    expect(out).toMatch(/OpenCode,false,/); // no plugin file
  });

  it("reports not-installed when absent", async () => {
    writeClaude(["gh-axi"]);
    const out = await setupCommand(["hooks", "status"]);
    expect(out).toMatch(/Claude Code,false,/);
    expect(out).toContain("setup hooks");
  });

  it("reports current:false for a stale command", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      claudePath(),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { matcher: "", hooks: [{ type: "command", command: "/nonexistent/calendly-axi", timeout: 10 }] },
            ],
          },
        },
        null,
        2,
      ),
    );
    const out = await setupCommand(["hooks", "status"]);
    expect(out).toMatch(/Claude Code,true,\/nonexistent\/calendly-axi,false/);
  });

  it("reports current:true for a command that resolves to this process's own executable", async () => {
    // A marker-matching path whose realpath is this test process's own
    // running script — a symlink stands in for "the installed hook command
    // points at the binary that's running right now".
    const symlinkPath = join(home, "calendly-axi");
    symlinkSync(realpathSync(resolve(process.argv[1] ?? "")), symlinkPath);

    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      claudePath(),
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
    const out = await setupCommand(["hooks", "status"]);
    expect(out).toMatch(/Claude Code,true,.*,true/);
  });

  it("notes CALENDLY_AXI_DISABLE_HOOKS=1 when set", async () => {
    process.env.CALENDLY_AXI_DISABLE_HOOKS = "1";
    const out = await setupCommand(["hooks", "status"]);
    expect(out).toContain("CALENDLY_AXI_DISABLE_HOOKS=1");
  });
});

/**
 * `installSessionStartHooks` refuses to write anything unless `process.argv[1]`
 * looks like our own compiled entrypoint (contains the marker, doesn't end in
 * `.ts`) — a real safety feature, but it means the vitest runner's own argv[1]
 * never qualifies. Simulate a realistic `dist/bin/calendly-axi.js` argv[1] for
 * the duration of an install test, mirroring what running the built CLI looks
 * like, and restore it after.
 */
function withSimulatedDistEntrypoint<T>(fn: () => T): T {
  const original = process.argv[1];
  process.argv[1] = join(home, "dist", "bin", "calendly-axi.js");
  try {
    return fn();
  } finally {
    process.argv[1] = original;
  }
}

describe("setup hooks (bare = install/repair)", () => {
  it("is a no-op that says so when disabled via env", async () => {
    process.env.CALENDLY_AXI_DISABLE_HOOKS = "1";
    const out = await setupCommand(["hooks"]);
    expect(out).toContain("CALENDLY_AXI_DISABLE_HOOKS=1");
  });

  it("refuses a .ts dev entrypoint", async () => {
    const original = process.argv[1];
    process.argv[1] = join(home, "bin", "calendly-axi.ts");
    try {
      const out = await setupCommand(["hooks"]);
      expect(out).toContain(".ts dev entrypoint");
    } finally {
      process.argv[1] = original;
    }
  });

  it("installs the Claude Code + Codex hooks and the OpenCode plugin under the stubbed home", async () => {
    const out = await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    expect(out).toContain("installed/repaired");

    const claude = JSON.parse(readFileSync(claudePath(), "utf-8"));
    const claudeCmd = claude.hooks.SessionStart[0].hooks[0].command as string;
    expect(claudeCmd).toContain("calendly-axi");

    const codex = JSON.parse(readFileSync(codexPath(), "utf-8"));
    expect(codex.hooks.SessionStart[0].hooks[0].command).toBe(claudeCmd);

    const pluginPath = join(home, ".config", "opencode", "plugins", "axi-calendly-axi.js");
    expect(readFileSync(pluginPath, "utf-8")).toContain("calendly-axi");
  });

  it("is idempotent: a second install makes no further changes", async () => {
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    const first = readFileSync(claudePath(), "utf-8");
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    const second = readFileSync(claudePath(), "utf-8");
    expect(second).toBe(first);
  });

  it("bare `setup hooks` behaves identically to explicit `setup hooks install`", async () => {
    const bare = await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    const claudeAfterBare = readFileSync(claudePath(), "utf-8");
    const explicit = await withSimulatedDistEntrypoint(() => setupCommand(["hooks", "install"]));
    const claudeAfterExplicit = readFileSync(claudePath(), "utf-8");
    expect(explicit).toBe(bare);
    expect(claudeAfterExplicit).toBe(claudeAfterBare);
  });
});

describe("setup hooks uninstall", () => {
  it("removes only our entry, leaving others; second run is a no-op", async () => {
    writeClaude(["gh-axi", "calendly-axi", "gws-axi"]);
    const out = await setupCommand(["hooks", "uninstall"]);
    expect(out).toContain("removed from Claude Code");

    const settings = JSON.parse(readFileSync(claudePath(), "utf-8"));
    const cmds = settings.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) =>
      g.hooks.map((h) => h.command),
    );
    expect(cmds).toEqual(["gh-axi", "gws-axi"]); // calendly-axi gone, others kept

    const again = await setupCommand(["hooks", "uninstall"]);
    expect(again).toContain("no-op");
  });

  it("round-trip with install: uninstall clears everything install wrote", async () => {
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    const out = await setupCommand(["hooks", "uninstall"]);
    expect(out).toContain("removed from");
    expect(out).toContain("OpenCode");

    const status = await setupCommand(["hooks", "status"]);
    expect(status).toMatch(/Claude Code,false,/);
    expect(status).toMatch(/OpenCode,false,/);
  });
});

describe("setup: unknown subcommand", () => {
  it("rejects a first positional other than `hooks`", async () => {
    await expect(setupCommand(["frobnicate"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires a subcommand when called bare", async () => {
    await expect(setupCommand([])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an unknown `setup hooks` action", async () => {
    await expect(setupCommand(["hooks", "frobnicate"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("top-level `hook` command removed (v1.1.0, no alias)", () => {
  it("the former `hook status` invocation now fails as an unknown command", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await main(["hook", "status"]);
      expect(process.exitCode).toBe(2);
      const output = writeSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(output).toContain("Unknown command: hook");
    } finally {
      writeSpy.mockRestore();
      process.exitCode = 0;
    }
  });
});
