import { delimiter, join, resolve } from "node:path";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { AxiError, installSessionStartHooks, type SessionStartHookScope } from "axi-sdk-js";
import { SETUP_FLAGS, parseSubcommand, str, type Parsed } from "../flags.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";

/**
 * `setup hooks [status|uninstall]` — see `specs/commands/setup.md`. Manages
 * the SessionStart hook that injects the home view for Claude Code, Codex,
 * and OpenCode via `axi-sdk-js`'s `installSessionStartHooks`. The fail-closed
 * form is ported back from nexudus-axi (the canonical source, itself derived
 * from this file). There is no top-level `hook` command — v1.0.0 briefly
 * shipped one; it was renamed in v1.1.0 with no alias kept.
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

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A target file as the agent would see it: absent, parsed, or a problem to report — never silently "absent". */
type TargetRead =
  | { state: "absent" }
  | { state: "ok"; json: Record<string, unknown> }
  | { state: "error"; message: string };

function readTarget(path: string): TargetRead {
  if (!existsSync(path)) return { state: "absent" };
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    return { state: "error", message: `cannot read: ${errMsg(err)}` };
  }
  try {
    const json = JSON.parse(text) as unknown;
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { state: "error", message: "not a JSON object" };
    }
    return { state: "ok", json: json as Record<string, unknown> };
  } catch (err) {
    return { state: "error", message: `not valid JSON: ${errMsg(err)}` };
  }
}

/** Codex reads `[features] hooks` from the user's config.toml whatever the hook's scope (as the SDK writes it). */
function codexConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
}

/** Problem text when Codex would not run its hook, or undefined when `[features] hooks = true`. */
function codexFeatureProblem(): string | undefined {
  const path = codexConfigPath();
  if (!existsSync(path)) return `${path} is missing \`[features] hooks = true\` — Codex will not run hooks`;
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    return `${path}: cannot read: ${errMsg(err)}`;
  }
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1]!.trim();
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = section ? `${section}.${kv[1]}` : kv[1]!;
    if (key === "features.hooks") {
      return kv[2]!.trim() === "true" ? undefined : `${path}: \`[features] hooks\` is ${kv[2]!.trim()} — Codex will not run hooks`;
    }
  }
  return `${path} is missing \`[features] hooks = true\` — Codex will not run hooks`;
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

/**
 * Resolve `--scope` per specs/commands/setup.md: `user` (default) targets each
 * agent's home config; `project` targets the current repository's, matching
 * the SDK's own path scheme so install/status/uninstall agree.
 */
function resolveScope(parsed: Parsed): SessionStartHookScope {
  const raw = str(parsed, "--scope", "user");
  if (raw !== "user" && raw !== "project") {
    throw new AxiError(`--scope must be "user" or "project", not "${raw}"`, "VALIDATION_ERROR", [
      "user: the hook lives in your home config (every session, everywhere)",
      "project: the hook lives in this repository's config and travels with it",
    ]);
  }
  return raw;
}

function scopeRoot(scope: SessionStartHookScope): string {
  return scope === "project" ? process.cwd() : homedir();
}

function jsonTargets(scope: SessionStartHookScope): JsonTarget[] {
  const root = scopeRoot(scope);
  return [
    { agent: "Claude Code", path: join(root, ".claude", "settings.json") },
    { agent: "Codex", path: join(root, ".codex", "hooks.json") },
  ];
}

function opencodePluginPath(scope: SessionStartHookScope): string {
  // Mirrors the SDK: user → ~/.config/opencode/plugins, project → <root>/.opencode/plugins.
  const dir =
    scope === "project"
      ? join(scopeRoot(scope), ".opencode", "plugins")
      : join(homedir(), ".config", "opencode", "plugins");
  return join(dir, `axi-${MARKER}.js`);
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
  /** Why the hook can't be confirmed or won't run — rendered in `problems[]`, never folded into "not installed". */
  problem?: string;
}

function opencodeStatus(scope: SessionStartHookScope): StatusRow {
  const path = opencodePluginPath(scope);
  const none = { agent: "OpenCode", installed: false, command: "", current: false };
  if (!existsSync(path)) return none;
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err) {
    return { ...none, problem: `${path}: cannot read: ${errMsg(err)}` };
  }
  if (!content.includes(OPENCODE_MANAGED_MARKER)) return none;
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
 * relocated/reinstalled binary.
 */
function hookPointsAtCurrentExecutable(command: string): boolean {
  if (!command) return false;
  const current = currentExecTarget();
  if (!current) return false;
  const resolved = resolveCommandTarget(command);
  return resolved !== undefined && resolved === current;
}

function statusRows(scope: SessionStartHookScope): StatusRow[] {
  const rows: StatusRow[] = jsonTargets(scope).map((t) => {
    const read = readTarget(t.path);
    if (read.state === "error") {
      return { agent: t.agent, installed: false, command: "", current: false, problem: `${t.path}: ${read.message}` };
    }
    const group = sessionStartGroups(read.state === "ok" ? read.json : null).find(isOurs);
    const command = ourCommand(group);
    const row: StatusRow = { agent: t.agent, installed: !!group, command, current: hookPointsAtCurrentExecutable(command) };
    if (t.agent === "Codex" && row.installed) {
      const problem = codexFeatureProblem();
      if (problem) {
        row.current = false;
        row.problem = problem;
      }
    }
    return row;
  });
  rows.push(opencodeStatus(scope));
  return rows;
}

const STATUS_SCHEMA = [
  { name: "agent", extract: (i: Record<string, unknown>) => i.agent },
  { name: "installed", extract: (i: Record<string, unknown>) => i.installed },
  { name: "command", extract: (i: Record<string, unknown>) => i.command },
  { name: "current", extract: (i: Record<string, unknown>) => i.current },
];

const PROBLEM_SCHEMA = [
  { name: "agent", extract: (i: Record<string, unknown>) => i.agent },
  { name: "problem", extract: (i: Record<string, unknown>) => i.problem },
];

function renderStatus(scope: SessionStartHookScope, suggestions: string[]): string {
  const rows = statusRows(scope);
  const problems = rows.filter((r) => r.problem);
  const blocks = [
    renderObject({ scope, root: scopeRoot(scope) }),
    renderList("hooks", rows as unknown as Array<Record<string, unknown>>, STATUS_SCHEMA),
  ];
  if (problems.length > 0) {
    blocks.push(renderList("problems", problems as unknown as Array<Record<string, unknown>>, PROBLEM_SCHEMA));
  }
  if (isDisabled()) {
    blocks.push(renderObject({ note: "CALENDLY_AXI_DISABLE_HOOKS=1 is set — installs are suppressed" }));
  }
  blocks.push(renderHelp(suggestions));
  return joinBlocks(...blocks);
}

/** Contents of every file the installer may touch, to detect a no-op run. */
function snapshot(scope: SessionStartHookScope): string[] {
  const paths = [...jsonTargets(scope).map((t) => t.path), opencodePluginPath(scope), codexConfigPath()];
  return paths.map((p) => {
    try {
      return existsSync(p) ? readFileSync(p, "utf-8") : "<absent>";
    } catch {
      return "<unreadable>";
    }
  });
}

/**
 * Install/repair the SessionStart hook for all supported agents. Only the
 * explicit `setup hooks` command calls this (AXI §7: hooks register from a
 * user-invoked setup command, never as a side effect of ordinary commands).
 * Idempotent and self-repairing via the SDK — a repeat install that changes
 * nothing reports itself as a no-op; refuses `.ts` dev entrypoints and honors
 * `CALENDLY_AXI_DISABLE_HOOKS=1`.
 */
function installHooks(scope: SessionStartHookScope): string {
  if (isDisabled()) {
    return "disabled (CALENDLY_AXI_DISABLE_HOOKS=1)";
  }
  if (isDevEntrypoint(currentExecPath())) {
    return "skipped — running from a .ts dev entrypoint (build first)";
  }
  const errors: string[] = [];
  const before = snapshot(scope);
  installSessionStartHooks({
    marker: MARKER,
    scope,
    ...(scope === "project" ? { projectDir: process.cwd() } : {}),
    onError: (m) => errors.push(m),
  });
  const rows = statusRows(scope);
  const missing = rows.filter((r) => !r.installed || !r.current);
  const good = rows.filter((r) => r.installed && r.current);
  const problems = rows.flatMap((r) => (r.problem ? [r.problem] : []));
  const rerun = `calendly-axi setup hooks${scope === "project" ? " --scope project" : ""}`;
  const partial = [
    ...(good.length > 0 ? [`Installed and current: ${good.map((r) => r.agent).join(", ")}`] : []),
    ...(missing.length > 0 ? [`Not installed or not current: ${missing.map((r) => r.agent).join(", ")}`] : []),
  ];
  // A write the SDK reports as failed, or a target it can't confirm, is a
  // failed setup — never a warning on exit 0 (AXI §6: fail closed).
  if (errors.length > 0 || problems.length > 0) {
    throw new AxiError(
      `session hook install failed at ${scope} scope: ${(errors.length > 0 ? errors : problems).join("; ")}`,
      "SETUP_FAILED",
      [...partial, `Fix the file named above (its permissions, or its JSON/TOML content), then run \`${rerun}\` again`],
    );
  }
  // The SDK declines (silently) to register an entrypoint it doesn't
  // recognize as an installed calendly-axi binary. Verify instead of assuming.
  if (missing.length > 0) {
    throw new AxiError(
      `session hook not registered for ${missing.map((r) => r.agent).join(", ")} — ${currentExecPath()} is not an installed calendly-axi entrypoint`,
      "SETUP_FAILED",
      ["Run `setup hooks` from the installed binary: `npm install -g calendly-axi && calendly-axi setup hooks`"],
    );
  }
  const after = snapshot(scope);
  if (before.every((content, i) => content === after[i])) {
    return `already installed and current at ${scope} scope (no-op)`;
  }
  return `installed/repaired at ${scope} scope (Claude Code, Codex, OpenCode)`;
}

/**
 * One-line, read-only summary of the user-scope hook, for `auth setup`'s
 * confirmation. Never installs anything.
 */
export function hookSummary(): string {
  if (isDisabled()) return "disabled (CALENDLY_AXI_DISABLE_HOOKS=1)";
  const rows = statusRows("user");
  const problems = rows.filter((r) => r.problem);
  if (problems.length > 0) {
    return `problem — ${problems.map((r) => `${r.agent}: ${r.problem}`).join("; ")} — run \`calendly-axi setup hooks status\``;
  }
  const installed = rows.filter((r) => r.installed);
  if (installed.length === 0) {
    return "not installed — run `calendly-axi setup hooks` to load the home view at session start (optional)";
  }
  const stale = installed.filter((r) => !r.current);
  if (stale.length > 0) {
    return `stale for ${stale.map((r) => r.agent).join(", ")} — run \`calendly-axi setup hooks\` to repair`;
  }
  return `installed and current: ${installed.map((r) => r.agent).join(", ")}`;
}

function hookStatus(scope: SessionStartHookScope): string {
  const rows = statusRows(scope);
  const anyInstalled = rows.some((r) => r.installed);
  return renderStatus(scope, [
    anyInstalled
      ? "Run `calendly-axi setup hooks uninstall` to remove the session hook"
      : "Run `calendly-axi setup hooks` to load the home view at session start",
    "Run `calendly-axi --help` to see the full command list, or `<command> --help` for usage on any command",
  ]);
}

function hookInstall(scope: SessionStartHookScope): string {
  const status = installHooks(scope);
  return joinBlocks(
    renderObject({ status }),
    renderStatus(scope, [
      `Run \`calendly-axi setup hooks uninstall${scope === "project" ? " --scope project" : ""}\` to remove it`,
    ]),
  );
}

function hookUninstall(scope: SessionStartHookScope): string {
  const cleared: string[] = [];
  const failures: string[] = [];

  for (const t of jsonTargets(scope)) {
    const read = readTarget(t.path);
    if (read.state === "absent") continue;
    // A file we can't read or parse may still hold our hook: report it, never skip it.
    if (read.state === "error") {
      failures.push(`${t.path}: ${read.message}`);
      continue;
    }
    const json = read.json;
    const groups = sessionStartGroups(json);
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length === groups.length) continue; // nothing ours here

    (json as HookSettings).hooks!.SessionStart = kept;
    try {
      writeFileSync(t.path, `${JSON.stringify(json, null, 2)}\n`, "utf-8");
      cleared.push(t.agent);
    } catch (err) {
      failures.push(`${t.path}: cannot write: ${errMsg(err)}`);
    }
  }

  const pluginPath = opencodePluginPath(scope);
  if (existsSync(pluginPath)) {
    let content: string | undefined;
    try {
      content = readFileSync(pluginPath, "utf-8");
    } catch (err) {
      failures.push(`${pluginPath}: cannot read: ${errMsg(err)}`);
    }
    if (content?.includes(OPENCODE_MANAGED_MARKER)) {
      try {
        rmSync(pluginPath);
        cleared.push("OpenCode");
      } catch (err) {
        failures.push(`${pluginPath}: cannot remove: ${errMsg(err)}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new AxiError(
      `session hook uninstall incomplete at ${scope} scope: ${failures.join("; ")}`,
      "IO_ERROR",
      [
        cleared.length > 0 ? `Removed from: ${cleared.join(", ")}` : "Nothing was removed",
        `Fix the file named above (its permissions or JSON), then run \`calendly-axi setup hooks uninstall${scope === "project" ? " --scope project" : ""}\` again`,
      ],
    );
  }
  if (cleared.length === 0) {
    return renderObject({ status: `no calendly-axi session hook was installed at ${scope} scope (no-op)` });
  }
  return joinBlocks(
    renderObject({ status: `removed from ${cleared.join(", ")} (${scope} scope)` }),
    renderHelp([`Run \`calendly-axi setup hooks status${scope === "project" ? " --scope project" : ""}\` to confirm`]),
  );
}

export async function setupCommand(args: string[]) {
  const group = args[0];
  if (group !== "hooks") {
    throw new AxiError(
      group === undefined ? "`setup` requires a subcommand" : `unknown setup subcommand "${group}"`,
      "VALIDATION_ERROR",
      ["valid subcommands: hooks"],
    );
  }

  const { sub, parsed } = parseSubcommand("setup hooks", args.slice(1), SETUP_FLAGS, "install");
  const scope = resolveScope(parsed);
  switch (sub) {
    case "install":
      return hookInstall(scope);
    case "status":
      return hookStatus(scope);
    case "uninstall":
      return hookUninstall(scope);
    default:
      throw new AxiError(`unknown setup hooks subcommand "${sub}"`, "VALIDATION_ERROR", []);
  }
}

interface Check {
  check: string;
  status: "ok" | "fail" | "skipped";
  detail: string;
}

/**
 * `doctor`'s hooks check. Lives here (not doctor.ts) so hook-state logic has
 * one home.
 */
export function hookDoctorCheck(): Check {
  if (isDisabled()) {
    return { check: "hooks", status: "skipped", detail: "CALENDLY_AXI_DISABLE_HOOKS=1 is set" };
  }
  const rows = statusRows("user");
  const problems = rows.filter((r) => r.problem);
  if (problems.length > 0) {
    return {
      check: "hooks",
      status: "fail",
      detail: `${problems.map((r) => `${r.agent}: ${r.problem}`).join("; ")} — fix it, then run \`calendly-axi setup hooks\``,
    };
  }
  const installed = rows.filter((r) => r.installed);
  if (installed.length === 0) {
    // The hook is optional (the installable skill is an alternative), so its
    // absence is not a health failure — only a broken installed hook is.
    return {
      check: "hooks",
      status: "skipped",
      detail: "not installed (optional) — run `calendly-axi setup hooks` to load the home view at session start",
    };
  }
  const stale = installed.filter((r) => !r.current);
  if (stale.length > 0) {
    return {
      check: "hooks",
      status: "fail",
      detail: `installed hook(s) for ${stale.map((r) => r.agent).join(", ")} point at a different executable — run \`calendly-axi setup hooks\` to repair`,
    };
  }
  return {
    check: "hooks",
    status: "ok",
    detail: `installed and current: ${installed.map((r) => r.agent).join(", ")}`,
  };
}
