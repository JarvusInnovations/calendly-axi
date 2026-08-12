import { AxiError } from "axi-sdk-js";
import { paginate } from "./paginate.js";
import type { QueryValue } from "./client.js";

/**
 * Calendly URI resource collections this tool needs to build/parse. Kept as
 * a union rather than an open string so a typo in a call site is a type
 * error, not a silent wrong-kind URI.
 */
export type ResourceKind =
  | "users"
  | "organizations"
  | "event_types"
  | "scheduled_events"
  | "invitees"
  | "webhook_subscriptions"
  | "scheduling_links"
  | "no_shows"
  | "groups";

const BASE_URL = "https://api.calendly.com";

/** True when `value` looks like a full URI rather than a bare UUID. */
export function isUri(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Extract the bare UUID from a Calendly URI — its last path segment. */
export function uuidFromUri(uri: string): string {
  const trimmed = uri.replace(/\/+$/, "");
  const last = trimmed.split("/").pop();
  if (!last) {
    throw new AxiError(`Could not extract an id from "${uri}"`, "VALIDATION_ERROR", [
      "Pass a full Calendly URI (https://api.calendly.com/<kind>/<uuid>) or a bare UUID",
    ]);
  }
  return last;
}

/** The resource-kind path segment a Calendly URI carries (its second-to-last segment). */
export function kindFromUri(uri: string): string | undefined {
  const trimmed = uri.replace(/\/+$/, "");
  const segments = trimmed.split("/");
  return segments[segments.length - 2];
}

/** Build a full Calendly URI from a bare UUID and its resource kind. */
export function uriFromUuid(kind: ResourceKind, uuid: string): string {
  return `${BASE_URL}/${kind}/${uuid}`;
}

export interface ResolvedIdentifier {
  /** Bare UUID — used verbatim in path segments. */
  uuid: string;
  /** Full Calendly URI — used verbatim in query params (URL-encoded by the client). */
  uri: string;
}

/**
 * Normalize an identifier argument that names a resource of `kind` into both
 * forms per `specs/behaviors/identifier-resolution.md`: the bare UUID (path
 * segments) and the full URI (query params). Accepts a bare UUID or a full
 * URI; a URI whose kind doesn't match `kind` is a `VALIDATION_ERROR` naming
 * both kinds. Human-name resolution (event types only) is a separate
 * function — `resolveEventTypeIdentifier`, below — since it needs an API
 * sweep this synchronous helper can't do.
 */
export function resolveIdentifier(
  kind: ResourceKind,
  value: string,
  label: string = kind,
): ResolvedIdentifier {
  if (isUri(value)) {
    const actualKind = kindFromUri(value);
    if (actualKind !== kind) {
      throw new AxiError(
        `"${value}" is a ${actualKind ?? "unrecognized"} URI, but a ${label} identifier was expected`,
        "VALIDATION_ERROR",
        [`Pass a ${label} UUID or a URI shaped like ${uriFromUuid(kind, "<uuid>")}`],
      );
    }
    return { uuid: uuidFromUri(value), uri: value };
  }
  return { uuid: value, uri: uriFromUuid(kind, value) };
}

// ── Event-type name resolution ──────────────────────────────────────
// The one resource kind that accepts a human name (identifier-resolution.md
// §3). Exported for reuse by every command that takes a `<type>` argument —
// `types view/slots/availability` (this plan), and `link` / `book --type`
// (later plans: events-write, book).

/**
 * A value that's neither a URI nor one of these shapes is treated as a name
 * to resolve, not a bare id to use verbatim. Live Calendly accounts carry
 * two id shapes side by side: legacy uppercase tokens (`AEFC3UHIYDAV6KFA`)
 * and canonical lowercase dashed UUIDs (`4fce2d6b-c166-4d77-aeae-...`) —
 * confirmed against a real account, where most event types use the
 * canonical form. A human name reliably has a space or at least one
 * lowercase letter outside the hex-dash alphabet, so single-word names
 * (`"Meeting"`) still fall through to the sweep. A name that is all-caps
 * with no spaces (`"STANDUP"`) remains the one known gap — it would 404 as
 * a bad id rather than resolving by name.
 */
const LEGACY_TOKEN_RE = /^[A-Z0-9_-]+$/;
const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isBareId(value: string): boolean {
  return LEGACY_TOKEN_RE.test(value) || CANONICAL_UUID_RE.test(value);
}

interface EventTypeCandidate {
  uuid: string;
  uri: string;
  name: string;
}

function ambiguousEventType(name: string, candidates: EventTypeCandidate[]): never {
  throw new AxiError(`Multiple event types match "${name}"`, "VALIDATION_ERROR", [
    ...candidates.map((c) => `${c.uuid} (${c.name})`),
    "Pass the exact uuid, or a name that matches only one of the above",
  ]);
}

async function resolveEventTypeByName(
  name: string,
  scopeQuery: Record<string, QueryValue>,
): Promise<ResolvedIdentifier> {
  // Drained per identifier-resolution.md — not cached, since event-type
  // names are mutable.
  const { items } = await paginate<{ uri: string; name: string }>("event_types", {
    ...scopeQuery,
    sort: "name:asc",
  });
  const candidates: EventTypeCandidate[] = items.map((item) => ({
    uuid: uuidFromUri(item.uri),
    uri: item.uri,
    name: item.name,
  }));

  const needle = name.toLowerCase();
  const exact = candidates.filter((c) => c.name.toLowerCase() === needle);
  if (exact.length === 1) return { uuid: exact[0]!.uuid, uri: exact[0]!.uri };
  if (exact.length > 1) ambiguousEventType(name, exact);

  const substring = candidates.filter((c) => c.name.toLowerCase().includes(needle));
  if (substring.length === 1) return { uuid: substring[0]!.uuid, uri: substring[0]!.uri };
  if (substring.length > 1) ambiguousEventType(name, substring);

  throw new AxiError(`No event type found matching "${name}"`, "NOT_FOUND", [
    "Run `calendly-axi types list` to see available event types",
  ]);
}

/**
 * Resolve a `<type>` argument — bare UUID, full event-type URI, or a human
 * name — per `specs/behaviors/identifier-resolution.md`. UUID/URI forms
 * resolve synchronously via `resolveIdentifier`, no API call. Anything else
 * is swept against `GET /event_types`: case-insensitive exact match on
 * `name` wins; failing that, case-insensitive substring match. Zero hits →
 * `NOT_FOUND` suggesting `types list`; multiple hits (at either tier) →
 * `VALIDATION_ERROR` listing each `<uuid> (<name>)` candidate so the next
 * call can be exact.
 *
 * `scopeQuery` is the caller's already-resolved `{ user }` or
 * `{ organization }` query params (from `resolveScope`/`resolveSelf` in
 * `scope.ts`) — this module takes it as data rather than importing
 * `scope.ts` itself, to avoid an ids.ts↔scope.ts import cycle (`scope.ts`
 * already imports from `ids.ts`).
 */
export async function resolveEventTypeIdentifier(
  value: string,
  scopeQuery: Record<string, QueryValue>,
): Promise<ResolvedIdentifier> {
  if (isUri(value) || isBareId(value)) {
    return resolveIdentifier("event_types", value);
  }
  return resolveEventTypeByName(value, scopeQuery);
}
