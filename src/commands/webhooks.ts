import { parseSubcommand, WEBHOOKS_FLAGS } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/** `webhooks list|view|create|delete|sample` — see `specs/commands/webhooks.md`. Lands with `webhooks`. */
export function webhooksCommand(args: string[]) {
  const { sub } = parseSubcommand("webhooks", args, WEBHOOKS_FLAGS, "list");
  return notImplemented(`webhooks ${sub}`, "webhooks");
}
