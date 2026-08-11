import { AxiError } from "axi-sdk-js";
import { calendlyRequest, requireCredentials, type QueryValue } from "../calendly/client.js";
import { resolveIdentifier, uuidFromUri } from "../calendly/ids.js";
import { paginate, paginationSummary } from "../calendly/paginate.js";
import { resolveSelf, resolveUserFlag } from "../calendly/scope.js";
import type { Credentials } from "../config.js";
import { parseSubcommand, requirePositional, str, WEBHOOKS_FLAGS, type Parsed } from "../flags.js";
import { field, joinBlocks, renderHelp, renderListResponse, renderObject, type FieldDef } from "../output/index.js";

/**
 * `webhooks list|view|create|delete|sample` — see `specs/commands/webhooks.md`
 * and `specs/api/webhooks.md`. Out of scope entirely: any local
 * webhook receiver/listener.
 */

// ── Scope resolution ────────────────────────────────────────────────
// Unlike `resolveScope` (which widens from a self-as-default-user shape),
// webhooks endpoints take a three-way `scope` that always defaults to
// `organization` over the cached org — see specs/behaviors/scoping.md and
// specs/commands/webhooks.md. Parsing the raw `--scope`/`--user`/`--group`
// flags is kept network-free so `create`'s "unknown event → zero API calls"
// guarantee holds even when scope validation also fails.

type WebhookScopeKind = "organization" | "user" | "group";

interface WebhookScopeParams {
  scope: WebhookScopeKind;
  organization: string;
  user?: string;
  group?: string;
}

function parseScope(parsed: Parsed): WebhookScopeKind {
  const raw = str(parsed, "--scope", "organization");
  if (raw !== "organization" && raw !== "user" && raw !== "group") {
    throw new AxiError(`invalid --scope "${raw}"`, "VALIDATION_ERROR", [
      "valid values: organization, user, group",
    ]);
  }
  return raw;
}

/** Pure (no network): reject flag/scope combinations the API doesn't accept. */
function validateScopeCombo(parsed: Parsed, scope: WebhookScopeKind): void {
  const userFlag = str(parsed, "--user");
  const groupFlag = str(parsed, "--group");
  if (scope !== "user" && userFlag) {
    throw new AxiError(`--user only applies with --scope user (got --scope ${scope})`, "VALIDATION_ERROR", [
      "Pass --scope user, or drop --user",
    ]);
  }
  if (scope !== "group" && groupFlag) {
    throw new AxiError(`--group only applies with --scope group (got --scope ${scope})`, "VALIDATION_ERROR", [
      "Pass --scope group, or drop --group",
    ]);
  }
  if (scope === "group" && !groupFlag) {
    throw new AxiError("--scope group requires --group <id>", "VALIDATION_ERROR", [
      "Pass --group <id>, or use --scope organization|user",
    ]);
  }
}

/**
 * Full scope resolution, including the cached-org lookup and (for
 * `--scope user` with an email, or an uncached self) the network calls that
 * entails. Callers that need a network-free validation pass first (`create`)
 * should call `parseScope`/`validateScopeCombo` directly before this.
 */
async function resolveWebhookScope(parsed: Parsed, credentials: Credentials): Promise<WebhookScopeParams> {
  const scope = parseScope(parsed);
  validateScopeCombo(parsed, scope);

  const self = await resolveSelf(credentials);
  const result: WebhookScopeParams = { scope, organization: self.organization_uri };

  if (scope === "user") {
    const userFlag = str(parsed, "--user");
    result.user = userFlag ? await resolveUserFlag(userFlag, self, credentials) : self.user_uri;
  }
  if (scope === "group") {
    result.group = resolveIdentifier("groups", str(parsed, "--group")!, "group").uri;
  }

  return result;
}

function scopeQuery(params: WebhookScopeParams): Record<string, QueryValue> {
  return {
    organization: params.organization,
    scope: params.scope,
    user: params.user,
    group: params.group,
  };
}

// ── Event validation ─────────────────────────────────────────────────
// The known event list and per-scope constraints from specs/api/webhooks.md
// §Events — kept in lockstep with that table.

const KNOWN_EVENTS = [
  "invitee.created",
  "invitee.canceled",
  "invitee_no_show.created",
  "invitee_no_show.deleted",
  "event_type.created",
  "event_type.updated",
  "event_type.deleted",
  "meeting_recap.created",
  "meeting_recap.updated",
  "meeting_recap.deleted",
  "routing_form_submission.created",
  "contact.created",
  "contact.updated",
  "contact.deleted",
] as const;

function parseEventsCsv(raw: string): string[] {
  const events = raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (events.length === 0) {
    throw new AxiError("--events must list at least one event", "VALIDATION_ERROR", [
      `valid events: ${KNOWN_EVENTS.join(", ")}`,
    ]);
  }
  return events;
}

/**
 * Client-side event validation — unknown events and per-scope constraint
 * violations (`meeting_recap.*` user-only, `routing_form_submission.created`
 * org-only) fail fast with exit 2, before any API call.
 */
function validateEvents(events: string[], scope: WebhookScopeKind): void {
  const unknown = events.filter((e) => !(KNOWN_EVENTS as readonly string[]).includes(e));
  if (unknown.length > 0) {
    throw new AxiError(`unknown webhook event(s): ${unknown.join(", ")}`, "VALIDATION_ERROR", [
      `valid events: ${KNOWN_EVENTS.join(", ")}`,
    ]);
  }
  for (const event of events) {
    if (event.startsWith("meeting_recap.") && scope !== "user") {
      throw new AxiError(
        `"${event}" is only valid under --scope user (got --scope ${scope})`,
        "VALIDATION_ERROR",
        ["meeting_recap.* events require --scope user"],
      );
    }
    if (event === "routing_form_submission.created" && scope !== "organization") {
      throw new AxiError(
        `"routing_form_submission.created" is only valid under --scope organization (got --scope ${scope})`,
        "VALIDATION_ERROR",
        ["routing_form_submission.created requires --scope organization"],
      );
    }
  }
}

function assertHttpsUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AxiError(`--url "${raw}" is not a valid URL`, "VALIDATION_ERROR", [
      "Pass a full https:// callback URL, e.g. --url https://example.com/webhooks/calendly",
    ]);
  }
  if (parsed.protocol !== "https:") {
    throw new AxiError(`--url must be an https:// URL (got "${parsed.protocol}")`, "VALIDATION_ERROR", [
      "Calendly requires an HTTPS callback URL for webhook subscriptions",
    ]);
  }
}

// ── Rendering ────────────────────────────────────────────────────────

const LIST_SCHEMA: FieldDef[] = [
  { name: "uuid", extract: (item) => uuidFromUri(String(item.uri ?? "")) },
  field("callback_url"),
  field("state"),
  field("scope"),
  {
    name: "events",
    extract: (item) => (Array.isArray(item.events) ? (item.events as string[]).join(",") : ""),
  },
];

/** Full detail fields per specs/commands/webhooks.md#webhooks-view. */
function webhookDetailFields(resource: Record<string, unknown>): Record<string, unknown> {
  const uri = String(resource.uri ?? "");
  const fields: Record<string, unknown> = {
    uuid: uuidFromUri(uri),
    uri,
    callback_url: resource.callback_url,
    state: resource.state,
    events: resource.events,
    scope: resource.scope,
  };
  if (resource.scope === "user" && resource.user) fields.user = resource.user;
  if (resource.scope === "group" && resource.group) fields.group = resource.group;
  fields.creator = resource.creator;
  fields.created_at = resource.created_at;
  if (resource.retry_started_at) {
    fields.retry_started_at = resource.retry_started_at;
    fields.deliveries = `failing since ${resource.retry_started_at} — Calendly is retrying`;
  }
  return fields;
}

const SAMPLE_MAX_CHARS = 4000;

function renderSample(event: string, payload: unknown): string {
  const json = JSON.stringify(payload, null, 2);
  if (json.length <= SAMPLE_MAX_CHARS) {
    return joinBlocks(renderObject({ event }), `payload:\n${json}`);
  }
  const truncated = json.slice(0, SAMPLE_MAX_CHARS);
  return joinBlocks(
    renderObject({ event }),
    `payload:\n${truncated}\n... (truncated)`,
    renderObject({ note: `payload truncated to ${SAMPLE_MAX_CHARS} of ${json.length} chars total` }),
  );
}

// ── Subcommands ──────────────────────────────────────────────────────

async function webhooksList(parsed: Parsed): Promise<string> {
  const creds = requireCredentials();
  const scopeParams = await resolveWebhookScope(parsed, creds);

  const result = await paginate<Record<string, unknown>>("webhook_subscriptions", scopeQuery(scopeParams));

  const header: Record<string, unknown> = { scope: scopeParams.scope, organization: scopeParams.organization };
  if (scopeParams.user) header.user = scopeParams.user;
  if (scopeParams.group) header.group = scopeParams.group;

  return renderListResponse({
    header,
    summary: paginationSummary(result),
    name: "webhooks",
    items: result.items,
    schema: LIST_SCHEMA,
    emptyMessage: `0 webhook subscriptions for scope=${scopeParams.scope}`,
    suggestions: [
      "Run `calendly-axi webhooks view <uuid>` for full detail",
      "Run `calendly-axi webhooks create --url <https-url> --events <e,e>` to add a subscription",
      "Run `calendly-axi webhooks sample --event <e>` to see what a delivery looks like",
    ],
  });
}

async function webhooksView(parsed: Parsed): Promise<string> {
  const creds = requireCredentials();
  const idArg = requirePositional(parsed, 0, "webhook", "calendly-axi webhooks view <webhook>");
  const { uuid } = resolveIdentifier("webhook_subscriptions", idArg, "webhook");

  const res = await calendlyRequest<{ resource: Record<string, unknown> }>(`webhook_subscriptions/${uuid}`, {
    credentials: creds,
  });

  // Self-contained detail view — no suggestions per AXI §9.
  return renderObject({ webhook: webhookDetailFields(res.resource) });
}

async function findExistingSubscription(
  scopeParams: WebhookScopeParams,
  url: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await paginate<Record<string, unknown>>("webhook_subscriptions", scopeQuery(scopeParams));
  return result.items.find((item) => item.callback_url === url);
}

async function webhooksCreate(parsed: Parsed): Promise<string> {
  const creds = requireCredentials();

  const url = str(parsed, "--url");
  if (!url) {
    throw new AxiError("--url is required", "VALIDATION_ERROR", [
      "Run `calendly-axi webhooks create --url <https-url> --events <e,e>`",
    ]);
  }
  assertHttpsUrl(url);

  const eventsRaw = str(parsed, "--events");
  if (!eventsRaw) {
    throw new AxiError("--events is required", "VALIDATION_ERROR", [
      "Run `calendly-axi webhooks create --url <https-url> --events <e,e>`",
      `valid events: ${KNOWN_EVENTS.join(", ")}`,
    ]);
  }
  const events = parseEventsCsv(eventsRaw);

  // Network-free first: unknown events / per-scope violations fail with
  // zero API calls, per plans/webhooks.md's validation criteria.
  const scope = parseScope(parsed);
  validateScopeCombo(parsed, scope);
  validateEvents(events, scope);

  const scopeParams = await resolveWebhookScope(parsed, creds);

  const body: Record<string, unknown> = {
    url,
    events,
    organization: scopeParams.organization,
    scope: scopeParams.scope,
  };
  if (scopeParams.user) body.user = scopeParams.user;
  if (scopeParams.group) body.group = scopeParams.group;
  const signingKey = str(parsed, "--signing-key");
  if (signingKey) body.signing_key = signingKey; // passed through, never persisted to config

  try {
    const res = await calendlyRequest<{ resource: Record<string, unknown> }>("webhook_subscriptions", {
      method: "POST",
      credentials: creds,
      body,
    });
    return joinBlocks(
      renderObject({ webhook: webhookDetailFields(res.resource) }),
      renderHelp([`Run \`calendly-axi webhooks sample --event ${events[0]}\` to see what deliveries look like`]),
    );
  } catch (err) {
    if (err instanceof AxiError && err.code === "CONFLICT") {
      // Duplicate (same url/events/scope) — fetch and report the existing
      // subscription as an already-subscribed no-op, per specs/api/webhooks.md.
      const existing = await findExistingSubscription(scopeParams, url);
      if (existing) {
        return renderObject({
          status: "already subscribed (no-op)",
          webhook: webhookDetailFields(existing),
        });
      }
    }
    throw err;
  }
}

async function webhooksDelete(parsed: Parsed): Promise<string> {
  const creds = requireCredentials();
  const idArg = requirePositional(parsed, 0, "webhook", "calendly-axi webhooks delete <webhook>");
  const { uuid } = resolveIdentifier("webhook_subscriptions", idArg, "webhook");

  try {
    await calendlyRequest(`webhook_subscriptions/${uuid}`, { method: "DELETE", credentials: creds });
    return renderObject({ status: "deleted", uuid });
  } catch (err) {
    if (err instanceof AxiError && err.code === "NOT_FOUND") {
      // Idempotent — already gone is success, not an error.
      return renderObject({ status: "already gone (no-op)", uuid });
    }
    throw err;
  }
}

async function webhooksSample(parsed: Parsed): Promise<string> {
  const creds = requireCredentials();
  const event = str(parsed, "--event");
  if (!event) {
    throw new AxiError("--event is required", "VALIDATION_ERROR", [
      "Run `calendly-axi webhooks sample --event <event>`",
      `valid events: ${KNOWN_EVENTS.join(", ")}`,
    ]);
  }

  // `sample`'s flags omit --group (see specs/commands/webhooks.md) — a
  // --scope group here has no --group to pair with, so validateScopeCombo's
  // "--scope group requires --group" branch is what surfaces that boundary.
  const scope = parseScope(parsed);
  validateScopeCombo(parsed, scope);
  validateEvents([event], scope);

  const scopeParams = await resolveWebhookScope(parsed, creds);

  const res = await calendlyRequest<{ resource: unknown }>("sample_webhook_data", {
    credentials: creds,
    query: { event, ...scopeQuery(scopeParams) },
  });

  return renderSample(event, res.resource);
}

export async function webhooksCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("webhooks", args, WEBHOOKS_FLAGS, "list");
  switch (sub) {
    case "list":
      return webhooksList(parsed);
    case "view":
      return webhooksView(parsed);
    case "create":
      return webhooksCreate(parsed);
    case "delete":
      return webhooksDelete(parsed);
    case "sample":
      return webhooksSample(parsed);
    default:
      // Unreachable — parseSubcommand already validated `sub` against WEBHOOKS_FLAGS.
      throw new AxiError(`unknown webhooks subcommand "${sub}"`, "VALIDATION_ERROR", []);
  }
}
