import { parseSubcommand, TYPES_FLAGS } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/**
 * `types list|view|slots|create|update|availability` — see
 * `specs/commands/types.md`. Reads (incl. name resolution) land with
 * `types-read`; writes land with `types-write`.
 */
const PLAN_BY_SUBCOMMAND: Record<string, string> = {
  list: "types-read",
  view: "types-read",
  slots: "types-read",
  availability: "types-read",
  create: "types-write",
  update: "types-write",
};

export function typesCommand(args: string[]) {
  const { sub } = parseSubcommand("types", args, TYPES_FLAGS, "list");
  return notImplemented(`types ${sub}`, PLAN_BY_SUBCOMMAND[sub] ?? "types-read");
}
