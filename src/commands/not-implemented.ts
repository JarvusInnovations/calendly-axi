import { AxiError } from "axi-sdk-js";

/**
 * Thrown by every command surface that hasn't landed yet. `foundation`
 * registers all v1 commands so dispatch, `--help`, and flag validation work
 * end to end; each stub names the plan that will replace it with real
 * domain logic — see `plans/<plan>.md`.
 */
export function notImplemented(command: string, plan: string): never {
  throw new AxiError(`\`calendly-axi ${command}\` is not implemented yet`, "NOT_IMPLEMENTED", [
    `Lands with the \`${plan}\` plan — see plans/${plan}.md`,
  ]);
}
