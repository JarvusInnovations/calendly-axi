import { describe, expect, it } from "vitest";
import { bool, parseFlags, parseSubcommand, requirePositional, str } from "../src/flags.js";

describe("parseFlags", () => {
  it("parses declared value and boolean flags", () => {
    const parsed = parseFlags("events list", ["--status", "active", "--org", "abc"], {
      value: ["--status"],
      boolean: ["--org"],
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
    const parsed = parseFlags("link", ["--", "--not-a-flag"], {});
    expect(parsed.positional).toEqual(["--not-a-flag"]);
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
  const specs = { list: { boolean: ["--org"] }, view: {} };

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
