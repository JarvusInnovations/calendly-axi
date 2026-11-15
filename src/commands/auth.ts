import { readFileSync } from "node:fs";
import { AxiError } from "axi-sdk-js";
import { fetchProfile } from "../calendly/scope.js";
import {
  TOKEN_STDIN_EXAMPLE,
  clearConfig,
  readConfig,
  resolveCredentials,
  writeConfig,
  type Credentials,
} from "../config.js";
import { AUTH_FLAGS, bool, parseSubcommand, str, type Parsed } from "../flags.js";
import { renderObject } from "../output/index.js";
import { hookSummary } from "./setup.js";

/** `auth setup|whoami|logout` — see `specs/commands/auth.md`. */

// Exported so the docs generator (`scripts/generate-skill.ts`) can render
// the same setup guidance into `skills/calendly-axi/SKILL.md` and the README
// without duplicating the URL/scope strings a third time.
export const TOKEN_CREATION_URL = "https://calendly.com/integrations/api_webhooks";

// The scopes `auth setup`'s guidance lists — kept in lockstep with the list
// in `specs/api/conventions.md`.
export const REQUIRED_SCOPES = [
  "users:read",
  "organizations:read",
  "event_types:read/write",
  "scheduled_events:read/write",
  "availability:read/write",
  "scheduling_links:write",
  "webhooks:read/write",
];

export async function authCommand(args: string[]) {
  const { sub, parsed } = parseSubcommand("auth", args, AUTH_FLAGS);
  switch (sub) {
    case "setup":
      return authSetup(parsed);
    case "whoami":
      return authWhoami(parsed);
    case "logout":
      return authLogout();
    default:
      // Unreachable — parseSubcommand already validated `sub` against AUTH_FLAGS.
      throw new AxiError(`unknown auth subcommand "${sub}"`, "VALIDATION_ERROR", []);
  }
}

const SETUP_USAGE = "calendly-axi auth setup (--token-stdin | --token <pat>)";

/**
 * Resolve the token `auth setup` was handed, from exactly one channel
 * (specs/commands/auth.md#auth-setup): `--token-stdin` (the documented
 * default) or `--token <pat>`. Returns undefined when neither was given.
 * Never a prompt — stdin is read only when the flag explicitly asked for it,
 * so the command can't block on a TTY it wasn't told to read.
 */
function resolveSetupToken(parsed: Parsed): string | undefined {
  const inline = str(parsed, "--token");
  const fromStdin = bool(parsed, "--token-stdin");

  if (inline !== undefined && fromStdin) {
    throw new AxiError("--token and --token-stdin are mutually exclusive", "USAGE", [SETUP_USAGE]);
  }
  if (inline !== undefined) return inline;
  if (!fromStdin) return undefined;

  let raw = "";
  try {
    raw = readFileSync(0, "utf-8");
  } catch {
    raw = "";
  }
  const token = raw.replace(/\r?\n$/, "");
  if (token.trim().length === 0) {
    throw new AxiError("--token-stdin was set but stdin carried no token", "USAGE", [
      `Pipe the token in without echo or history: \`${TOKEN_STDIN_EXAMPLE}\``,
    ]);
  }
  return token;
}

async function authSetup(parsed: Parsed) {
  const token = resolveSetupToken(parsed);

  if (!token) {
    const existing = resolveCredentials();
    if (!existing) {
      // Unconfigured + no token: a structured instruction, not a prompt.
      throw new AxiError("No Calendly Personal Access Token configured", "VALIDATION_ERROR", [
        `Create a Personal Access Token at ${TOKEN_CREATION_URL} (Integrations → API & Webhooks → Generate new token)`,
        `Grant these scopes: ${REQUIRED_SCOPES.join(", ")}`,
        `Then pipe it in without echo or history: \`${TOKEN_STDIN_EXAMPLE}\``,
        "Or set CALENDLY_ACCESS_TOKEN in the environment (nothing is stored; it takes precedence over config)",
      ]);
    }
    // Already configured, no token given: the "repair my ambient setup"
    // path — revalidate and refresh the cache. The hook is only reported;
    // `setup hooks` is the one path that writes it.
    const profile = await fetchProfile(existing);
    if (existing.source === "config") {
      writeConfig({ ...readConfig(), profile_cache: profile });
    }
    return renderObject({
      status: "already connected (revalidated)",
      name: profile.name,
      email: profile.email,
      scheduling_url: profile.scheduling_url,
      organization: profile.organization_uri,
      session_hook: hookSummary(),
    });
  }

  const creds: Credentials = { token, source: "config" };
  const profile = await fetchProfile(creds); // validates the token

  writeConfig({ version: readConfig().version, token, profile_cache: profile });

  return renderObject({
    status: "connected",
    name: profile.name,
    email: profile.email,
    scheduling_url: profile.scheduling_url,
    organization: profile.organization_uri,
    session_hook: hookSummary(),
  });
}

async function authWhoami(parsed: Parsed) {
  const creds = resolveCredentials();
  if (!creds) {
    return renderObject({
      status: "not configured",
      help: `Run \`${TOKEN_STDIN_EXAMPLE}\` to connect your Calendly account`,
    });
  }

  const cfg = readConfig();
  let profile = cfg.profile_cache;
  if (bool(parsed, "--refresh") || !profile) {
    profile = await fetchProfile(creds);
    if (creds.source === "config") {
      writeConfig({ ...cfg, profile_cache: profile });
    }
  }

  return renderObject({
    name: profile.name,
    email: profile.email,
    scheduling_url: profile.scheduling_url,
    organization: profile.organization_uri,
    source: creds.source,
  });
}

function authLogout() {
  // Read the config directly — an env token would mask a stored one in
  // resolveCredentials(), and we must report the file removal accurately.
  const hadConfig = !!readConfig().token;
  const envStillSet = !!process.env.CALENDLY_ACCESS_TOKEN;
  clearConfig();
  return renderObject({
    status: hadConfig ? "logged out (credentials removed)" : "no stored credentials (no-op)",
    ...(envStillSet
      ? { note: "CALENDLY_ACCESS_TOKEN is still set in the environment — commands will keep working" }
      : {}),
  });
}
