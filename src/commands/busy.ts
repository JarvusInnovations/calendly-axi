import { BUSY_FLAGS, parseFlags } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/** `busy` — see `specs/commands/busy.md`. Lands with `events-read`. */
export function busyCommand(args: string[]) {
  parseFlags("busy", args, BUSY_FLAGS);
  return notImplemented("busy", "events-read");
}
