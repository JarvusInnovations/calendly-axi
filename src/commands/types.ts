import { readFileSync } from "node:fs";
import { AxiError } from "axi-sdk-js";
import { calendlyRequest, requireCredentials } from "../calendly/client.js";
import { resolveEventTypeIdentifier, resolveIdentifier, uuidFromUri } from "../calendly/ids.js";
import { paginate, paginationSummary } from "../calendly/paginate.js";
import { resolveScope, resolveSelf, resolveUserFlag, withOrgRoleHint } from "../calendly/scope.js";
import type { Credentials } from "../config.js";
import { bool, parseSubcommand, requirePositional, str, TYPES_FLAGS, type Parsed } from "../flags.js";
import { computed, field, joinBlocks, renderHelp, renderListResponse, renderObject } from "../output/index.js";
import { resolveWindow } from "../time/windows.js";

/**
 * `types list|view|slots|create|update|availability` — see
 * `specs/commands/types.md`. Reads (incl. name resolution) landed with
 * `types-read`; `create`/`update` and the availability *write* path
 * (`--rules`) land here with `types-write`.
 */
export function typesCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("types", args, TYPES_FLAGS, "list");

  const creds = requireCredentials();

  switch (sub) {
    case "list":
      return typesList(parsed, creds);
    case "view":
      return typesView(parsed, creds);
    case "slots":
      return typesSlots(parsed, creds);
    case "create":
      return typesCreate(parsed, creds);
    case "update":
      return typesUpdate(parsed, creds);
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

// ── JSON flag reading (`<json|@file>`) ──────────────────────────────
// Shared by `--locations` (create/update) and `--rules` (availability) per
// specs/commands/types.md's "nested structures ride JSON" principle.
// Parsed eagerly, before any network call, so malformed input fails fast
// (VALIDATION_ERROR, exit 2) rather than after a wasted round trip.

/**
 * Parse a `<json|@file>` flag value: `@path` reads and parses the file at
 * `path`; anything else is parsed as inline JSON. Both the read and the
 * parse are synchronous and network-free.
 */
function readJsonFlag(raw: string, flag: string): unknown {
  let text = raw;
  if (raw.startsWith("@")) {
    const path = raw.slice(1);
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      throw new AxiError(
        `Could not read ${flag} file "${path}": ${err instanceof Error ? err.message : String(err)}`,
        "VALIDATION_ERROR",
        [`Check the path, or pass ${flag} inline JSON instead of @<file>`],
      );
    }
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AxiError(
      `${flag} is not valid JSON${raw.startsWith("@") ? ` (from "${raw}")` : ""}: ${err instanceof Error ? err.message : String(err)}`,
      "VALIDATION_ERROR",
      [`Pass ${flag} inline JSON (quoted) or @path/to/file.json`],
    );
  }
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

  const result = await withOrgRoleHint(org, () =>
    paginate<Record<string, unknown>>("event_types", {
      ...scope,
      ...(activeFilter !== undefined ? { active: activeFilter } : {}),
      sort: "name:asc",
    }),
  );

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
  const typeArg = requirePositional(parsed, 0, "<type>", "calendly-axi types view <type> [--org] [--full]");
  const full = bool(parsed, "--full");
  const org = bool(parsed, "--org");

  const self = await resolveSelf(creds);
  const scope = await resolveScope({ org }, creds, self);
  const { uuid } = await withOrgRoleHint(org, () => resolveEventTypeIdentifier(typeArg, { ...scope }));

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
    "calendly-axi types slots <type> [--from --to | --until <dur> | --window <name>] [--org]",
  );

  const from = str(parsed, "--from");
  const to = str(parsed, "--to");
  const namedWindow = str(parsed, "--window");
  // --window's own conflict with --from/--to/--until is caught by
  // resolveWindow itself; this earlier check only guards the from/to
  // pairing when --window isn't in play.
  if (namedWindow === undefined && (from !== undefined) !== (to !== undefined)) {
    throw new AxiError("`types slots` needs --from and --to together, or --until <dur> alone", "VALIDATION_ERROR", [
      "calendly-axi types slots <type> --from <date> --to <date>",
      "calendly-axi types slots <type> --until 14d",
      "calendly-axi types slots <type> --window today",
    ]);
  }

  const org = bool(parsed, "--org");
  const self = await resolveSelf(creds);
  const scope = await resolveScope({ org }, creds, self);
  const { uuid, uri } = await withOrgRoleHint(org, () => resolveEventTypeIdentifier(typeArg, { ...scope }));

  // Fetched up front for the type's display name (empty/error messaging) —
  // one extra round trip, but slots without a name to attach them to reads
  // worse than the call costs.
  const detail = await calendlyRequest<{ resource: EventTypeResource }>(`event_types/${uuid}`, {
    credentials: creds,
  });
  const name = detail.resource.name;

  const window = resolveWindow(
    { from, to, until: str(parsed, "--until"), named: namedWindow },
    { timeZone: self.timezone, default: { until: "7d" }, capDays: 31 },
  );

  // The API requires a strictly-future start_time (confirmed live —
  // specs/api/event-types.md). The default window starts "now", which has
  // already passed by the time the request lands, so nudge a stale-but-
  // still-open window forward; a window entirely in the past can never
  // return slots, so it fails fast instead.
  const floor = new Date(Date.now() + 60_000);
  let startTime = window.from;
  if (new Date(window.from) < floor) {
    if (window.to !== undefined && new Date(window.to) <= floor) {
      throw new AxiError(
        "the slots window is entirely in the past — the API only reports future availability",
        "VALIDATION_ERROR",
        ["Use a future window, e.g. --until 7d or --from <future-date> --to <future-date>"],
      );
    }
    startTime = floor.toISOString();
  }

  const slotsRes = await calendlyRequest<{ collection: Array<Record<string, unknown>> }>(
    "event_type_available_times",
    { credentials: creds, query: { event_type: uri, start_time: startTime, end_time: window.to } },
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

// ── types create ─────────────────────────────────────────────────────

// LocationConfiguration `kind` values (specs/api/event-types.md) — used to
// validate `--location-kind` client-side so an unrecognized kind fails fast
// (VALIDATION_ERROR, exit 2) rather than round-tripping to the API's 400.
// Conferencing kinds mirror book.ts's AUTO_DEFAULT_LOCATION_KINDS (both the
// short and `_conference`-suffixed forms — the API's exact naming per kind
// isn't independently confirmed, so both ride along defensively, same as
// there); physical/custom/ask_invitee/outbound_call/inbound_call round out
// the full set from Calendly's location-kind reference.
const LOCATION_KINDS = new Set([
  "physical",
  "outbound_call",
  "inbound_call",
  "ask_invitee",
  "custom",
  "google_conference",
  "zoom",
  "zoom_conference",
  "gotomeeting",
  "gotomeeting_conference",
  "webex",
  "webex_conference",
  "microsoft_teams_conference",
]);

/**
 * `--location-kind <kind> [--location-text <text>]` — single-location sugar
 * over `--locations` (specs/commands/types.md). Mutually exclusive with
 * `--locations`; validated network-free so a bad combination or unknown kind
 * fails before any request. Returns the single location object (unwrapped —
 * callers array-wrap for the standard create body, or use it directly for
 * `one_off_event_types`' singular `location` field).
 */
function buildLocationKindSugar(parsed: Parsed, hasLocations: boolean): Record<string, unknown> | undefined {
  const kind = str(parsed, "--location-kind");
  const text = str(parsed, "--location-text");

  if (kind === undefined) {
    if (text !== undefined) {
      throw new AxiError("--location-text requires --location-kind", "VALIDATION_ERROR", [
        'Pass both, e.g. --location-kind physical --location-text "123 Main St"',
      ]);
    }
    return undefined;
  }

  if (hasLocations) {
    throw new AxiError("--location-kind is mutually exclusive with --locations", "VALIDATION_ERROR", [
      "--location-kind is single-location sugar over --locations — pass one or the other",
    ]);
  }

  if (!LOCATION_KINDS.has(kind)) {
    throw new AxiError(`--location-kind "${kind}" is not a known location kind`, "VALIDATION_ERROR", [
      `Valid kinds: ${[...LOCATION_KINDS].sort().join(", ")}`,
    ]);
  }

  return text !== undefined ? { kind, location: text } : { kind };
}

const DATE_RANGE_RE = /^(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?$/;

/**
 * Parse `--date <YYYY-MM-DD>[..<YYYY-MM-DD>]` into the `one_off_event_types`
 * `date_setting` body. The exact shape this endpoint wants is loosely
 * documented (see `plans/types-write.md` Risks) — this uses
 * `{ type: "date_range", start_date, end_date }` with `start_date ===
 * end_date` for a single date, unverified against a live account.
 */
function parseOneOffDate(raw: string): Record<string, unknown> {
  const match = DATE_RANGE_RE.exec(raw);
  if (!match) {
    throw new AxiError(`--date "${raw}" is not a valid date or date range`, "VALIDATION_ERROR", [
      "Pass a single date (--date 2026-08-18) or a range (--date 2026-08-18..2026-08-20)",
    ]);
  }
  const start_date = match[1]!;
  const end_date = match[2] ?? start_date;
  return { type: "date_range", start_date, end_date };
}

function parseCoHosts(raw: string): string[] {
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => resolveIdentifier("users", id, "co-host").uri);
}

function requiredDuration(parsed: Parsed): number {
  const raw = str(parsed, "--duration");
  if (!raw) {
    throw new AxiError("--duration is required", "VALIDATION_ERROR", [
      "Run `calendly-axi types create --name <name> --duration <minutes>`",
    ]);
  }
  const duration = Number(raw);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AxiError(`--duration "${raw}" must be a positive number of minutes`, "VALIDATION_ERROR", []);
  }
  return duration;
}

function requiredName(parsed: Parsed, usage: string): string {
  const name = str(parsed, "--name");
  if (!name) {
    throw new AxiError("--name is required", "VALIDATION_ERROR", [`Run \`calendly-axi ${usage}\``]);
  }
  return name;
}

async function typesCreate(parsed: Parsed, creds: Credentials): Promise<string> {
  const oneOff = bool(parsed, "--one-off");

  // Network-free validation first, so malformed input (JSON, date) fails
  // before any request — including the `resolveSelf` bootstrap call.
  const name = requiredName(
    parsed,
    oneOff
      ? "types create --one-off --name <name> --duration <minutes> --date <date>"
      : "types create --name <name> --duration <minutes>",
  );
  const duration = requiredDuration(parsed);
  const locationsRaw = str(parsed, "--locations");
  const locations = locationsRaw !== undefined ? readJsonFlag(locationsRaw, "--locations") : undefined;
  const singleLocation = buildLocationKindSugar(parsed, locations !== undefined);

  if (oneOff) {
    const dateRaw = str(parsed, "--date");
    if (!dateRaw) {
      throw new AxiError("--date is required with --one-off", "VALIDATION_ERROR", [
        "Run `calendly-axi types create --one-off --name <name> --duration <minutes> --date <date>`",
      ]);
    }
    const dateSetting = parseOneOffDate(dateRaw);
    const coHostsRaw = str(parsed, "--co-hosts");
    const coHosts = coHostsRaw !== undefined ? parseCoHosts(coHostsRaw) : undefined;

    const self = await resolveSelf(creds);
    const body: Record<string, unknown> = { name, host: self.user_uri, duration, date_setting: dateSetting };
    const timezone = str(parsed, "--timezone");
    if (timezone) body.timezone = timezone;
    if (coHosts?.length) body.co_hosts = coHosts;
    if (locations !== undefined) body.location = locations;
    else if (singleLocation !== undefined) body.location = singleLocation;

    const res = await calendlyRequest<{ resource: EventTypeResource }>("one_off_event_types", {
      method: "POST",
      credentials: creds,
      body,
    });
    return renderEventTypeDetail(res.resource, false);
  }

  const self = await resolveSelf(creds);
  // --owner (specs/commands/types.md): another org member's URI as the
  // POST body's `owner` — the type lands on their scheduling page. Email
  // resolves via org-membership lookup, UUID/URI resolve locally; both ride
  // resolveUserFlag (specs/behaviors/scoping.md), the same resolver --user
  // uses elsewhere. Default (no flag): self, unchanged. Server-side role
  // gate (org-admin only) surfaces as a FORBIDDEN 403 via the client's
  // standard error translation — no special handling needed here.
  const ownerRaw = str(parsed, "--owner");
  const owner = ownerRaw !== undefined ? await resolveUserFlag(ownerRaw, self, creds) : self.user_uri;
  const body: Record<string, unknown> = { name, owner, duration };
  const description = str(parsed, "--description");
  if (description) body.description = description;
  const color = str(parsed, "--color");
  if (color) body.color = color;
  if (locations !== undefined) body.locations = locations;
  else if (singleLocation !== undefined) body.locations = [singleLocation];
  if (bool(parsed, "--inactive")) body.active = false;

  const res = await calendlyRequest<{ resource: EventTypeResource }>("event_types", {
    method: "POST",
    credentials: creds,
    body,
  });
  return renderEventTypeDetail(res.resource, false);
}

// ── types update ─────────────────────────────────────────────────────

/** `old → new` for a single diff value — TOON-safe scalars pass through, everything else is JSON-compact. */
function formatDiffValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * Diff echo (specs/commands/types.md): for each field actually sent in the
 * PATCH `body`, compare the pre-flight GET (`current`) against the PATCH
 * response (`updated`) and render `old → new` — only for fields whose value
 * actually changed, so a same-value field the caller happened to resupply
 * stays silent. `description` maps to the resource's `description_plain`;
 * every other body key matches its resource field name directly.
 */
function typeFieldDiff(
  current: EventTypeResource,
  updated: EventTypeResource,
  body: Record<string, unknown>,
): Record<string, string> {
  const changed: Record<string, string> = {};
  const track = (key: string, oldValue: unknown, newValue: unknown) => {
    if (!(key in body)) return;
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
    changed[key] = `${formatDiffValue(oldValue)} → ${formatDiffValue(newValue)}`;
  };
  track("name", current.name, updated.name);
  track("duration", current.duration, updated.duration);
  track("description", current.description_plain, updated.description_plain);
  track("color", current.color, updated.color);
  track("locations", current.locations, updated.locations);
  track("active", current.active, updated.active);
  return changed;
}

async function typesUpdate(parsed: Parsed, creds: Credentials): Promise<string> {
  const typeArg = requirePositional(
    parsed,
    0,
    "<type>",
    "calendly-axi types update <type> [--org] [--name --duration --description --color --locations --active|--inactive]",
  );

  if (bool(parsed, "--active") && bool(parsed, "--inactive")) {
    throw new AxiError("--active and --inactive are mutually exclusive", "VALIDATION_ERROR", [
      "Pass one or the other, not both",
    ]);
  }

  // Network-free field prep — locations JSON and duration numeric parsing
  // fail before the GET this handler needs for the no-op check.
  const name = str(parsed, "--name");
  const durationRaw = str(parsed, "--duration");
  const duration = durationRaw !== undefined ? Number(durationRaw) : undefined;
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
    throw new AxiError(`--duration "${durationRaw}" must be a positive number of minutes`, "VALIDATION_ERROR", []);
  }
  const description = str(parsed, "--description");
  const color = str(parsed, "--color");
  const locationsRaw = str(parsed, "--locations");
  const locations = locationsRaw !== undefined ? readJsonFlag(locationsRaw, "--locations") : undefined;

  const org = bool(parsed, "--org");
  const self = await resolveSelf(creds);
  const scope = await resolveScope({ org }, creds, self);
  const { uuid } = await withOrgRoleHint(org, () => resolveEventTypeIdentifier(typeArg, { ...scope }));

  // Pre-flight GET, the no-op check, and the PATCH itself are all keyed by
  // the resolved uuid — --org only widens the name-resolution sweep above,
  // per specs/behaviors/identifier-resolution.md.
  const current = await calendlyRequest<{ resource: EventTypeResource }>(`event_types/${uuid}`, {
    credentials: creds,
  });

  // Solo-only boundary (specs/api/event-types.md): known from the GET we
  // already needed for the no-op check, so this fails fast with zero PATCH
  // attempts rather than papering over the 400 the API would otherwise
  // return — see specs/principles.md "The API's boundaries are spec'd, not
  // papered over".
  if (current.resource.kind !== "solo") {
    throw new AxiError(
      `"${current.resource.name}" is a ${current.resource.kind} event type — only solo types can be updated via the API`,
      "VALIDATION_ERROR",
      [
        "Group/collective/round-robin event types are read-only via the Calendly API",
        `Run \`calendly-axi types view ${uuid}\` to confirm the type's kind`,
      ],
    );
  }

  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (duration !== undefined) body.duration = duration;
  if (description !== undefined) body.description = description;
  if (color !== undefined) body.color = color;
  if (locations !== undefined) body.locations = locations;
  if (bool(parsed, "--active") || bool(parsed, "--inactive")) {
    body.active = bool(parsed, "--active");
  }

  const nonActiveFieldCount = Object.keys(body).filter((k) => k !== "active").length;
  const activeIsNoop = !("active" in body) || body.active === current.resource.active;
  if (nonActiveFieldCount === 0 && activeIsNoop) {
    return renderObject({
      status: `no-op — ${uuid} already reflects the requested state`,
      active: current.resource.active,
    });
  }

  try {
    const res = await calendlyRequest<{ resource: EventTypeResource }>(`event_types/${uuid}`, {
      method: "PATCH",
      credentials: creds,
      body,
    });
    const detail = renderEventTypeDetail(res.resource, false);
    const blocks = [detail];

    // Diff echo (specs/commands/types.md): every field actually sent, whose
    // value actually changed, rendered `old → new` — derived from the
    // pre-flight GET this handler already did for the no-op check plus the
    // PATCH response, so batch edits are verifiable without a follow-up
    // `view`. Composes with the rename note below (both can appear).
    const changed = typeFieldDiff(current.resource, res.resource, body);
    if (Object.keys(changed).length > 0) {
      blocks.push(renderObject({ changed }));
    }

    // Rename warning (specs/commands/types.md): the API silently ignores
    // `slug` writes (specs/api/event-types.md's silent-ignore quirk), so a
    // renamed type's scheduling_url would otherwise look unchanged with no
    // signal why. Fires whenever --name was supplied.
    if (name !== undefined) {
      blocks.push(
        renderObject({
          note: "the slug and scheduling_url do not follow the rename — the old booking URL keeps working; the new name only shows on the booking page",
        }),
      );
    }

    return joinBlocks(...blocks);
  } catch (err) {
    // Defense in depth: the `kind` check above should catch the solo-only
    // boundary before any request, but if the API still rejects with a
    // kind-flavored 400 (unverified against a live non-solo type — see
    // plans/types-write.md), rewrap it naming the boundary rather than
    // surfacing the generic "request was rejected" text.
    if (err instanceof AxiError && err.code === "VALIDATION_ERROR" && /\bsolo\b|\bkind\b/i.test(err.message)) {
      throw new AxiError(
        `Calendly rejected the update — only solo event types can be updated via the API (${err.message})`,
        "VALIDATION_ERROR",
        ["Group/collective/round-robin event types are read-only via the Calendly API"],
      );
    }
    throw err;
  }
}

// ── types availability (read + --rules write path) ─────────────────

async function typesAvailability(parsed: Parsed, creds: Credentials): Promise<string> {
  const typeArg = requirePositional(
    parsed,
    0,
    "<type>",
    "calendly-axi types availability <type> [--org] [--rules <json|@file>]",
  );

  // Network-free: malformed --rules JSON fails before any request.
  const rulesRaw = str(parsed, "--rules");
  const rules = rulesRaw !== undefined ? readJsonFlag(rulesRaw, "--rules") : undefined;

  const org = bool(parsed, "--org");
  const self = await resolveSelf(creds);
  const scope = await resolveScope({ org }, creds, self);
  const { uuid, uri } = await withOrgRoleHint(org, () => resolveEventTypeIdentifier(typeArg, { ...scope }));

  if (rules !== undefined) {
    // `PATCH /event_type_availability_schedules` — response shape is
    // untested against a live account (plans/types-write.md Risks); render
    // whatever comes back rather than projecting a guessed schema onto it.
    const res = await calendlyRequest<Record<string, unknown>>("event_type_availability_schedules", {
      method: "PATCH",
      credentials: creds,
      query: { event_type: uri },
      body: { availability_rule: rules },
    });
    const schedules = res.collection ?? res.resource ?? res;
    return renderObject({ status: "updated", event_type: uuid, schedules });
  }

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
