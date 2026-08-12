import { calendlyRequest } from "../calendly/client.js";
import { uuidFromUri } from "../calendly/ids.js";
import { resolveSelf } from "../calendly/scope.js";
import { resolveCredentials } from "../config.js";
import { HOME_FLAGS, parseFlags } from "../flags.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";

/**
 * No-args ambient view — also the SessionStart hook payload, so every line
 * here is paid on every session start. See `specs/commands/home.md`. Must
 * never throw and never exit nonzero: a broken home view must not break
 * session start.
 */

const TOKEN_CREATION_URL = "https://calendly.com/integrations/api_webhooks";

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatInZone(iso: string, timeZone: string): string {
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
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${timeZone})`;
  } catch {
    return iso;
  }
}

function inviteeSummary(event: Record<string, unknown>): string {
  const counter = event.invitees_counter as { active?: number; limit?: number } | undefined;
  if (!counter) return "?";
  return `${counter.active ?? 0}/${counter.limit ?? "?"}`;
}

function renderUpcoming(events: Array<Record<string, unknown>>, timeZone: string): string {
  if (events.length === 0) {
    return renderObject({ upcoming: "no active events scheduled" });
  }
  return renderList("upcoming", events, [
    { name: "uuid", extract: (e) => uuidFromUri(String(e.uri)) },
    { name: "start", extract: (e) => formatInZone(String(e.start_time), timeZone) },
    { name: "name", extract: (e) => e.name },
    { name: "invitees", extract: inviteeSummary },
  ]);
}

function suggestions(degraded: boolean): string[] {
  const help = [
    "Run `calendly-axi events` to see what's scheduled",
    "Run `calendly-axi link <event-type>` to get a booking link out",
    "Run `calendly-axi types` to see what's bookable",
  ];
  if (degraded) help.push("Run `calendly-axi doctor` to diagnose the problem");
  return help;
}

export async function homeCommand(args: string[]): Promise<string> {
  parseFlags("(home)", args, HOME_FLAGS);

  const creds = resolveCredentials();
  if (!creds) {
    return joinBlocks(
      renderObject({ status: "not configured" }),
      renderHelp([
        "Run `calendly-axi auth setup --token <pat>` to connect your Calendly account",
        `Create a Personal Access Token at ${TOKEN_CREATION_URL}`,
      ]),
    );
  }

  const fields: Record<string, unknown> = {};
  let selfUri: string | undefined;
  let timeZone = "UTC";

  try {
    // Zero API calls when `auth setup` has already cached identity; a
    // one-shot bootstrap (never persisted) otherwise — see
    // `specs/behaviors/scoping.md`.
    const self = await resolveSelf(creds);
    fields.account = `${self.name} <${self.email}>`;
    selfUri = self.user_uri;
    timeZone = self.timezone;
  } catch (err) {
    // Identity unreachable (no cache + the bootstrap call failed): degrade,
    // never throw — a broken home view must not break session start.
    fields.status = errMessage(err);
  }

  let upcomingBlock = "";
  if (selfUri) {
    try {
      const res = await calendlyRequest<{ collection: Array<Record<string, unknown>> }>("scheduled_events", {
        credentials: creds,
        query: {
          user: selfUri,
          status: "active",
          min_start_time: new Date().toISOString(),
          sort: "start_time:asc",
          count: 5,
        },
      });
      upcomingBlock = renderUpcoming(res.collection, timeZone);
    } catch (err) {
      fields.status = errMessage(err);
    }
  }

  const degraded = typeof fields.status === "string";
  return joinBlocks(renderObject(fields), upcomingBlock, renderHelp(suggestions(degraded)));
}
