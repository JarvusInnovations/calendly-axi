import { AxiError } from "axi-sdk-js";
import { fetchProfile } from "../calendly/scope.js";
import { clearConfig, readConfig, resolveCredentials, writeConfig, type Credentials } from "../config.js";
import { AUTH_FLAGS, bool, parseSubcommand, str, type Parsed } from "../flags.js";
import { renderObject } from "../output/index.js";
import { installHooks } from "./hook.js";

/** `auth setup|whoami|logout` — see `specs/commands/auth.md`. */

const TOKEN_CREATION_URL = "https://calendly.com/integrations/api_webhooks";

// The scopes `auth setup`'s guidance lists — kept in lockstep with the list
// in `specs/api/conventions.md`.
const REQUIRED_SCOPES = [
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

async function authSetup(parsed: Parsed) {
  const token = str(parsed, "--token");

  if (!token) {
    const existing = resolveCredentials();
    if (!existing) {
      // Unconfigured + no token: a structured instruction, not a prompt.
      throw new AxiError("No Calendly Personal Access Token configured", "VALIDATION_ERROR", [
        `Create a Personal Access Token at ${TOKEN_CREATION_URL} (Integrations → API & Webhooks → Generate new token)`,
        `Grant these scopes: ${REQUIRED_SCOPES.join(", ")}`,
        "Then run `calendly-axi auth setup --token <pat>`",
      ]);
    }
    // Already configured, no --token given: the "repair my ambient setup"
    // path — revalidate, refresh the cache, (re)install the hook.
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
      session_hook: installHooks(),
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
    session_hook: installHooks(),
  });
}

async function authWhoami(parsed: Parsed) {
  const creds = resolveCredentials();
  if (!creds) {
    return renderObject({
      status: "not configured",
      help: "Run `calendly-axi auth setup --token <pat>` to connect your Calendly account",
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
