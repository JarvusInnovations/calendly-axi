import { DOCTOR_FLAGS, parseFlags } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/** Ordered health checks — see `specs/commands/auth.md#doctor`. Lands with `auth-identity`. */
export function doctorCommand(args: string[]) {
  parseFlags("doctor", args, DOCTOR_FLAGS);
  return notImplemented("doctor", "auth-identity");
}
