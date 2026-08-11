import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_VERSION = 1;

/**
 * Bootstrap identity cached from `GET /users/me` at `auth setup` time. Every
 * command defaults its scoping to this cached self — see
 * `specs/behaviors/scoping.md`.
 */
export interface ProfileCache {
  user_uri: string;
  user_uuid: string;
  name: string;
  email: string;
  scheduling_url: string;
  timezone: string;
  organization_uri: string;
  organization_uuid: string;
  cached_at: string;
}

export interface CalendlyConfig {
  version: number;
  token?: string;
  profile_cache?: ProfileCache;
}

/** Resolved credentials, from env (precedence) or config file. */
export interface Credentials {
  token: string;
  /** "env" | "config" — surfaced by `doctor`/`whoami` so the source is visible. */
  source: "env" | "config";
}

// Paths ────────────────────────────────────────────────────────────
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg
    ? join(xdg, "calendly-axi")
    : join(homedir(), ".config", "calendly-axi");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

// Config read/write ───────────────────────────────────────────────
export function defaultConfig(): CalendlyConfig {
  return { version: CONFIG_VERSION };
}

/** Any unparseable config falls back to defaults — never throws. */
export function readConfig(): CalendlyConfig {
  const path = configPath();
  if (!existsSync(path)) return defaultConfig();
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CalendlyConfig;
  } catch {
    return defaultConfig();
  }
}

/** Writes `config.json` at mode 0600 inside a 0700 config directory. */
export function writeConfig(cfg: CalendlyConfig): void {
  const dir = configDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Best-effort — a permission mismatch here shouldn't block config writes.
    }
  }

  const path = configPath();
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort, same rationale as above.
  }
}

export function clearConfig(): void {
  const path = configPath();
  if (existsSync(path)) rmSync(path, { force: true });
}

// Credential resolution ─────────────────────────────────────────────
/**
 * Resolve credentials with env taking precedence over the config file, per
 * the architecture spec (env override exists for CI/cron). Returns null when
 * neither source provides a token.
 */
export function resolveCredentials(): Credentials | null {
  const envToken = process.env.CALENDLY_ACCESS_TOKEN;
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  const cfg = readConfig();
  if (cfg.token) {
    return { token: cfg.token, source: "config" };
  }

  return null;
}

export function isConfigured(): boolean {
  return resolveCredentials() !== null;
}
