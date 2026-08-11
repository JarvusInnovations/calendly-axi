import { EVENTS_FLAGS, parseSubcommand } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/**
 * `events list|view|invitees|cancel|no-show` — see
 * `specs/commands/events.md`. Reads land with `events-read`; cancel/no-show
 * land with `events-write`.
 */
const PLAN_BY_SUBCOMMAND: Record<string, string> = {
  list: "events-read",
  view: "events-read",
  invitees: "events-read",
  cancel: "events-write",
  "no-show": "events-write",
};

export function eventsCommand(args: string[]) {
  const { sub } = parseSubcommand("events", args, EVENTS_FLAGS, "list");
  return notImplemented(`events ${sub}`, PLAN_BY_SUBCOMMAND[sub] ?? "events-read");
}
