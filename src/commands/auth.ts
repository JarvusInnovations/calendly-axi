import { AUTH_FLAGS, parseSubcommand } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/** `auth setup|whoami|logout` — see `specs/commands/auth.md`. Lands with `auth-identity`. */
export function authCommand(args: string[]) {
  const { sub } = parseSubcommand("auth", args, AUTH_FLAGS);
  return notImplemented(`auth ${sub}`, "auth-identity");
}
