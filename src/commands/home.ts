import { HOME_FLAGS, parseFlags } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/**
 * No-args ambient view — also the SessionStart hook payload. Real behavior
 * (identity + up to 5 upcoming events, all degradation paths) lands with
 * `auth-identity`; see `specs/commands/home.md`.
 */
export function homeCommand(args: string[]) {
  parseFlags("(home)", args, HOME_FLAGS);
  return notImplemented("(home)", "auth-identity");
}
