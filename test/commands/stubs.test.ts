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

describe("command stubs: NOT_IMPLEMENTED naming the owning plan", () => {
  // `types list|view|slots|availability` (read path) are implemented as of
  // `types-read` — see test/commands/types.test.ts. `create`/`update` and
  // availability's `--rules` write path remain stubs, landing with
  // `types-write`.
  it("types create/update name types-write", () => {
    for (const sub of ["create", "update"]) {
      const err = catchErr(() => typesCommand([sub]));
      expect(err.suggestions.join(" ")).toContain("types-write");
    }
  });

  it("events cancel/no-show name events-write (list/view/invitees are implemented — see events.test.ts)", async () => {
    for (const sub of ["cancel", "no-show"]) {
      // eventsCommand is async (real reads land before these stubs in the
      // switch), so the NOT_IMPLEMENTED rejection surfaces as a rejected
      // promise rather than a synchronous throw.
      const err = await eventsCommand([sub, "x"]).catch((e) => e as { suggestions: string[] });
      expect(err.suggestions.join(" ")).toContain("events-write");
    }
  });

  it("link names events-write", () => {
    expect(catchErr(() => linkCommand(["x"])).suggestions.join(" ")).toContain("events-write");
  });

  // `book` is implemented as of the `book` plan — see test/commands/book.test.ts.
});

function catchErr(fn: () => unknown): { code: string; message: string; suggestions: string[] } {
  try {
    fn();
    throw new Error("should have thrown");
  } catch (err) {
    return err as { code: string; message: string; suggestions: string[] };
  }
}
