import { delimiter, join, resolve } from "node:path";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { HOOK_FLAGS, parseSubcommand } from "../flags.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";

/**
 * `hook install|status|uninstall` — see `specs/commands/hook.md`. Manages
 * the SessionStart hook that injects the home view for Claude Code, Codex,
 * and OpenCode via `axi-sdk-js`'s `installSessionStartHooks`.
 */

const MARKER = "calendly-axi";
const OPENCODE_MANAGED_MARKER = `axi-sdk-js managed opencode plugin: ${MARKER}`;

function isDisabled(): boolean {
  return process.env.CALENDLY_AXI_DISABLE_HOOKS === "1";
}

function currentExecPath(): string {
  return resolve(process.argv[1] ?? "");
}

function isDevEntrypoint(execPath: string): boolean {
  return execPath.endsWith(".ts");
}

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string | null;
  hooks?: HookEntry[];
}
interface HookSettings {
  hooks?: { SessionStart?: HookGroup[] };
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sessionStartGroups(json: Record<string, unknown> | null): HookGroup[] {
  const hooks = (json as HookSettings | null)?.hooks;
  return hooks?.SessionStart ?? [];
}

function isOurs(group: HookGroup): boolean {
  return (group.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(MARKER));
}

function ourCommand(group: HookGroup | undefined): string {
  return group?.hooks?.find((h) => h.command?.includes(MARKER))?.command ?? "";
}

interface JsonTarget {
  agent: string;
  path: string;
}

function jsonTargets(): JsonTarget[] {
  const home = homedir();
  return [
    { agent: "Claude Code", path: join(home, ".claude", "settings.json") },
    { agent: "Codex", path: join(home, ".codex", "hooks.json") },
  ];
}

function opencodePluginPath(): string {
  // Mirrors axi-sdk-js's sanitizeOpenCodePluginFilePart — MARKER is already
  // filesystem-safe ([A-Za-z0-9._-]) so no sanitization is needed here.
  return join(homedir(), ".config", "opencode", "plugins", `axi-${MARKER}.js`);
}

function opencodeCommand(content: string): string {
  const match = content.match(/const command = (".*?");/);
  if (!match?.[1]) return "";
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return "";
  }
}

interface StatusRow {
  agent: string;
  installed: boolean;
  command: string;
  current: boolean;
}

function opencodeStatus(): StatusRow {
  const path = opencodePluginPath();
  if (!existsSync(path)) return { agent: "OpenCode", installed: false, command: "", current: false };
  let content = "";
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return { agent: "OpenCode", installed: false, command: "", current: false };
  }
  if (!content.includes(OPENCODE_MANAGED_MARKER)) {
    return { agent: "OpenCode", installed: false, command: "", current: false };
  }
  const command = opencodeCommand(content);
  return { agent: "OpenCode", installed: true, command, current: hookPointsAtCurrentExecutable(command) };
}

/** Best-effort realpath, resolving a bare command name against PATH. */
function resolveCommandTarget(command: string): string | undefined {
  if (!command) return undefined;
  try {
    if (existsSync(command)) return realpathSync(command);
  } catch {
    // fall through to PATH search
  }
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathEntries) {
    const candidate = join(dir, command);
    try {
      if (existsSync(candidate)) return realpathSync(candidate);
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function currentExecTarget(): string | undefined {
  try {
    return realpathSync(currentExecPath());
  } catch {
    return undefined;
  }
}

/**
 * True when an installed hook `command` resolves to the same file as the
 * executable running right now — i.e. the hook is current, not stale from a
 * relocated/reinstalled binary. Best-effort: it compares realpaths, which
 * covers both an absolute path and a PATH-resolvable short binary name.
 */
function hookPointsAtCurrentExecutable(command: string): boolean {
  if (!command) return false;
  const current = currentExecTarget();
  if (!current) return false;
  const resolved = resolveCommandTarget(command);
  return resolved !== undefined && resolved === current;
}

function statusRows(): StatusRow[] {
  const rows: StatusRow[] = jsonTargets().map((t) => {
    const group = sessionStartGroups(readJson(t.path)).find(isOurs);
    const command = ourCommand(group);
    return { agent: t.agent, installed: !!group, command, current: hookPointsAtCurrentExecutable(command) };
  });
  rows.push(opencodeStatus());
  return rows;
}

const STATUS_SCHEMA = [
  { name: "agent", extract: (i: Record<string, unknown>) => i.agent },
  { name: "installed", extract: (i: Record<string, unknown>) => i.installed },
  { name: "command", extract: (i: Record<string, unknown>) => i.command },
  { name: "current", extract: (i: Record<string, unknown>) => i.current },
];

function renderStatus(suggestions: string[]): string {
  const blocks = [renderList("hooks", statusRows() as unknown as Array<Record<string, unknown>>, STATUS_SCHEMA)];
  if (isDisabled()) {
    blocks.push(renderObject({ note: "CALENDLY_AXI_DISABLE_HOOKS=1 is set — installs are suppressed" }));
  }
  blocks.push(renderHelp(suggestions));
  return joinBlocks(...blocks);
}

/**
 * Install/repair the SessionStart hook for all supported agents. Shared by
 * `hook install` and (as the convenience opt-in per AXI §7) `auth setup`.
 * Idempotent and self-repairing via the SDK; refuses `.ts` dev entrypoints
 * and honors `CALENDLY_AXI_DISABLE_HOOKS=1`. Returns a short human status.
 */
export function installHooks(): string {
  if (isDisabled()) {
    return "disabled (CALENDLY_AXI_DISABLE_HOOKS=1)";
  }
  if (isDevEntrypoint(currentExecPath())) {
    return "skipped — running from a .ts dev entrypoint (build first)";
  }
  let error: string | undefined;
  installSessionStartHooks({ marker: MARKER, onError: (m) => (error = m) });
  return error ? `completed with a warning: ${error}` : "installed/repaired (Claude Code, Codex, OpenCode)";
}

function hookStatus(): string {
  const rows = statusRows();
  const anyInstalled = rows.some((r) => r.installed);
  return renderStatus([
    anyInstalled
      ? "Run `calendly-axi hook uninstall` to remove the session hook"
      : "Run `calendly-axi hook install` to load the home view at session start",
    "Run `calendly-axi --help` to see the full command list, or `<command> --help` for usage on any command",
  ]);
}

function hookInstall(): string {
  const status = installHooks();
  return joinBlocks(renderObject({ status }), renderStatus(["Run `calendly-axi hook uninstall` to remove it"]));
}

function hookUninstall(): string {
  const cleared: string[] = [];

  for (const t of jsonTargets()) {
    const json = readJson(t.path);
    if (!json) continue;
    const groups = sessionStartGroups(json);
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length === groups.length) continue; // nothing ours here

    (json as HookSettings).hooks!.SessionStart = kept;
    try {
      writeFileSync(t.path, `${JSON.stringify(json, null, 2)}\n`, "utf-8");
      cleared.push(t.agent);
    } catch (err) {
      throw new AxiError(
        `Failed to update ${t.path}: ${err instanceof Error ? err.message : String(err)}`,
        "IO_ERROR",
        ["Check file permissions and retry"],
      );
    }
  }

  const pluginPath = opencodePluginPath();
  if (existsSync(pluginPath)) {
    let content = "";
    try {
      content = readFileSync(pluginPath, "utf-8");
    } catch {
      content = "";
    }
    if (content.includes(OPENCODE_MANAGED_MARKER)) {
      try {
        rmSync(pluginPath);
        cleared.push("OpenCode");
      } catch (err) {
        throw new AxiError(
          `Failed to remove ${pluginPath}: ${err instanceof Error ? err.message : String(err)}`,
          "IO_ERROR",
          ["Check file permissions and retry"],
        );
      }
    }
  }

  if (cleared.length === 0) {
    return renderObject({ status: "no calendly-axi session hook was installed (no-op)" });
  }
  return renderObject({ status: `removed from ${cleared.join(", ")}` });
}

export async function hookCommand(args: string[]) {
  const { sub } = parseSubcommand("hook", args, HOOK_FLAGS, "status");
  switch (sub) {
    case "status":
      return hookStatus();
    case "install":
      return hookInstall();
    case "uninstall":
      return hookUninstall();
    default:
      // Unreachable — parseSubcommand already validated `sub` against HOOK_FLAGS.
      throw new AxiError(`unknown hook subcommand "${sub}"`, "VALIDATION_ERROR", []);
  }
}

interface Check {
  check: string;
  status: "ok" | "fail" | "skipped";
  detail: string;
}

/**
 * `doctor`'s check 5 ("hooks"). Lives here (not doctor.ts) so hook-state
 * logic — install target paths, the marker match, the current-executable
 * comparison — has one home.
 */
export function hookDoctorCheck(): Check {
  if (isDisabled()) {
    return { check: "hooks", status: "skipped", detail: "CALENDLY_AXI_DISABLE_HOOKS=1 is set" };
  }
  const rows = statusRows();
  const installed = rows.filter((r) => r.installed);
  if (installed.length === 0) {
    return {
      check: "hooks",
      status: "fail",
      detail: "no SessionStart hook installed — run `calendly-axi hook install`",
    };
  }
  const stale = installed.filter((r) => !r.current);
  if (stale.length > 0) {
    return {
      check: "hooks",
      status: "fail",
      detail: `installed hook(s) for ${stale.map((r) => r.agent).join(", ")} point at a different executable — run \`calendly-axi hook install\` to repair`,
    };
  }
  return {
    check: "hooks",
    status: "ok",
    detail: `installed and current: ${installed.map((r) => r.agent).join(", ")}`,
  };
}
