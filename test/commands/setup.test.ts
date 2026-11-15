import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxiError } from "axi-sdk-js";
import { main } from "../../src/cli.js";
import { hookDoctorCheck, hookSummary, setupCommand } from "../../src/commands/setup.js";

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

const realCwd = process.cwd();
const realArgv1 = process.argv[1];
// A read-only directory does not stop root, so the permission tests can't prove anything there.
const isRoot = process.getuid?.() === 0;

beforeEach(() => {
  // The SDK writes agent settings under HOME (and Codex's feature flag there at
  // any scope): every test gets its own, so nothing can reach the real one.
  home = mkdtempSync(join(tmpdir(), "calendly-axi-home-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "calendly-axi-test-")));
  vi.stubEnv("CALENDLY_AXI_DISABLE_HOOKS", undefined);
});

afterEach(() => {
  process.chdir(realCwd);
  process.argv[1] = realArgv1;
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function failure(run: Promise<unknown>): Promise<AxiError> {
  return run.then(
    () => {
      throw new Error("expected the command to fail");
    },
    (err: unknown) => err as AxiError,
  );
}

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
    vi.stubEnv("CALENDLY_AXI_DISABLE_HOOKS", "1");
    const out = await setupCommand(["hooks", "status"]);
    expect(out).toContain("CALENDLY_AXI_DISABLE_HOOKS=1");
  });
});

/**
 * `installSessionStartHooks` refuses to write anything unless `process.argv[1]`
 * looks like our own compiled entrypoint (contains the marker, doesn't end in
 * `.ts`) — a real safety feature, but it means the vitest runner's own argv[1]
 * never qualifies. Pose as a realistic `dist/bin/calendly-axi.js` for the
 * duration of an install test. The file has to exist: after installing, the
 * command re-reads each hook and checks it resolves to this executable.
 */
async function withSimulatedDistEntrypoint<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.argv[1];
  const fakeBin = join(home, "dist", "bin", "calendly-axi.js");
  mkdirSync(dirname(fakeBin), { recursive: true });
  if (!existsSync(fakeBin)) writeFileSync(fakeBin, "");
  process.argv[1] = fakeBin;
  try {
    return await fn();
  } finally {
    process.argv[1] = original;
  }
}

describe("setup hooks (bare = install/repair)", () => {
  it("is a no-op that says so when disabled via env", async () => {
    vi.stubEnv("CALENDLY_AXI_DISABLE_HOOKS", "1");
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
    expect(out).toContain("installed/repaired at user scope (Claude Code, Codex, OpenCode)");
    expect(out).toMatch(/Claude Code,true,.*,true/);

    const claude = JSON.parse(readFileSync(claudePath(), "utf-8"));
    const claudeCmd = claude.hooks.SessionStart[0].hooks[0].command as string;
    expect(claudeCmd).toContain("calendly-axi");

    const codex = JSON.parse(readFileSync(codexPath(), "utf-8"));
    expect(codex.hooks.SessionStart[0].hooks[0].command).toBe(claudeCmd);

    const pluginPath = join(home, ".config", "opencode", "plugins", "axi-calendly-axi.js");
    expect(readFileSync(pluginPath, "utf-8")).toContain("calendly-axi");
  });

  it("is idempotent: a second install changes no file and says no-op", async () => {
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    const first = readFileSync(claudePath(), "utf-8");
    const out = await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    expect(out).toContain("already installed and current at user scope (no-op)");
    expect(readFileSync(claudePath(), "utf-8")).toBe(first);
  });

  it("bare `setup hooks` and explicit `setup hooks install` are the same action", async () => {
    const bare = await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    expect(bare).toContain("installed/repaired at user scope");
    const claudeAfterBare = readFileSync(claudePath(), "utf-8");
    const explicit = await withSimulatedDistEntrypoint(() => setupCommand(["hooks", "install"]));
    // The explicit form found the bare form's work already done.
    expect(explicit).toContain("already installed and current at user scope (no-op)");
    expect(readFileSync(claudePath(), "utf-8")).toBe(claudeAfterBare);
  });
});

describe("setup hooks install fails closed", () => {
  it.skipIf(isRoot)("a write the SDK reports as failed is SETUP_FAILED, never a warning on exit 0", async () => {
    // One target unwritable: the Claude Code settings directory is read-only.
    mkdirSync(join(home, ".claude"));
    chmodSync(join(home, ".claude"), 0o555);
    try {
      const err = await failure(withSimulatedDistEntrypoint(() => setupCommand(["hooks"])));
      expect(err.code).toBe("SETUP_FAILED");
      expect(err.message).toContain("session hook install failed at user scope");
      expect(err.message).toContain(claudePath());
      const hints = err.suggestions.join(" | ");
      expect(hints).toContain("Installed and current: Codex, OpenCode");
      expect(hints).toContain("Not installed or not current: Claude Code");
      expect(hints).toContain("run `calendly-axi setup hooks` again");
    } finally {
      chmodSync(join(home, ".claude"), 0o755);
    }
  });

  it("SETUP_FAILED maps to exit 1 through the CLI, with no success line", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      // argv[1] is the test runner here, which the SDK will not register.
      await main(["setup", "hooks"]);
      const output = writeSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(process.exitCode).toBe(1);
      expect(output).toContain("code: SETUP_FAILED");
      expect(output).not.toContain("installed/repaired");
    } finally {
      writeSpy.mockRestore();
      process.exitCode = 0;
    }
  });

  it("refuses to report success when the SDK declines a non-installed entrypoint", async () => {
    const err = await failure(setupCommand(["hooks"]));
    expect(err.code).toBe("SETUP_FAILED");
    expect(err.message).toContain("session hook not registered for Claude Code, Codex, OpenCode");
    expect(existsSync(claudePath())).toBe(false);
  });

  it("an existing settings file that is not valid JSON is SETUP_FAILED naming the file", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(claudePath(), "{ not json");
    const err = await failure(withSimulatedDistEntrypoint(() => setupCommand(["hooks"])));
    expect(err.code).toBe("SETUP_FAILED");
    expect(err.message).toContain(claudePath());
    expect(readFileSync(claudePath(), "utf-8")).toBe("{ not json"); // left for the user to fix
  });

  it("a repeat install that only re-enables Codex's feature flag is not reported as a no-op", async () => {
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    writeFileSync(join(home, ".codex", "config.toml"), "[features]\nhooks = false\n");
    const out = await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    expect(out).toContain("installed/repaired at user scope");
    expect(out).not.toContain("(no-op)");
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf-8")).toMatch(/hooks = true/);
  });
});

describe("setup hooks --scope", () => {
  let project: string;

  beforeEach(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "calendly-axi-proj-")));
    process.chdir(project);
  });

  afterEach(() => {
    process.chdir(realCwd);
    rmSync(project, { recursive: true, force: true });
  });

  it("project scope writes the current directory's agent config, not the home one", async () => {
    const out = await withSimulatedDistEntrypoint(() => setupCommand(["hooks", "--scope", "project"]));
    expect(out).toContain("installed/repaired at project scope");
    expect(out).toContain("scope: project");
    expect(out).toContain(`root: ${project}`);
    expect(out).toContain("setup hooks uninstall --scope project");

    expect(readFileSync(join(project, ".claude", "settings.json"), "utf-8")).toContain("calendly-axi");
    expect(existsSync(join(project, ".codex", "hooks.json"))).toBe(true);
    expect(existsSync(join(project, ".opencode", "plugins", "axi-calendly-axi.js"))).toBe(true);
    expect(existsSync(claudePath())).toBe(false);
  });

  it("status and uninstall act on the scope they were given", async () => {
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks", "--scope", "project"]));

    const userStatus = await withSimulatedDistEntrypoint(() => setupCommand(["hooks", "status"]));
    expect(userStatus).toContain("scope: user");
    expect(userStatus).toMatch(/Claude Code,false,/);

    const projectStatus = await withSimulatedDistEntrypoint(() => setupCommand(["hooks", "status", "--scope=project"]));
    expect(projectStatus).toMatch(/Claude Code,true,.*,true/);

    expect(await setupCommand(["hooks", "uninstall"])).toContain("at user scope (no-op)");
    const removed = await setupCommand(["hooks", "uninstall", "--scope", "project"]);
    expect(removed).toContain("removed from Claude Code, Codex, OpenCode (project scope)");
    expect(existsSync(join(project, ".opencode", "plugins", "axi-calendly-axi.js"))).toBe(false);
  });

  it.skipIf(isRoot)("a failed project install names the scoped rerun command", async () => {
    mkdirSync(join(project, ".claude"));
    chmodSync(join(project, ".claude"), 0o555);
    try {
      const err = await failure(withSimulatedDistEntrypoint(() => setupCommand(["hooks", "--scope", "project"])));
      expect(err.code).toBe("SETUP_FAILED");
      expect(err.suggestions.join(" ")).toContain("calendly-axi setup hooks --scope project");
    } finally {
      chmodSync(join(project, ".claude"), 0o755);
    }
  });

  it("rejects an unknown scope as VALIDATION_ERROR naming the two values", async () => {
    const err = await failure(setupCommand(["hooks", "--scope", "global"]));
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain(`--scope must be "user" or "project"`);
    expect(existsSync(join(project, ".claude"))).toBe(false);
  });
});

describe("setup hooks status and uninstall report files they cannot read", () => {
  it("status shows an unparseable target as a problems[] row, not as not-installed", async () => {
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    writeFileSync(codexPath(), "{ not json");
    const out = await withSimulatedDistEntrypoint(() => setupCommand(["hooks", "status"]));
    expect(out).toMatch(/problems\[1\]\{agent,problem\}:/);
    expect(out).toContain(codexPath());
    expect(out).toContain("not valid JSON");
  });

  it("status counts Codex as current only with `[features] hooks = true`", async () => {
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    writeFileSync(join(home, ".codex", "config.toml"), "[features]\nhooks = false\n");
    const out = await withSimulatedDistEntrypoint(() => setupCommand(["hooks", "status"]));
    expect(out).toMatch(/Codex,true,.*,false/);
    expect(out).toContain("hooks` is false");
  });

  it("uninstall with an unparseable settings file that may hold the hook is IO_ERROR, not removed/no-op", async () => {
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    writeFileSync(claudePath(), `${readFileSync(claudePath(), "utf-8")}{ trailing garbage`);
    const err = await failure(setupCommand(["hooks", "uninstall"]));
    expect(err.code).toBe("IO_ERROR");
    expect(err.message).toContain(claudePath());
    expect(err.message).toContain("not valid JSON");
    // The readable targets were still cleaned, and it says so.
    expect(err.suggestions.join(" ")).toContain("Removed from: Codex, OpenCode");
  });

  it.skipIf(isRoot)("uninstall with an unreadable settings file is IO_ERROR", async () => {
    await withSimulatedDistEntrypoint(() => setupCommand(["hooks"]));
    chmodSync(claudePath(), 0o000);
    try {
      const err = await failure(setupCommand(["hooks", "uninstall"]));
      expect(err.code).toBe("IO_ERROR");
      expect(err.message).toContain("cannot read");
    } finally {
      chmodSync(claudePath(), 0o644);
    }
  });
});

describe("hookSummary (the read-only line auth setup prints)", () => {
  it("says not installed and points at setup hooks, writing nothing", () => {
    const summary = hookSummary();
    expect(summary).toContain("not installed");
    expect(summary).toContain("calendly-axi setup hooks");
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(existsSync(join(home, ".codex"))).toBe(false);
    expect(existsSync(join(home, ".config", "opencode"))).toBe(false);
  });

  it("names the agents when installed and current", async () => {
    await withSimulatedDistEntrypoint(async () => {
      await setupCommand(["hooks"]);
      expect(hookSummary()).toBe("installed and current: Claude Code, Codex, OpenCode");
    });
  });

  it("reports a stale hook and a disabled install as such", () => {
    writeClaude(["/nonexistent/calendly-axi"]);
    expect(hookSummary()).toContain("stale for Claude Code");
    vi.stubEnv("CALENDLY_AXI_DISABLE_HOOKS", "1");
    expect(hookSummary()).toBe("disabled (CALENDLY_AXI_DISABLE_HOOKS=1)");
  });
});

describe("hookDoctorCheck", () => {
  it("a missing hook is skipped (it is optional), with the install command", () => {
    const check = hookDoctorCheck();
    expect(check.status).toBe("skipped");
    expect(check.detail).toContain("optional");
    expect(check.detail).toContain("calendly-axi setup hooks");
  });

  it("an unparseable target fails, naming the file", () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(claudePath(), "{ not json");
    const check = hookDoctorCheck();
    expect(check.status).toBe("fail");
    expect(check.detail).toContain(claudePath());
  });

  it("a Codex hook without the feature flag fails", async () => {
    await withSimulatedDistEntrypoint(async () => {
      await setupCommand(["hooks"]);
      writeFileSync(join(home, ".codex", "config.toml"), "[features]\nhooks = false\n");
      const check = hookDoctorCheck();
      expect(check.status).toBe("fail");
      expect(check.detail).toContain("hooks` is false");
    });
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

  it("rejects a stray argument after the action, as USAGE", async () => {
    await expect(setupCommand(["hooks", "status", "extra"])).rejects.toMatchObject({ code: "USAGE" });
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
