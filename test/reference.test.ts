import { describe, expect, it } from "vitest";
import { COMMAND_GROUPS, renderCommandHelp, renderTopLevelHelp } from "../src/reference.js";

const V1_COMMANDS = ["events", "link", "book", "busy", "types", "webhooks", "auth", "doctor", "setup"];

describe("COMMAND_GROUPS", () => {
  it("covers every v1 command surface named in specs/commands/", () => {
    const documented = COMMAND_GROUPS.flatMap((g) => g.commands.map((c) => c.usage.split(" ")[0]));
    for (const name of V1_COMMANDS) {
      expect(documented).toContain(name);
    }
  });

  it("every command has a non-empty summary and at least one example", () => {
    for (const group of COMMAND_GROUPS) {
      for (const doc of group.commands) {
        expect(doc.summary.length).toBeGreaterThan(0);
        expect(doc.examples?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe("renderCommandHelp", () => {
  it("renders a usage block for a known command", () => {
    const help = renderCommandHelp("events");
    expect(help).toContain("usage: calendly-axi events");
    expect(help).toContain("examples:");
  });

  it("returns null for an unknown command", () => {
    expect(renderCommandHelp("nope")).toBeNull();
  });
});

describe("renderTopLevelHelp", () => {
  it("lists every command group and every v1 command", () => {
    const help = renderTopLevelHelp();
    expect(help).toContain("calendly-axi");
    for (const name of V1_COMMANDS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("--help");
  });
});
