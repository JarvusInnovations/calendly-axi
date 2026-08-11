import { HOOK_FLAGS, parseSubcommand } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/**
 * `hook install|status|uninstall` — mirrors harvest-axi's triad; see
 * `specs/commands/hook.md`. Lands with `auth-identity`.
 */
export function hookCommand(args: string[]) {
  const { sub } = parseSubcommand("hook", args, HOOK_FLAGS, "status");
  return notImplemented(`hook ${sub}`, "auth-identity");
}
