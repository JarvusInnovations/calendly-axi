import { AxiError } from "axi-sdk-js";
import { calendlyRequest, requireCredentials } from "../calendly/client.js";
import { resolveEventTypeIdentifier, uuidFromUri } from "../calendly/ids.js";
import { resolveSelf } from "../calendly/scope.js";
import type { Credentials } from "../config.js";
import { BOOK_FLAGS, multiStr, parseFlags, str, type Parsed } from "../flags.js";
import { joinBlocks, renderHelp, renderObject } from "../output/index.js";
import { parseExactInstant } from "../time/windows.js";

/**
 * `book` — direct booking via the Scheduling API. See
 * `specs/commands/book.md` and `specs/api/booking.md`. Outward-facing: this
 * command triggers a real email/SMS to a real invitee on success, so it
 * takes fully explicit arguments and never auto-retries — see
 * `specs/principles.md#booking-and-cancelling-are-outward-facing--be-deliberate-not-chatty`.
 */

interface CustomQuestion {
  position: number;
  name: string;
  type: string;
  required: boolean;
}

interface EventTypeDetail {
  name: string;
  custom_questions?: CustomQuestion[];
}

interface InviteeResource {
  uri: string;
  /** URI of the scheduled event this invitee was just booked onto. */
  event: string;
  cancel_url: string;
  reschedule_url: string;
}

// ── Required-flag validation (network-free) ─────────────────────────

function requireFlag(parsed: Parsed, name: string, missing: string[]): string | undefined {
  const value = str(parsed, name);
  if (!value) missing.push(name);
  return value;
}

/**
 * `--type`/`--at`/`--name`/`--email` are all required, with no default or
 * inferred invitee, ever (book.md). Checked before any credential or
 * network access so a missing-flags failure never costs an API call.
 */
function requiredFlagValues(parsed: Parsed): { type: string; at: string; name: string; email: string } {
  const missing: string[] = [];
  const type = requireFlag(parsed, "--type", missing);
  const at = requireFlag(parsed, "--at", missing);
  const name = requireFlag(parsed, "--name", missing);
  const email = requireFlag(parsed, "--email", missing);
  if (missing.length > 0) {
    throw new AxiError(`missing required flag(s): ${missing.join(", ")}`, "VALIDATION_ERROR", [
      "Run `calendly-axi book --type <event-type> --at <iso-datetime> --name <name> --email <email>`",
    ]);
  }
  return { type: type!, at: at!, name: name!, email: email! };
}

// ── --answer parsing/validation ─────────────────────────────────────

interface AnswerFlag {
  position: number;
  text: string;
}

function parseAnswerFlags(raw: string[]): AnswerFlag[] {
  return raw.map((entry) => {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      throw new AxiError(`--answer "${entry}" must be in the form <position>=<text>`, "VALIDATION_ERROR", [
        'Example: --answer 0="Acme Inc"',
      ]);
    }
    const posRaw = entry.slice(0, eq);
    const position = Number(posRaw);
    if (!Number.isInteger(position) || position < 0) {
      throw new AxiError(`--answer position "${posRaw}" is not a valid position`, "VALIDATION_ERROR", [
        'Example: --answer 0="Acme Inc"',
      ]);
    }
    return { position, text: entry.slice(eq + 1) };
  });
}

function questionCandidates(questions: CustomQuestion[]): string[] {
  return questions.map((q) => `{position: ${q.position}, name: "${q.name}", required: ${q.required}}`);
}

/**
 * Client-side pre-flight validation against the event type's
 * `custom_questions`, per book.md: a missing required answer or an
 * out-of-range position fails before the booking call, listing the
 * questions `{position, name, required}`.
 */
function validateAnswers(
  answers: AnswerFlag[],
  questions: CustomQuestion[],
): Array<{ position: number; answer: string }> {
  const byPosition = new Map(questions.map((q) => [q.position, q] as const));

  const outOfRange = answers.filter((a) => !byPosition.has(a.position));
  if (outOfRange.length > 0) {
    throw new AxiError(
      `--answer position(s) not on this event type's custom questions: ${outOfRange.map((a) => a.position).join(", ")}`,
      "VALIDATION_ERROR",
      questions.length > 0
        ? questionCandidates(questions)
        : ["This event type has no custom questions — drop --answer"],
    );
  }

  const answered = new Set(answers.map((a) => a.position));
  const missingRequired = questions.filter((q) => q.required && !answered.has(q.position));
  if (missingRequired.length > 0) {
    throw new AxiError(
      `missing required answer(s) for custom question position(s): ${missingRequired.map((q) => q.position).join(", ")}`,
      "VALIDATION_ERROR",
      questionCandidates(questions),
    );
  }

  return answers.map((a) => ({ position: a.position, answer: a.text }));
}

// ── --location / --guests parsing ───────────────────────────────────

const LOCATION_EXAMPLE = 'Example: --location \'{"kind":"physical","location":"123 Main St"}\'';

function parseLocation(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AxiError(`--location "${raw}" is not valid JSON`, "VALIDATION_ERROR", [LOCATION_EXAMPLE]);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AxiError("--location must be a JSON object", "VALIDATION_ERROR", [LOCATION_EXAMPLE]);
  }
  return value as Record<string, unknown>;
}

function parseGuests(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

// ── Output ───────────────────────────────────────────────────────────

/** "start in profile tz + ISO" (book.md), formatted the same way as `types slots`. */
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

function renderConfirmation(options: {
  invitee: InviteeResource;
  eventTypeName: string;
  startTime: string;
  timeZone: string;
  inviteeName: string;
  inviteeEmail: string;
  guests: string[];
}): string {
  const eventUuid = uuidFromUri(options.invitee.event);
  const detail: Record<string, unknown> = {
    event_uuid: eventUuid,
    name: options.eventTypeName,
    start: `${formatLocal(options.startTime, options.timeZone)} ${options.timeZone} / ${options.startTime}`,
    invitee: { name: options.inviteeName, email: options.inviteeEmail },
    cancel_url: options.invitee.cancel_url,
    reschedule_url: options.invitee.reschedule_url,
    notifications: "Calendly sent the standard confirmation notifications to the invitee",
  };
  if (options.guests.length > 0) detail.guests = options.guests;

  return joinBlocks(
    renderObject(detail),
    renderHelp([
      `Run \`calendly-axi events view ${eventUuid}\` for full detail`,
      `Run \`calendly-axi events cancel ${eventUuid}\` to cancel`,
    ]),
  );
}

// ── Booking call — CONFLICT/RATE_LIMITED rewrap, no retry ───────────

/**
 * `POST /invitees` carries its own, much tighter platform limits than the
 * general per-minute cap (specs/api/booking.md: 10/min, 50/hr, 100/day on
 * paid non-Enterprise, 500/min Enterprise) — the client's generic 429
 * translation names the general limits, so this call's 429 is intercepted
 * and rewrapped with the booking-specific numbers instead.
 */
function bookingRateLimitError(): AxiError {
  return new AxiError("Rate limited on booking — the Scheduling API enforces its own tighter limits", "RATE_LIMITED", [
    "Booking limits (paid non-Enterprise): 10/min, 50/hr, 100/day (Enterprise: 500/min)",
    "`book` never auto-retries — wait, then retry manually with the same flags",
  ]);
}

/**
 * A single POST, no retry logic anywhere on this path: there are no
 * idempotency keys, so a blind retry would double-book and double-notify
 * (booking.md, principles.md).
 */
async function submitBooking(
  creds: Credentials,
  body: Record<string, unknown>,
  typeUuid: string,
): Promise<InviteeResource> {
  try {
    const res = await calendlyRequest<{ resource: InviteeResource }>("invitees", {
      method: "POST",
      credentials: creds,
      body,
    });
    return res.resource;
  } catch (err) {
    if (err instanceof AxiError && err.code === "CONFLICT") {
      throw new AxiError(err.message, "CONFLICT", [
        `Run \`calendly-axi types slots ${typeUuid}\` to re-check availability`,
      ]);
    }
    if (err instanceof AxiError && err.code === "RATE_LIMITED") {
      throw bookingRateLimitError();
    }
    throw err;
  }
}

// ── book ─────────────────────────────────────────────────────────────

export async function bookCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("book", args, BOOK_FLAGS);
  const { type, at, name, email } = requiredFlagValues(parsed);

  const creds = requireCredentials();
  const self = await resolveSelf(creds);
  const timeZone = str(parsed, "--timezone", self.timezone);
  const startTime = parseExactInstant(at, timeZone);

  const { uuid, uri } = await resolveEventTypeIdentifier(type, { user: self.user_uri });

  // Pre-flight: fetch the type's custom_questions before the booking call
  // itself, per book.md.
  const detail = await calendlyRequest<{ resource: EventTypeDetail }>(`event_types/${uuid}`, { credentials: creds });
  const questions = detail.resource.custom_questions ?? [];
  const answers = validateAnswers(parseAnswerFlags(multiStr(parsed, "--answer")), questions);

  const location = parseLocation(str(parsed, "--location"));
  const guests = parseGuests(str(parsed, "--guests"));

  const body: Record<string, unknown> = {
    event_type: uri,
    start_time: startTime,
    invitee: { name, email, timezone: timeZone },
  };
  if (location) body.location = location;
  if (answers.length > 0) body.questions_and_answers = answers;
  if (guests.length > 0) body.event_guests = guests;

  const invitee = await submitBooking(creds, body, uuid);

  return renderConfirmation({
    invitee,
    eventTypeName: detail.resource.name,
    startTime,
    timeZone,
    inviteeName: name,
    inviteeEmail: email,
    guests,
  });
}
