import { AxiError } from "axi-sdk-js";
import type { Credentials, ProfileCache } from "../config.js";
import { readConfig } from "../config.js";
import { calendlyRequest } from "./client.js";
import { resolveIdentifier, uuidFromUri } from "./ids.js";

/**
 * The shared scoping resolver every scope-requiring command consumes — see
 * `specs/behaviors/scoping.md`. Two responsibilities live here:
 *
 *  1. `fetchProfile` / `resolveSelf` — get the authenticated user's identity
 *     (from `GET /users/me`), either live (setup/whoami --refresh, which
 *     persist it themselves) or cached-with-a-one-shot-bootstrap-fallback
 *     (every other command, via `resolveSelf`, which never persists).
 *  2. `resolveScope` — turn `--org`/`--user` flags into the `user`/
 *     `organization` query params a Calendly list endpoint expects, widening
 *     from that cached self per command.
 */

interface UsersMeResource {
  uri: string;
  name: string;
  email: string;
  scheduling_url: string;
  timezone: string;
  current_organization?: string;
}

interface OrganizationMembershipResource {
  uri: string;
  role?: string;
  organization: string;
  user: { uri: string; name?: string; email?: string };
}

/**
 * Fallback for account shapes where `GET /users/me` omits
 * `current_organization` — see the Risks/unknowns note in
 * `plans/auth-identity.md`. Looks up the caller's own organization
 * membership instead. Untested against a live account shape; if reality
 * differs once a token is available, tighten this (and the spec) then.
 */
async function lookupPrimaryOrganization(userUri: string, credentials: Credentials): Promise<string> {
  const res = await calendlyRequest<{ collection: OrganizationMembershipResource[] }>(
    "organization_memberships",
    { credentials, query: { user: userUri, count: 1 } },
  );
  const membership = res.collection[0];
  if (!membership) {
    throw new AxiError(
      "Could not determine your Calendly organization from `users/me` or `organization_memberships`",
      "SERVER_ERROR",
      ["Retry `calendly-axi auth setup` after a moment"],
    );
  }
  return membership.organization;
}

/**
 * Fetch and shape `GET /users/me` into a `ProfileCache` — WITHOUT writing
 * config. Callers that want the result persisted (`auth setup`, `auth
 * whoami --refresh`) write it themselves; callers that just need the
 * identity for this one invocation (`resolveSelf`'s bootstrap path,
 * `doctor`'s token check) don't.
 */
export async function fetchProfile(credentials: Credentials): Promise<ProfileCache> {
  const res = await calendlyRequest<{ resource: UsersMeResource }>("users/me", { credentials });
  const user = res.resource;
  const organizationUri = user.current_organization ?? (await lookupPrimaryOrganization(user.uri, credentials));
  return {
    user_uri: user.uri,
    user_uuid: uuidFromUri(user.uri),
    name: user.name,
    email: user.email,
    scheduling_url: user.scheduling_url,
    timezone: user.timezone,
    organization_uri: organizationUri,
    organization_uuid: uuidFromUri(organizationUri),
    cached_at: new Date().toISOString(),
  };
}

/**
 * Resolve the caller's own identity: the cached profile written at `auth
 * setup` if present, else a one-shot `users/me` bootstrap performed
 * transparently and never persisted — the "env-token-only usage, e.g. CI"
 * path from `specs/behaviors/scoping.md`. Every command that needs
 * self-scope should call this rather than reading
 * `readConfig().profile_cache` directly, so the bootstrap fallback is never
 * missed.
 */
export async function resolveSelf(credentials: Credentials): Promise<ProfileCache> {
  const cached = readConfig().profile_cache;
  if (cached) return cached;
  return fetchProfile(credentials);
}

export interface ScopeFlags {
  /** `--org` — widen to organization scope. */
  org?: boolean;
  /** `--user <id|uri|email>` — target another user. */
  user?: string;
}

/** Query params ready to spread into a `calendlyRequest` call's `query`. */
export interface ResolvedScope {
  user?: string;
  organization?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Resolve a `--user` value (UUID, full URI, or email) to a user URI. An
 * email is looked up via `organization_memberships` scoped to the caller's
 * own organization, per scoping.md; zero or multiple hits behave like name
 * resolution elsewhere in the tool — `NOT_FOUND` with candidates listed.
 */
async function resolveUserFlag(value: string, self: ProfileCache, credentials: Credentials): Promise<string> {
  if (!EMAIL_RE.test(value)) {
    return resolveIdentifier("users", value).uri;
  }
  const res = await calendlyRequest<{ collection: OrganizationMembershipResource[] }>(
    "organization_memberships",
    { credentials, query: { organization: self.organization_uri, email: value } },
  );
  const hits = res.collection;
  if (hits.length === 0) {
    throw new AxiError(`No organization member found with email "${value}"`, "NOT_FOUND", [
      "Check the email address, or pass a user UUID/URI directly",
    ]);
  }
  if (hits.length > 1) {
    throw new AxiError(
      `Multiple organization members match "${value}"`,
      "NOT_FOUND",
      hits.map((h) => `${h.user.uri}${h.user.name ? ` (${h.user.name})` : ""}`),
    );
  }
  return hits[0]!.user.uri;
}

/**
 * Resolve `--org`/`--user` widening against the cached (or bootstrapped)
 * self profile, per `specs/behaviors/scoping.md`:
 *
 *  - neither flag → `{ user: <self> }` (the default: cached-self scope)
 *  - `--org` alone → `{ organization: <self's org> }` (no `user` param)
 *  - `--user <who>` alone → `{ user: <resolved> }`
 *  - both → `{ organization: <self's org>, user: <resolved> }`
 *
 * Which combinations an endpoint actually accepts is a per-command decision
 * (see scoping.md "Details") — this resolver returns whatever was asked
 * for; commands validate/reject unsupported combinations themselves.
 */
export async function resolveScope(flags: ScopeFlags, credentials: Credentials): Promise<ResolvedScope> {
  const self = await resolveSelf(credentials);
  const scope: ResolvedScope = {};

  if (flags.org) {
    scope.organization = self.organization_uri;
  }
  if (flags.user) {
    scope.user = await resolveUserFlag(flags.user, self, credentials);
  } else if (!flags.org) {
    scope.user = self.user_uri;
  }

  return scope;
}
