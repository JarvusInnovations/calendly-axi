import { describe, expect, it } from "vitest";
import {
  AUTH_FLAGS,
  BOOK_FLAGS,
  BUSY_FLAGS,
  DOCTOR_FLAGS,
  EVENTS_FLAGS,
  HOME_FLAGS,
  LINK_FLAGS,
  SETUP_FLAGS,
  TYPES_FLAGS,
  WEBHOOKS_FLAGS,
  bool,
  multiStr,
  parseFlags,
  parseSubcommand,
  requirePositional,
  str,
  type FlagSpec,
} from "../src/flags.js";

describe("parseFlags", () => {
  it("parses declared value and boolean flags", () => {
    const parsed = parseFlags("events list", ["--status", "active", "--org", "abc"], {
      value: ["--status"],
      boolean: ["--org"],
      positionals: 1,
    });
    expect(parsed.flags["--status"]).toBe("active");
    expect(parsed.flags["--org"]).toBe(true);
    expect(parsed.positional).toEqual(["abc"]);
  });

  it("supports --flag=value inline syntax", () => {
    const parsed = parseFlags("events list", ["--status=canceled"], { value: ["--status"] });
    expect(parsed.flags["--status"]).toBe("canceled");
  });

  it("rejects an unknown flag with UNKNOWN_FLAG and the valid set inlined", () => {
    try {
      parseFlags("busy", ["--nope"], { value: ["--from", "--to"] });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("UNKNOWN_FLAG");
      const suggestions = (err as { suggestions: string[] }).suggestions.join(" ");
      expect(suggestions).toContain("--from");
      expect(suggestions).toContain("--to");
    }
  });

  it("always allows --help even when not declared", () => {
    const parsed = parseFlags("busy", ["--help"], {});
    expect(parsed.flags["--help"]).toBe(true);
  });

  it("rejects a value on a boolean switch", () => {
    expect(() => parseFlags("types list", ["--org=yes"], { boolean: ["--org"] })).toThrowError(
      expect.objectContaining({ code: "USAGE" }),
    );
  });

  it("rejects a missing value for a value flag", () => {
    expect(() => parseFlags("busy", ["--from"], { value: ["--from"] })).toThrowError(
      expect.objectContaining({ code: "USAGE" }),
    );
  });

  it("treats a lone -- as the positional separator", () => {
    const parsed = parseFlags("link", ["--", "--not-a-flag"], { positionals: 1 });
    expect(parsed.positional).toEqual(["--not-a-flag"]);
  });
});

describe("parseFlags: positional counts", () => {
  it("rejects an extra on a command that takes none, as USAGE naming the argument", () => {
    try {
      parseFlags("doctor", ["stray"], {});
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("USAGE");
      expect((err as Error).message).toContain("unexpected argument for `doctor`: stray");
      expect((err as { suggestions: string[] }).suggestions.join(" ")).toContain("takes no positional arguments");
    }
  });

  it("rejects a second positional where one is declared, with the usage line", () => {
    try {
      parseFlags("events cancel", ["AAA", "BBB", "CCC"], {
        positionals: 1,
        usage: "calendly-axi events cancel <event>",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("USAGE");
      expect((err as Error).message).toContain("unexpected arguments for `events cancel`: BBB CCC");
      expect((err as { suggestions: string[] }).suggestions.join(" ")).toContain(
        "takes 1 positional argument — usage: calendly-axi events cancel <event>",
      );
    }
  });

  it("accepts exactly the declared count, and any number for a variadic tail", () => {
    expect(parseFlags("link", ["intro"], { positionals: 1 }).positional).toEqual(["intro"]);
    expect(parseFlags("x", ["a", "b", "c"], { positionals: "many" }).positional).toEqual(["a", "b", "c"]);
  });

  it("never blocks --help", () => {
    expect(parseFlags("doctor", ["stray", "--help"], {}).flags["--help"]).toBe(true);
  });

  it("counts arguments after -- too", () => {
    expect(() => parseFlags("doctor", ["--", "stray"], {})).toThrowError(expect.objectContaining({ code: "USAGE" }));
  });
});

describe("declared positional counts (the spec table)", () => {
  const one: Array<[string, string, Record<string, FlagSpec>]> = [
    ["types", "view", TYPES_FLAGS],
    ["types", "slots", TYPES_FLAGS],
    ["types", "update", TYPES_FLAGS],
    ["types", "availability", TYPES_FLAGS],
    ["events", "view", EVENTS_FLAGS],
    ["events", "invitees", EVENTS_FLAGS],
    ["events", "cancel", EVENTS_FLAGS],
    ["events", "no-show", EVENTS_FLAGS],
    ["webhooks", "view", WEBHOOKS_FLAGS],
    ["webhooks", "delete", WEBHOOKS_FLAGS],
  ];

  it.each(one)("`%s %s` takes one identifier and rejects a second", (command, sub, specs) => {
    expect(parseSubcommand(command, [sub, "AAA"], specs).parsed.positional).toEqual(["AAA"]);
    expect(() => parseSubcommand(command, [sub, "AAA", "BBB"], specs)).toThrowError(
      expect.objectContaining({ code: "USAGE" }),
    );
  });

  it("`link` takes one event type and rejects a second", () => {
    expect(parseFlags("link", ["intro"], LINK_FLAGS).positional).toEqual(["intro"]);
    expect(() => parseFlags("link", ["intro", "call"], LINK_FLAGS)).toThrowError(
      expect.objectContaining({ code: "USAGE" }),
    );
  });

  const none: Array<[string, string, Record<string, FlagSpec>]> = [
    ["auth", "setup", AUTH_FLAGS],
    ["auth", "whoami", AUTH_FLAGS],
    ["auth", "logout", AUTH_FLAGS],
    ["setup hooks", "install", SETUP_FLAGS],
    ["setup hooks", "status", SETUP_FLAGS],
    ["setup hooks", "uninstall", SETUP_FLAGS],
    ["types", "list", TYPES_FLAGS],
    ["types", "create", TYPES_FLAGS],
    ["events", "list", EVENTS_FLAGS],
    ["events", "answers", EVENTS_FLAGS],
    ["webhooks", "list", WEBHOOKS_FLAGS],
    ["webhooks", "create", WEBHOOKS_FLAGS],
    ["webhooks", "sample", WEBHOOKS_FLAGS],
  ];

  it.each(none)("`%s %s` takes no identifier and rejects a stray argument", (command, sub, specs) => {
    expect(() => parseSubcommand(command, [sub, "stray"], specs)).toThrowError(
      expect.objectContaining({ code: "USAGE" }),
    );
  });

  it.each([
    ["doctor", DOCTOR_FLAGS],
    ["(home)", HOME_FLAGS],
    ["busy", BUSY_FLAGS],
    ["book", BOOK_FLAGS],
  ] as Array<[string, FlagSpec]>)("`%s` rejects a stray argument", (command, spec) => {
    expect(() => parseFlags(command, ["stray"], spec)).toThrowError(expect.objectContaining({ code: "USAGE" }));
  });
});

describe("parseFlags: multi (repeatable) flags", () => {
  it("accumulates repeated occurrences in order, instead of last-wins", () => {
    const parsed = parseFlags("book", ["--answer", "0=Acme", "--answer", "1=Referral"], {
      multi: ["--answer"],
    });
    expect(multiStr(parsed, "--answer")).toEqual(["0=Acme", "1=Referral"]);
  });

  it("multiStr returns an empty array when the flag was never given", () => {
    const parsed = parseFlags("book", [], { multi: ["--answer"] });
    expect(multiStr(parsed, "--answer")).toEqual([]);
  });

  it("supports --flag=value inline syntax for repeated occurrences", () => {
    const parsed = parseFlags("book", ["--answer=0=Acme", "--answer=1=Referral"], { multi: ["--answer"] });
    expect(multiStr(parsed, "--answer")).toEqual(["0=Acme", "1=Referral"]);
  });

  it("a single occurrence still yields a one-element array", () => {
    const parsed = parseFlags("book", ["--answer", "0=Acme"], { multi: ["--answer"] });
    expect(multiStr(parsed, "--answer")).toEqual(["0=Acme"]);
  });

  it("rejects a missing value for a multi flag", () => {
    expect(() => parseFlags("book", ["--answer"], { multi: ["--answer"] })).toThrowError(
      expect.objectContaining({ code: "USAGE" }),
    );
  });

  it("lists multi flags alongside value/boolean flags in the unknown-flag hint", () => {
    try {
      parseFlags("book", ["--nope"], { value: ["--type"], multi: ["--answer"] });
      throw new Error("should have thrown");
    } catch (err) {
      const suggestions = (err as { suggestions: string[] }).suggestions.join(" ");
      expect(suggestions).toContain("--answer");
      expect(suggestions).toContain("--type");
    }
  });

  it("does not leak multi values into flags[name] (str/bool stay unaware of multi flags)", () => {
    const parsed = parseFlags("book", ["--answer", "0=Acme"], { multi: ["--answer"] });
    expect(str(parsed, "--answer")).toBeUndefined();
    expect(bool(parsed, "--answer")).toBe(false);
  });
});

describe("str / bool / requirePositional", () => {
  it("str falls back when the flag is absent", () => {
    const parsed = parseFlags("busy", [], { value: ["--from"] });
    expect(str(parsed, "--from", "default")).toBe("default");
  });

  it("bool reports presence regardless of value/boolean kind", () => {
    const parsed = parseFlags("events no-show", ["--undo"], { boolean: ["--undo"] });
    expect(bool(parsed, "--undo")).toBe(true);
    expect(bool(parsed, "--missing")).toBe(false);
  });

  it("requirePositional throws USAGE when absent", () => {
    const parsed = parseFlags("link", [], {});
    expect(() => requirePositional(parsed, 0, "an event type", "usage: link <event-type>")).toThrowError(
      expect.objectContaining({ code: "USAGE" }),
    );
  });
});

describe("parseSubcommand", () => {
  const specs = { list: { boolean: ["--org"] }, view: { positionals: 1 } };

  it("resolves an explicit subcommand", () => {
    const { sub, parsed } = parseSubcommand("types", ["view", "abc"], specs);
    expect(sub).toBe("view");
    expect(parsed.positional).toEqual(["abc"]);
  });

  it("falls back to defaultSub when the first token looks like a flag", () => {
    const { sub, parsed } = parseSubcommand("types", ["--org"], specs, "list");
    expect(sub).toBe("list");
    expect(parsed.flags["--org"]).toBe(true);
  });

  it("falls back to defaultSub when argv is empty", () => {
    const { sub } = parseSubcommand("types", [], specs, "list");
    expect(sub).toBe("list");
  });

  it("throws VALIDATION_ERROR with no default and no subcommand given", () => {
    expect(() => parseSubcommand("auth", [], { setup: {} })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("throws VALIDATION_ERROR naming valid subcommands for an unknown one", () => {
    try {
      parseSubcommand("types", ["bogus"], specs, "list");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("VALIDATION_ERROR");
      expect((err as { suggestions: string[] }).suggestions.join(" ")).toContain("list, view");
    }
  });
});
