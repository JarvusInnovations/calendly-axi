import { AxiError } from "axi-sdk-js";
import { calendlyRequest, requireCredentials, type QueryValue } from "../calendly/client.js";
import { resolveIdentifier, uuidFromUri } from "../calendly/ids.js";
import { moreAvailableHint, paginate, paginationSummary } from "../calendly/paginate.js";
import { resolveScope, resolveSelf } from "../calendly/scope.js";
import type { ProfileCache } from "../config.js";
import { EVENTS_FLAGS, bool, parseSubcommand, requirePositional, str, type Parsed } from "../flags.js";
import { compact, joinBlocks, renderHelp, renderListResponse, renderObject } from "../output/index.js";
import type { FieldDef } from "../output/schema.js";
import { formatInZone } from "../time/format.js";
import { resolveWindow } from "../time/windows.js";
import { notImplemented } from "./not-implemented.js";

/**
 * `events list|view|invitees|cancel|no-show` — see `specs/commands/events.md`.
 * Reads (list/view/invitees) land with `events-read`; cancel/no-show land
 * with `events-write`.
 */
export async function eventsCommand(args: string[]) {
  const { sub, parsed } = parseSubcommand("events", args, EVENTS_FLAGS, "list");
  switch (sub) {
    case "list":
      return eventsList(parsed);
    case "view":
      return eventsView(parsed);
    case "invitees":
      return eventsInvitees(parsed);
    case "cancel":
    case "no-show":
      return notImplemented(`events ${sub}`, "events-write");
    default:
      // Unreachable — parseSubcommand already validated `sub` against EVENTS_FLAGS.
      throw new AxiError(`unknown events subcommand "${sub}"`, "VALIDATION_ERROR", []);
  }
}

// ── Shared helpers ───────────────────────────────────────────────────

type EventStatus = "active" | "canceled";

function parseStatus(parsed: Parsed): EventStatus {
  const raw = str(parsed, "--status", "active");
  if (raw !== "active" && raw !== "canceled") {
    throw new AxiError(`invalid --status "${raw}"`, "VALIDATION_ERROR", [
      "Use --status active or --status canceled",
    ]);
  }
  return raw;
}

/** Human label for the resolved scope, e.g. for the header/empty-state line. */
function scopeLabel(orgFlag: boolean, userFlag: string | undefined, self: ProfileCache): string {
  const parts: string[] = [];
  if (orgFlag) parts.push("organization");
  if (userFlag) parts.push(`user:${userFlag}`);
  if (parts.length === 0) parts.push(self.name);
  return parts.join(" + ");
}

// ── events list ──────────────────────────────────────────────────────

async function eventsList(parsed: Parsed) {
  const creds = requireCredentials();
  const self = await resolveSelf(creds);

  const orgFlag = bool(parsed, "--org");
  const userFlagRaw = str(parsed, "--user");
  const scope = await resolveScope({ org: orgFlag, user: userFlagRaw }, creds, self);
  const status = parseStatus(parsed);

  const window = resolveWindow(
    {
      from: str(parsed, "--from"),
      to: str(parsed, "--to"),
      since: str(parsed, "--since"),
      until: str(parsed, "--until"),
    },
    { timeZone: self.timezone },
  );

  // Past-window requests flip the default sort to descending — see
  // `specs/commands/events.md`. `--since` always looks backward; `--to`
  // without `--since` only counts as "past" when it resolved before now.
  const sinceFlag = str(parsed, "--since");
  const toFlag = str(parsed, "--to");
  const isPastWindow =
    sinceFlag !== undefined || (toFlag !== undefined && window.to !== undefined && new Date(window.to) < new Date());
  const sort = isPastWindow ? "start_time:desc" : "start_time:asc";

  const limitRaw = str(parsed, "--limit");
  let limit = 100;
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 0) {
      throw new AxiError(`invalid --limit "${limitRaw}"`, "VALIDATION_ERROR", [
        "--limit expects a non-negative integer (0 drains the cursor explicitly)",
      ]);
    }
    limit = n;
  }

  const query: Record<string, QueryValue> = {
    ...scope,
    status,
    min_start_time: window.from,
    max_start_time: window.to,
    sort,
    invitee_email: str(parsed, "--email"),
  };

  const result = await paginate<Record<string, unknown>>("scheduled_events", query, limit);

  const showStatusColumn = status !== "active";
  const schema: FieldDef[] = [
    { name: "uuid", extract: (e) => uuidFromUri(String(e.uri)) },
    { name: "start", extract: (e) => formatInZone(String(e.start_time), self.timezone) },
    { name: "name", extract: (e) => e.name },
    {
      name: "invitees",
      extract: (e) => (e.invitees_counter as { active?: number } | undefined)?.active,
    },
  ];
  if (showStatusColumn) schema.push({ name: "status", extract: (e) => e.status });

  const label = scopeLabel(orgFlag, userFlagRaw, self);
  const baseSuggestions = [
    "calendly-axi events view <uuid>",
    "calendly-axi events invitees <uuid>",
    'calendly-axi events cancel <uuid> --reason "..."',
  ];

  return renderListResponse({
    header: { scope: label, window: window.label, status },
    summary: paginationSummary(result),
    name: "events",
    items: result.items,
    schema,
    suggestions: result.complete ? baseSuggestions : [...baseSuggestions, moreAvailableHint()],
    emptyMessage: `0 ${status} events for ${label}, ${window.label}`,
  });
}

// ── events view ──────────────────────────────────────────────────────

async function eventsView(parsed: Parsed) {
  const creds = requireCredentials();
  const self = await resolveSelf(creds);

  const eventArg = requirePositional(parsed, 0, "event", "calendly-axi events view <event>");
  const { uuid } = resolveIdentifier("scheduled_events", eventArg);

  const res = await calendlyRequest<{ resource: Record<string, unknown> }>(`scheduled_events/${uuid}`, {
    credentials: creds,
  });
  const event = res.resource;
  const status = String(event.status ?? "");

  const eventTypeUri = typeof event.event_type === "string" ? event.event_type : undefined;
  let eventTypeName: string | undefined;
  if (eventTypeUri) {
    const etRes = await calendlyRequest<{ resource: { name?: string } }>(
      `event_types/${uuidFromUri(eventTypeUri)}`,
      { credentials: creds },
    );
    eventTypeName = etRes.resource?.name;
  }

  const location = event.location as Record<string, unknown> | undefined;
  const memberships = (event.event_memberships as Array<Record<string, unknown>> | undefined) ?? [];
  const guests = (event.event_guests as Array<Record<string, unknown>> | undefined) ?? [];

  const detail = compact({
    uuid,
    uri: event.uri,
    name: event.name,
    status,
    start: formatInZone(String(event.start_time), self.timezone),
    start_iso: event.start_time,
    end: formatInZone(String(event.end_time), self.timezone),
    end_iso: event.end_time,
    event_type: eventTypeUri
      ? compact({ uuid: uuidFromUri(eventTypeUri), name: eventTypeName })
      : undefined,
    location: location
      ? compact({ type: location.type, join_url: location.join_url, address: location.location })
      : undefined,
    hosts: memberships.length
      ? memberships.map((m) => m.user_name ?? m.user_email ?? m.user)
      : undefined,
    invitees: event.invitees_counter,
    guests: guests.length ? guests.map((g) => g.email) : undefined,
    cancellation: status === "canceled" ? event.cancellation : undefined,
  });

  return renderObject(detail);
}

// ── events invitees ──────────────────────────────────────────────────

async function eventsInvitees(parsed: Parsed) {
  const creds = requireCredentials();

  const eventArg = requirePositional(parsed, 0, "event", "calendly-axi events invitees <event>");
  const { uuid: eventUuid } = resolveIdentifier("scheduled_events", eventArg);

  const statusRaw = str(parsed, "--status");
  if (statusRaw !== undefined && statusRaw !== "active" && statusRaw !== "canceled") {
    throw new AxiError(`invalid --status "${statusRaw}"`, "VALIDATION_ERROR", [
      "Use --status active or --status canceled",
    ]);
  }
  const emailFlag = str(parsed, "--email");

  // Invitees are naturally bounded (one event's own invitee list), so we
  // always drain — see `specs/behaviors/pagination-and-limits.md`.
  const result = await paginate<Record<string, unknown>>(
    `scheduled_events/${eventUuid}/invitees`,
    { status: statusRaw, email: emailFlag },
    undefined,
  );

  if (emailFlag !== undefined && result.items.length === 1) {
    const inv = result.items[0]!;
    const inviteeUuid = uuidFromUri(String(inv.uri));
    const detail = compact({
      uuid: inviteeUuid,
      uri: inv.uri,
      name: inv.name,
      email: inv.email,
      status: inv.status,
      no_show: inv.no_show ? "yes" : "no",
      timezone: inv.timezone,
      questions_and_answers: inv.questions_and_answers,
      cancel_url: inv.cancel_url,
      reschedule_url: inv.reschedule_url,
      rescheduled: inv.rescheduled,
      old_invitee: inv.old_invitee,
      new_invitee: inv.new_invitee,
    });
    return joinBlocks(
      renderObject(detail),
      renderHelp([`calendly-axi events no-show ${inviteeUuid}`, `calendly-axi events cancel ${eventUuid}`]),
    );
  }

  const schema: FieldDef[] = [
    { name: "uuid", extract: (i) => uuidFromUri(String(i.uri)) },
    { name: "name", extract: (i) => i.name },
    { name: "email", extract: (i) => i.email },
    { name: "status", extract: (i) => i.status },
    { name: "no_show", extract: (i) => (i.no_show ? "yes" : "no") },
  ];

  const filterNote = [statusRaw ? `status=${statusRaw}` : undefined, emailFlag ? `email=${emailFlag}` : undefined]
    .filter(Boolean)
    .join(", ");

  return renderListResponse({
    summary: paginationSummary(result),
    name: "invitees",
    items: result.items,
    schema,
    suggestions: ["calendly-axi events no-show <invitee-uuid>", `calendly-axi events cancel ${eventUuid}`],
    emptyMessage: `0 invitees found for event ${eventUuid}${filterNote ? ` (${filterNote})` : ""}`,
  });
}
