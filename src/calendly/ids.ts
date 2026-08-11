import { AxiError } from "axi-sdk-js";

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
  | "no_shows";

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
 * both kinds. Human-name resolution (event types only) lands with the
 * `types-read` plan — this module is UUID↔URI only.
 */
export function resolveIdentifier(
  kind: ResourceKind,
  value: string,
  label = kind,
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
