import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authCommand } from "../../src/commands/auth.js";
import { bookCommand } from "../../src/commands/book.js";
import { busyCommand } from "../../src/commands/busy.js";
import { doctorCommand } from "../../src/commands/doctor.js";
import { eventsCommand } from "../../src/commands/events.js";
import { homeCommand } from "../../src/commands/home.js";
import { hookCommand } from "../../src/commands/hook.js";
import { linkCommand } from "../../src/commands/link.js";
import { typesCommand } from "../../src/commands/types.js";

beforeEach(() => {
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1";
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
});

/**
 * Every top-level command stub, keyed by name, with the argv that should hit
 * *flag* validation (as opposed to subcommand resolution) with a bogus flag.
 * `auth` has no default subcommand, so an unknown flag alone resolves as
 * "missing subcommand" rather than "unknown flag" — it needs an explicit
 * subcommand first to reach the same check.
 */
const STUB_COMMANDS: Array<{ name: string; fn: (args: string[]) => unknown; args: string[] }> = [
  { name: "home", fn: homeCommand, args: ["--totally-bogus-flag"] },
  { name: "auth", fn: authCommand, args: ["setup", "--totally-bogus-flag"] },
  { name: "doctor", fn: doctorCommand, args: ["--totally-bogus-flag"] },
  { name: "hook", fn: hookCommand, args: ["--totally-bogus-flag"] },
  { name: "types", fn: typesCommand, args: ["--totally-bogus-flag"] },
  { name: "events", fn: eventsCommand, args: ["--totally-bogus-flag"] },
  { name: "busy", fn: busyCommand, args: ["--totally-bogus-flag"] },
  { name: "link", fn: linkCommand, args: ["--totally-bogus-flag"] },
  { name: "book", fn: bookCommand, args: ["--totally-bogus-flag"] },
];

describe("command stubs: unknown flag rejection, no API call", () => {
  it.each(STUB_COMMANDS)("$name rejects an unknown flag without making a request", async ({ fn, args }) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // Wrapped in a resolved promise so this works uniformly whether `fn`
    // throws synchronously (the remaining stubs) or returns a rejected
    // promise (auth/doctor/hook/home, now real `async` implementations) —
    // flag validation is always the first, synchronous thing either does.
    await expect(Promise.resolve().then(() => fn(args))).rejects.toMatchObject({ code: "UNKNOWN_FLAG" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Every command that once stubbed a NOT_IMPLEMENTED path is now fully built:
// `types` (list/view/slots/availability reads and create/update/availability
// --rules writes) as of `types-write`, `events cancel/no-show` and `link` as
// of `events-write`, and `book` as of the `book` plan — see each plan's
// namesake test file. No NOT_IMPLEMENTED stub coverage remains here.
