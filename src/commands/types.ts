import { AxiError } from "axi-sdk-js";
import { calendlyRequest, requireCredentials } from "../calendly/client.js";
import { resolveEventTypeIdentifier, uuidFromUri } from "../calendly/ids.js";
import { paginate, paginationSummary } from "../calendly/paginate.js";
import { resolveScope, resolveSelf } from "../calendly/scope.js";
import type { Credentials } from "../config.js";
import { bool, parseSubcommand, requirePositional, str, TYPES_FLAGS, type Parsed } from "../flags.js";
import { computed, field, joinBlocks, renderHelp, renderListResponse, renderObject } from "../output/index.js";
import { resolveWindow } from "../time/windows.js";
import { notImplemented } from "./not-implemented.js";

/**
 * `types list|view|slots|create|update|availability` — see
 * `specs/commands/types.md`. Reads (incl. name resolution) land with
 * `types-read`; create/update and the availability *write* path (`--rules`)
 * land with `types-write`.
 *
 * Not declared `async` itself: `create`/`update` and an unconfigured token
 * must fail synchronously (matching every other command stub), while the
 * implemented read paths return the promise their handler produces.
 */
export function typesCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("types", args, TYPES_FLAGS, "list");

  if (sub === "create" || sub === "update") {
    return notImplemented(`types ${sub}`, "types-write");
  }

  const creds = requireCredentials();

  switch (sub) {
    case "list":
      return typesList(parsed, creds);
    case "view":
      return typesView(parsed, creds);
    case "slots":
      return typesSlots(parsed, creds);
    case "availability":
      return typesAvailability(parsed, creds);
    default:
      // Unreachable — parseSubcommand already validated `sub` against TYPES_FLAGS.
      throw new AxiError(`unknown types subcommand "${sub}"`, "VALIDATION_ERROR", []);
  }
}

// Resource shape consumed from `event_types` reads — see
// `specs/api/event-types.md` "Key resource fields consumed".
interface EventTypeResource {
  uri: string;
  name: string;
  active: boolean;
  duration: number;
  duration_options?: number[];
  kind: string;
  scheduling_url: string;
  description_plain?: string;
  color?: string;
  locations?: Array<Record<string, unknown>>;
  custom_questions?: Array<{ position: number; name: string; type: string; required: boolean }>;
  profile?: { owner?: string };
}

// ── types list ───────────────────────────────────────────────────────

async function typesList(parsed: Parsed, creds: Credentials): Promise<string> {
  const org = bool(parsed, "--org");
  const all = bool(parsed, "--all");
  const inactive = bool(parsed, "--inactive");

  const [scope, self] = await Promise.all([resolveScope({ org }, creds), resolveSelf(creds)]);

  // active filter: --all sends none (both shown); --inactive sends false;
  // default sends true. --all wins over --inactive if both are given.
  const activeFilter = all ? undefined : inactive ? false : true;

  const result = await paginate<Record<string, unknown>>("event_types", {
    ...scope,
    ...(activeFilter !== undefined ? { active: activeFilter } : {}),
    sort: "name:asc",
  });

  const scopeLabel = org ? "org-wide" : `for ${self.name}`;
  const activeLabel = all ? "" : inactive ? "inactive " : "active ";

  return renderListResponse({
    summary: { scope: scopeLabel, ...paginationSummary(result) },
    name: "types",
    items: result.items,
    schema: [
      computed("uuid", (item) => uuidFromUri(String(item.uri))),
      field("name"),
      ...(all ? [field("active")] : []),
      field("duration"),
      field("kind"),
      field("scheduling_url"),
    ],
    suggestions: [
      "Run `calendly-axi types view <uuid>` for full detail",
      "Run `calendly-axi types slots <uuid>` for bookable slots",
      "Run `calendly-axi link <uuid>` to mint a booking link",
    ],
    emptyMessage: `0 ${activeLabel}event types ${scopeLabel}`,
  });
}

// ── types view ───────────────────────────────────────────────────────

const DESCRIPTION_TRUNCATE = 500;

function locationDisplay(loc: Record<string, unknown>): string {
  if (typeof loc.location === "string") return loc.location;
  if (typeof loc.additional_info === "string") return loc.additional_info;
  return "—";
}

function renderEventTypeDetail(resource: EventTypeResource, full: boolean): string {
  const uuid = uuidFromUri(resource.uri);
  const descRaw = resource.description_plain ?? "";
  const truncate = !full && descRaw.length > DESCRIPTION_TRUNCATE;
  const description = truncate ? `${descRaw.slice(0, DESCRIPTION_TRUNCATE)}…` : descRaw;

  const detail: Record<string, unknown> = {
    uuid,
    uri: resource.uri,
    name: resource.name,
    active: resource.active,
    kind: resource.kind,
    duration: resource.duration,
  };
  if (resource.duration_options?.length) detail.duration_options = resource.duration_options;
  detail.scheduling_url = resource.scheduling_url;
  if (resource.color) detail.color = resource.color;
  if (resource.locations?.length) {
    detail.locations = resource.locations.map((loc) => ({ kind: loc.kind, display: locationDisplay(loc) }));
  }
  detail.description = description;
  if (truncate) detail.description_total_chars = descRaw.length;
  if (resource.custom_questions?.length) {
    detail.custom_questions = resource.custom_questions.map((q) => ({
      position: q.position,
      name: q.name,
      type: q.type,
      required: q.required,
    }));
  }
  detail.owner = resource.profile?.owner ?? "";

  const body = renderObject(detail);
  if (!truncate) return body;

  // The one exception to "self-contained — no suggestions" (types.md): a
  // truncated description always carries the --full escape hatch, per the
  // AXI truncation convention.
  return joinBlocks(
    body,
    renderHelp([
      `Run \`calendly-axi types view ${uuid} --full\` to see the complete description (${descRaw.length} chars)`,
    ]),
  );
}

async function typesView(parsed: Parsed, creds: Credentials): Promise<string> {
  const typeArg = requirePositional(parsed, 0, "<type>", "calendly-axi types view <type> [--full]");
  const full = bool(parsed, "--full");

  const self = await resolveSelf(creds);
  const { uuid } = await resolveEventTypeIdentifier(typeArg, { user: self.user_uri });

  const res = await calendlyRequest<{ resource: EventTypeResource }>(`event_types/${uuid}`, {
    credentials: creds,
  });

  return renderEventTypeDetail(res.resource, full);
}

// ── types slots ──────────────────────────────────────────────────────

function formatLocal(iso: string, timeZone: string): string {
  try {
    const date = new Date(iso);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  } catch {
    return iso;
  }
}

/** "times in profile timezone alongside ISO" (types.md) in one column. */
function startColumn(iso: string, timeZone: string): string {
  return `${formatLocal(iso, timeZone)} ${timeZone} / ${iso}`;
}

async function typesSlots(parsed: Parsed, creds: Credentials): Promise<string> {
  const typeArg = requirePositional(
    parsed,
    0,
    "<type>",
    "calendly-axi types slots <type> [--from --to | --until <dur>]",
  );

  const from = str(parsed, "--from");
  const to = str(parsed, "--to");
  if ((from !== undefined) !== (to !== undefined)) {
    throw new AxiError("`types slots` needs --from and --to together, or --until <dur> alone", "VALIDATION_ERROR", [
      "calendly-axi types slots <type> --from <date> --to <date>",
      "calendly-axi types slots <type> --until 14d",
    ]);
  }

  const self = await resolveSelf(creds);
  const { uuid, uri } = await resolveEventTypeIdentifier(typeArg, { user: self.user_uri });

  // Fetched up front for the type's display name (empty/error messaging) —
  // one extra round trip, but slots without a name to attach them to reads
  // worse than the call costs.
  const detail = await calendlyRequest<{ resource: EventTypeResource }>(`event_types/${uuid}`, {
    credentials: creds,
  });
  const name = detail.resource.name;

  const window = resolveWindow(
    { from, to, until: str(parsed, "--until") },
    { timeZone: self.timezone, default: { until: "7d" }, capDays: 31 },
  );

  const slotsRes = await calendlyRequest<{ collection: Array<Record<string, unknown>> }>(
    "event_type_available_times",
    { credentials: creds, query: { event_type: uri, start_time: window.from, end_time: window.to } },
  );
  // The endpoint is documented as returning available slots; filter
  // defensively in case a non-"available" status ever shows up.
  const available = slotsRes.collection.filter((s) => s.status === undefined || s.status === "available");

  return renderListResponse({
    header: { window: window.label, complete: true },
    name: "slots",
    items: available,
    schema: [
      computed("start", (item) => startColumn(String(item.start_time), self.timezone)),
      field("invitees_remaining"),
    ],
    suggestions:
      available.length > 0
        ? [
            `Run \`calendly-axi book --type ${uuid} --at <start> --name "<name>" --email <email>\` to book a slot`,
            `Run \`calendly-axi link ${uuid}\` to mint a booking link`,
          ]
        : [
            "Widen the window with --until <dur> or --from/--to",
            `Run \`calendly-axi types availability ${uuid}\` to see the type's availability rules`,
          ],
    emptyMessage: `no availability for "${name}" in ${window.label}`,
  });
}

// ── types availability (read path; --rules write path is types-write) ──

async function typesAvailability(parsed: Parsed, creds: Credentials): Promise<string> {
  const typeArg = requirePositional(
    parsed,
    0,
    "<type>",
    "calendly-axi types availability <type> [--rules <json|@file>]",
  );

  if (str(parsed, "--rules") !== undefined) {
    return notImplemented("types availability --rules", "types-write");
  }

  const self = await resolveSelf(creds);
  const { uuid, uri } = await resolveEventTypeIdentifier(typeArg, { user: self.user_uri });

  // `event_type_availability_schedules`' exact shape beyond "rules +
  // timezone" is untested against a live account (plans/types-read.md
  // Risks) — render whatever the API returns rather than projecting a
  // guessed schema onto it.
  const res = await calendlyRequest<{ collection: Array<Record<string, unknown>> }>(
    "event_type_availability_schedules",
    { credentials: creds, query: { event_type: uri } },
  );

  if (res.collection.length === 0) {
    return renderObject({ availability: `no availability schedules found for ${uuid}` });
  }

  return renderObject({ event_type: uuid, schedules: res.collection });
}
