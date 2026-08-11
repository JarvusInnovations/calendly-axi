import { AxiError } from "axi-sdk-js";

export interface FlagSpec {
  /** Flags that take a value, e.g. `--limit 10`. */
  value?: string[];
  /** Flags that are standalone switches, e.g. `--org`. */
  boolean?: string[];
  /** Renamed or removed flags mapped to a targeted hint. */
  deprecated?: Record<string, string>;
}

export interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
}

/** `--help` is universal and never reported as unknown (AXI §6). */
const ALWAYS_ALLOWED = new Set(["--help", "-h"]);

/**
 * Parse argv for one command, rejecting anything not declared.
 *
 * A silently-dropped flag is worse than an error: the agent gets output it
 * believes is filtered and proceeds on wrong data. So an unrecognized flag
 * fails with exit code 2 and lists the valid flags inline, which collapses
 * the agent's correction from two turns into one.
 */
export function parseFlags(command: string, argv: string[], spec: FlagSpec): Parsed {
  const valueFlags = new Set(spec.value ?? []);
  const boolFlags = new Set(spec.boolean ?? []);
  const deprecated = spec.deprecated ?? {};
  const known = [...valueFlags, ...boolFlags].sort();

  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  const unknown = (name: string): never => {
    const hint = deprecated[name];
    throw new AxiError(
      `unknown flag ${name} for \`${command}\``,
      "UNKNOWN_FLAG",
      hint
        ? [hint]
        : [
            known.length > 0
              ? `valid flags for \`${command}\`: ${known.join(", ")} (--help always allowed)`
              : `\`${command}\` takes no flags (--help always allowed)`,
          ],
    );
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }

    if (ALWAYS_ALLOWED.has(arg)) {
      flags["--help"] = true;
      continue;
    }

    // Support both `--dir=/Books` and `--dir /Books`.
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);

    if (boolFlags.has(name)) {
      if (inlineValue !== undefined) {
        throw new AxiError(`${name} is a switch and takes no value`, "USAGE", [
          `Run \`calendly-axi ${command} ${name}\` without a value`,
        ]);
      }
      flags[name] = true;
      continue;
    }

    if (valueFlags.has(name)) {
      if (inlineValue !== undefined) {
        flags[name] = inlineValue;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new AxiError(`${name} requires a value`, "USAGE", [
          `Run \`calendly-axi ${command} ${name} <value>\``,
        ]);
      }
      flags[name] = next;
      i++;
      continue;
    }

    unknown(name);
  }

  return { positional, flags };
}

/** Read a value flag as a string, or fall back to a default. */
export function str(parsed: Parsed, name: string, fallback: string): string;
export function str(parsed: Parsed, name: string): string | undefined;
export function str(parsed: Parsed, name: string, fallback?: string): string | undefined {
  const raw = parsed.flags[name];
  return typeof raw === "string" ? raw : fallback;
}

/** True when a boolean (or value, if simply present) flag was supplied. */
export function bool(parsed: Parsed, name: string): boolean {
  return parsed.flags[name] !== undefined;
}

/** Require the Nth positional argument, or fail with usage. */
export function requirePositional(parsed: Parsed, index: number, label: string, usage: string): string {
  const value = parsed.positional[index];
  if (value === undefined || value.length === 0) {
    throw new AxiError(`${label} is required`, "USAGE", [usage]);
  }
  return value;
}

/**
 * Resolve a command's subcommand (`events list`, `auth setup`, ...) and parse
 * the remaining argv against that subcommand's declared flag set. When the
 * first token is missing or looks like a flag, `defaultSub` (if given) is
 * used and the full argv is treated as the subcommand's own args — this is
 * what makes `calendly-axi events` equivalent to `calendly-axi events list`.
 * An unknown or (with no default) missing subcommand fails with the valid
 * set inlined, mirroring `parseFlags`'s unknown-flag treatment.
 */
export function parseSubcommand(
  command: string,
  args: string[],
  specs: Record<string, FlagSpec>,
  defaultSub?: string,
): { sub: string; parsed: Parsed } {
  const first = args[0];
  const usesDefault = first === undefined || first.startsWith("-");
  const sub = usesDefault ? defaultSub : first;

  if (sub === undefined || !(sub in specs)) {
    throw new AxiError(
      sub === undefined
        ? `\`${command}\` requires a subcommand`
        : `unknown ${command} subcommand "${sub}"`,
      "VALIDATION_ERROR",
      [`valid subcommands: ${Object.keys(specs).join(", ")}`],
    );
  }

  const rest = usesDefault ? args : args.slice(1);
  const parsed = parseFlags(`${command} ${sub}`, rest, specs[sub]!);
  return { sub, parsed };
}

// ── Declared per-command flag sets ──────────────────────────────────
// One entry per command/subcommand pair, named FLAGS so every command
// module imports its own slice. Keeping them all here (rather than scattered
// across command files) is what makes "unknown flag" rejection consistent —
// see `specs/commands/*.md` for the flags each surface declares.

export const AUTH_FLAGS: Record<string, FlagSpec> = {
  setup: { value: ["--token"] },
  whoami: { boolean: ["--refresh"] },
  logout: {},
};

export const HOOK_FLAGS: Record<string, FlagSpec> = {
  install: {},
  status: {},
  uninstall: {},
};

export const DOCTOR_FLAGS: FlagSpec = {};

export const HOME_FLAGS: FlagSpec = {};

export const TYPES_FLAGS: Record<string, FlagSpec> = {
  list: { boolean: ["--org", "--all", "--inactive"] },
  view: {},
  slots: { value: ["--from", "--to", "--until"] },
  create: {
    value: [
      "--name",
      "--duration",
      "--description",
      "--color",
      "--locations",
      "--date",
      "--timezone",
      "--co-hosts",
    ],
    boolean: ["--inactive", "--one-off"],
  },
  update: {
    value: ["--name", "--duration", "--description", "--color", "--locations"],
    boolean: ["--active", "--inactive"],
  },
  availability: { value: ["--rules"] },
};

export const EVENTS_FLAGS: Record<string, FlagSpec> = {
  list: {
    value: ["--status", "--email", "--from", "--to", "--since", "--until", "--user", "--limit"],
    boolean: ["--org"],
  },
  view: {},
  invitees: { value: ["--status", "--email"] },
  cancel: { value: ["--reason"] },
  "no-show": { boolean: ["--undo"] },
};

export const BUSY_FLAGS: FlagSpec = {
  value: ["--from", "--to", "--until", "--user"],
};

export const LINK_FLAGS: FlagSpec = {};

export const BOOK_FLAGS: FlagSpec = {
  value: ["--type", "--at", "--name", "--email", "--timezone", "--location", "--answer", "--guests"],
};

export const WEBHOOKS_FLAGS: Record<string, FlagSpec> = {
  list: { value: ["--scope", "--user", "--group"] },
  view: {},
  create: { value: ["--url", "--events", "--scope", "--user", "--group", "--signing-key"] },
  delete: {},
  sample: { value: ["--event", "--scope", "--user"] },
};
