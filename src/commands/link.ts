import { LINK_FLAGS, parseFlags } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/** `link <event-type>` — see `specs/commands/link.md`. Lands with `events-write`. */
export function linkCommand(args: string[]) {
  parseFlags("link", args, LINK_FLAGS);
  return notImplemented("link", "events-write");
}
