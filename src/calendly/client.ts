import { AxiError } from "axi-sdk-js";
import { resolveCredentials, type Credentials } from "../config.js";

const BASE_URL = "https://api.calendly.com";
const USER_AGENT = "calendly-axi (https://github.com/JarvusInnovations/calendly-axi)";
const TOKEN_CREATION_URL = "https://calendly.com/integrations/api_webhooks";

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
  /** Override resolved credentials (e.g. during `auth setup` validation). */
  credentials?: Credentials;
}

/** Get credentials or throw the canonical "not configured" AxiError. */
export function requireCredentials(): Credentials {
  const creds = resolveCredentials();
  if (!creds) {
    throw new AxiError("No Calendly credentials configured", "TOKEN_INVALID", [
      "Run `calendly-axi auth setup --token <pat>` to connect your account",
      `Create a Personal Access Token at ${TOKEN_CREATION_URL}`,
    ]);
  }
  return creds;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${BASE_URL}/${path.replace(/^\//, "")}`);
  if (query) {
    // URLSearchParams encodes every value, satisfying the conventions spec's
    // "URIs in query strings must be URL-encoded" requirement for free.
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

// Rate-limit headroom ────────────────────────────────────────────────
export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** Seconds until the window resets (per `X-RateLimit-Reset`). */
  reset?: number;
}

let lastRateLimit: RateLimitInfo | undefined;

/** Rate-limit headroom captured from the most recent response — `doctor` surfaces this. */
export function getRateLimitInfo(): RateLimitInfo | undefined {
  return lastRateLimit;
}

function captureRateLimit(headers: Headers): void {
  const limit = headers.get("X-RateLimit-Limit");
  const remaining = headers.get("X-RateLimit-Remaining");
  const reset = headers.get("X-RateLimit-Reset");
  if (limit === null && remaining === null && reset === null) return;
  lastRateLimit = {
    limit: limit !== null ? Number(limit) : undefined,
    remaining: remaining !== null ? Number(remaining) : undefined,
    reset: reset !== null ? Number(reset) : undefined,
  };
}

// Error translation ─────────────────────────────────────────────────
interface CalendlyErrorBody {
  title?: string;
  message?: string;
  details?: Array<{ parameter?: string; message?: string }>;
}

async function parseErrorBody(res: Response): Promise<CalendlyErrorBody | null> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as CalendlyErrorBody;
  } catch {
    // Non-JSON body — keep a capped plain-text message, never the raw dump.
    return { message: text.slice(0, 300) };
  }
}

/**
 * Translate a Calendly HTTP error response into an AxiError with an
 * actionable suggestion, per the error-mapping table in
 * `specs/api/conventions.md`. Raw response bodies never reach stdout.
 */
async function translateCalendlyError(res: Response, operation: string): Promise<AxiError> {
  const body = await parseErrorBody(res);
  const title = body?.title ?? "";
  const message = body?.message ?? "";
  const suffix = message ? `: ${message}` : "";
  const haystack = `${title} ${message}`.toLowerCase();

  switch (res.status) {
    case 400: {
      const details = body?.details ?? [];
      const restated =
        details.length > 0
          ? details
              .map((d) => `${d.parameter ?? "?"}: ${d.message ?? "invalid"}`)
              .join("; ")
          : message || "the request was rejected";
      return new AxiError(
        `Calendly rejected the request on ${operation}: ${restated}`,
        "VALIDATION_ERROR",
        ["Check the flag values against the rejected parameter(s) above"],
      );
    }
    case 401:
      return new AxiError(
        "Calendly authentication failed — token invalid, revoked, or missing",
        "TOKEN_INVALID",
        [
          "Run `calendly-axi auth setup` to reconnect with a valid Personal Access Token",
          `Create one at ${TOKEN_CREATION_URL}`,
        ],
      );
    case 403: {
      // Distinguish the three 403 variants by matching the error body's
      // title/message, per conventions.md. Ambiguous bodies fall back to
      // FORBIDDEN naming both possibilities.
      if (haystack.includes("insufficientscope") || haystack.includes("scope")) {
        return new AxiError(`Forbidden on ${operation} — the token is missing a required scope${suffix}`, "FORBIDDEN", [
          "Regenerate your Personal Access Token with the missing scope",
          "Then re-run `calendly-axi auth setup --token <pat>`",
        ]);
      }
      if (haystack.includes("plan") || haystack.includes("upgrade") || haystack.includes("subscription")) {
        return new AxiError(
          `Forbidden on ${operation} — this feature needs a paid Calendly plan${suffix}`,
          "PLAN_REQUIRED",
          ["Upgrade the Calendly plan to unlock this feature — see https://calendly.com/pricing"],
        );
      }
      if (haystack.includes("admin") || haystack.includes("owner") || haystack.includes("role")) {
        return new AxiError(`Forbidden on ${operation} — your account role lacks access${suffix}`, "FORBIDDEN", [
          "An organization admin/owner role is required for this action",
        ]);
      }
      return new AxiError(`Forbidden on ${operation}${suffix}`, "FORBIDDEN", [
        "This may be a missing token scope — regenerate your PAT with the required scope",
        "Or a plan/role restriction — check the Calendly plan and your organization role",
      ]);
    }
    case 404:
      return new AxiError(`Not found on ${operation}${suffix}`, "NOT_FOUND", [
        "Run the relevant `list` command to find valid ids",
      ]);
    case 409:
      return new AxiError(`Conflict on ${operation}${suffix}`, "CONFLICT", [
        "Refetch the current state and retry with up-to-date data",
      ]);
    case 429: {
      const reset = res.headers.get("X-RateLimit-Reset");
      return new AxiError(`Rate limited on ${operation}`, "RATE_LIMITED", [
        reset ? `Wait ${reset} seconds before retrying` : "Wait a short while before retrying",
      ]);
    }
    default:
      if (res.status >= 500) {
        return new AxiError(`Calendly server error (${res.status}) on ${operation}`, "SERVER_ERROR", [
          "Retry after a moment",
        ]);
      }
      return new AxiError(
        `Calendly API error ${res.status} on ${operation}${suffix}`,
        `CALENDLY_API_ERROR_${res.status}`,
        [],
      );
  }
}

/**
 * Make an authed Calendly request. Injects the two required headers
 * (single bearer token — no account-id header, unlike harvest-axi),
 * captures rate-limit headroom, sends/parses JSON, and translates errors.
 * DELETE and other empty 2xx responses resolve to an empty object.
 */
export async function calendlyRequest<T = Record<string, unknown>>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const creds = options.credentials ?? requireCredentials();
  const method = options.method ?? "GET";
  const operation = `${method} ${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers };
  if (options.body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), init);
  } catch (err) {
    throw new AxiError(
      `Network error on ${operation}: ${err instanceof Error ? err.message : String(err)}`,
      "NETWORK_ERROR",
      ["Check connectivity and retry"],
    );
  }

  captureRateLimit(res.headers);

  if (!res.ok) throw await translateCalendlyError(res, operation);

  // 204 / empty body (e.g. DELETE) → empty object.
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}
