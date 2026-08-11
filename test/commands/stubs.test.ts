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
import { webhooksCommand } from "../../src/commands/webhooks.js";

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
  { name: "webhooks", fn: webhooksCommand, args: ["--totally-bogus-flag"] },
];

describe("command stubs: unknown flag rejection, no API call", () => {
  it.each(STUB_COMMANDS)("$name rejects an unknown flag without making a request", ({ fn, args }) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      fn(args);
      throw new Error("should have thrown on an unknown flag");
    } catch (err) {
      expect((err as { code: string }).code).toBe("UNKNOWN_FLAG");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("command stubs: NOT_IMPLEMENTED naming the owning plan", () => {
  it("home names auth-identity", () => {
    expect(() => homeCommand([])).toThrowError(expect.objectContaining({ code: "NOT_IMPLEMENTED" }));
    try {
      homeCommand([]);
    } catch (err) {
      expect((err as { suggestions: string[] }).suggestions.join(" ")).toContain("auth-identity");
    }
  });

  it("doctor names auth-identity", () => {
    try {
      doctorCommand([]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { suggestions: string[] }).suggestions.join(" ")).toContain("auth-identity");
    }
  });

  it("auth setup/whoami/logout all name auth-identity", () => {
    for (const sub of ["setup", "whoami", "logout"]) {
      try {
        authCommand([sub]);
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as { suggestions: string[] }).suggestions.join(" ")).toContain("auth-identity");
      }
    }
  });

  it("hook defaults to status and names auth-identity", () => {
    try {
      hookCommand([]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { message: string }).message).toContain("hook status");
      expect((err as { suggestions: string[] }).suggestions.join(" ")).toContain("auth-identity");
    }
  });

  it("types read subcommands name types-read; writes name types-write", () => {
    for (const sub of ["list", "view", "slots", "availability"]) {
      const err = catchErr(() => typesCommand(sub === "list" ? [] : [sub, "x"]));
      expect(err.suggestions.join(" ")).toContain("types-read");
    }
    for (const sub of ["create", "update"]) {
      const err = catchErr(() => typesCommand([sub]));
      expect(err.suggestions.join(" ")).toContain("types-write");
    }
  });

  it("events reads name events-read; cancel/no-show name events-write", () => {
    for (const sub of ["list", "view", "invitees"]) {
      const err = catchErr(() => eventsCommand(sub === "list" ? [] : [sub, "x"]));
      expect(err.suggestions.join(" ")).toContain("events-read");
    }
    for (const sub of ["cancel", "no-show"]) {
      const err = catchErr(() => eventsCommand([sub, "x"]));
      expect(err.suggestions.join(" ")).toContain("events-write");
    }
  });

  it("busy names events-read", () => {
    expect(catchErr(() => busyCommand([])).suggestions.join(" ")).toContain("events-read");
  });

  it("link names events-write", () => {
    expect(catchErr(() => linkCommand(["x"])).suggestions.join(" ")).toContain("events-write");
  });

  it("book names book", () => {
    expect(catchErr(() => bookCommand([])).suggestions.join(" ")).toContain("plans/book.md");
  });

  it("webhooks names webhooks", () => {
    expect(catchErr(() => webhooksCommand([])).suggestions.join(" ")).toContain("plans/webhooks.md");
  });
});

function catchErr(fn: () => unknown): { code: string; message: string; suggestions: string[] } {
  try {
    fn();
    throw new Error("should have thrown");
  } catch (err) {
    return err as { code: string; message: string; suggestions: string[] };
  }
}
