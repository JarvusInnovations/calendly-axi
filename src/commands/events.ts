import { AxiError } from "axi-sdk-js";
import { calendlyRequest, requireCredentials, type QueryValue } from "../calendly/client.js";
import { resolveIdentifier, uuidFromUri } from "../calendly/ids.js";
import { moreAvailableHint, paginate, paginationSummary } from "../calendly/paginate.js";
import { resolveScope, resolveSelf } from "../calendly/scope.js";
import type { Credentials, ProfileCache } from "../config.js";
import { EVENTS_FLAGS, bool, parseSubcommand, requirePositional, str, type Parsed } from "../flags.js";
import { compact, joinBlocks, renderHelp, renderListResponse, renderObject } from "../output/index.js";
import type { FieldDef } from "../output/schema.js";
import { formatInZone } from "../time/format.js";
import { resolveWindow } from "../time/windows.js";

/**
 * `events list|view|invitees|cancel|no-show` — see `specs/commands/events.md`.
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
      return eventsCancel(parsed);
    case "no-show":
      return eventsNoShow(parsed);
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
      renderHelp([`calendly-axi events no-show ${inv.uri}`, `calendly-axi events cancel ${eventUuid}`]),
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
    suggestions: [
      `calendly-axi events no-show <invitee-uuid> --event ${eventUuid}`,
      `calendly-axi events invitees ${eventUuid} --email <invitee-email>`,
      `calendly-axi events cancel ${eventUuid}`,
    ],
    emptyMessage: `0 invitees found for event ${eventUuid}${filterNote ? ` (${filterNote})` : ""}`,
  });
}

// ── events cancel ────────────────────────────────────────────────────

/**
 * Detects the "already in the desired state" shape of a translated
 * `AxiError` — Calendly's exact double-cancel / double-mark error body is
 * undocumented (see `plans/events-write.md` Risks), so this is a heuristic:
 * a 400/409 whose translated message mentions "already" plus one of the
 * given keywords is treated as a no-op rather than a genuine failure. Live
 * confirmation is a follow-up (see the plan's Notes at closeout).
 */
function looksLikeAlready(err: unknown, keywords: string[]): boolean {
  if (!(err instanceof AxiError)) return false;
  if (err.code !== "VALIDATION_ERROR" && err.code !== "CONFLICT") return false;
  const haystack = err.message.toLowerCase();
  if (!haystack.includes("already")) return false;
  return keywords.some((k) => haystack.includes(k));
}

async function eventsCancel(parsed: Parsed): Promise<string> {
  const creds = requireCredentials();
  const self = await resolveSelf(creds);

  const eventArg = requirePositional(parsed, 0, "event", 'calendly-axi events cancel <event> [--reason "..."]');
  const { uuid } = resolveIdentifier("scheduled_events", eventArg);

  // Fetched first for name/start (needed either way for the confirmation
  // line) — the same fetch tells us if it's already canceled, which covers
  // the common no-op case with zero risk of a malformed cancellation call.
  const res = await calendlyRequest<{ resource: Record<string, unknown> }>(`scheduled_events/${uuid}`, {
    credentials: creds,
  });
  const event = res.resource;
  const name = String(event.name ?? "");
  const start = formatInZone(String(event.start_time), self.timezone);

  if (event.status === "canceled") {
    return renderObject({ status: "event already canceled (no-op)", uuid, name, start });
  }

  const reason = str(parsed, "--reason");
  try {
    await calendlyRequest(`scheduled_events/${uuid}/cancellation`, {
      method: "POST",
      credentials: creds,
      body: reason ? { reason } : undefined,
    });
  } catch (err) {
    // Belt-and-suspenders for a race: the pre-fetch above already caught the
    // common case, but two concurrent cancels can still both pass it.
    if (looksLikeAlready(err, ["cancel"])) {
      return renderObject({ status: "event already canceled (no-op)", uuid, name, start });
    }
    throw err;
  }

  return renderObject({ canceled: `${name} at ${start} — invitees notified`, uuid });
}

// ── events no-show ───────────────────────────────────────────────────

const INVITEE_URI_RE =
  /^https:\/\/api\.calendly\.com\/scheduled_events\/([^/]+)\/invitees\/([^/]+)\/?$/i;

interface InviteeRef {
  eventUuid: string;
  inviteeUuid: string;
  uri: string;
}

/**
 * Calendly nests every invitee URI under its event (`.../scheduled_events/
 * {event}/invitees/{invitee}`) and exposes no flat `GET /invitees/{uuid}`,
 * so a bare invitee UUID alone has no event context to resolve against for
 * either the mark or the `--undo` path. Per `principles.md` the agent must
 * never be made to build a URI itself, so `events no-show` accepts either
 * form the agent already holds after `events invitees <event>`: the full
 * invitee URI, or a bare invitee UUID paired with `--event <event>` (the
 * nested URI is constructed here) — see
 * `specs/commands/events.md#events-no-show`.
 */
function resolveInviteeRef(value: string, eventFlag: string | undefined): InviteeRef {
  const match = INVITEE_URI_RE.exec(value.trim());
  if (match) {
    const [, eventUuid, inviteeUuid] = match;
    return { eventUuid: eventUuid!, inviteeUuid: inviteeUuid!, uri: value.trim() };
  }
  if (value.includes("/")) {
    throw new AxiError(`"${value}" is not an invitee URI or UUID`, "VALIDATION_ERROR", [
      "Pass the invitee's full URI, or its bare UUID plus --event <event>",
      "Run `calendly-axi events invitees <event>` to list invitee UUIDs",
    ]);
  }
  if (!eventFlag) {
    throw new AxiError("a bare invitee UUID needs its event for context — pass --event <event>", "VALIDATION_ERROR", [
      "Calendly nests invitees under their event, so the UUID alone can't be resolved",
      `Run \`calendly-axi events no-show ${value} --event <event-uuid>\` (event uuid from \`calendly-axi events\`)`,
    ]);
  }
  const eventUuid = resolveIdentifier("scheduled_events", eventFlag, "event").uuid;
  return {
    eventUuid,
    inviteeUuid: value,
    uri: `https://api.calendly.com/scheduled_events/${eventUuid}/invitees/${value}`,
  };
}

async function noShowMark(ref: InviteeRef, creds: Credentials): Promise<string> {
  try {
    await calendlyRequest("invitee_no_shows", {
      method: "POST",
      credentials: creds,
      body: { invitee: ref.uri },
    });
  } catch (err) {
    if (looksLikeAlready(err, ["no_show", "no-show", "no show", "marked"])) {
      return renderObject({ status: "invitee already marked as no-show (no-op)", invitee: ref.inviteeUuid });
    }
    throw err;
  }
  return renderObject({ status: "no-show marked", invitee: ref.inviteeUuid });
}

/**
 * `--undo`: there is no way to look up a no-show record from an invitee URI
 * alone, so this fetches the invitee record (which the URI's embedded event
 * uuid makes possible) and follows its `no_show.uri` to the record to
 * delete — the path `plans/events-write.md` settled on after ruling out
 * every alternative that doesn't need the event uuid.
 */
async function noShowUndo(ref: InviteeRef, creds: Credentials): Promise<string> {
  const res = await calendlyRequest<{ resource: Record<string, unknown> }>(
    `scheduled_events/${ref.eventUuid}/invitees/${ref.inviteeUuid}`,
    { credentials: creds },
  );
  const noShow = res.resource.no_show as { uri?: string } | null | undefined;
  if (!noShow?.uri) {
    return renderObject({ status: "invitee not marked as no-show (no-op)", invitee: ref.inviteeUuid });
  }

  const noShowUuid = uuidFromUri(noShow.uri);
  try {
    await calendlyRequest(`invitee_no_shows/${noShowUuid}`, { method: "DELETE", credentials: creds });
  } catch (err) {
    if (err instanceof AxiError && err.code === "NOT_FOUND") {
      return renderObject({ status: "invitee not marked as no-show (no-op)", invitee: ref.inviteeUuid });
    }
    throw err;
  }
  return renderObject({ status: "no-show cleared", invitee: ref.inviteeUuid });
}

async function eventsNoShow(parsed: Parsed): Promise<string> {
  const creds = requireCredentials();
  const inviteeArg = requirePositional(
    parsed,
    0,
    "invitee",
    "calendly-axi events no-show <invitee-uri | invitee-uuid --event <event>> [--undo]",
  );
  const ref = resolveInviteeRef(inviteeArg, str(parsed, "--event"));

  return bool(parsed, "--undo") ? noShowUndo(ref, creds) : noShowMark(ref, creds);
}
