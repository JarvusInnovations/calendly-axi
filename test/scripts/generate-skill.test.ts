import { describe, expect, it } from "vitest";
import { renderSkillMarkdown } from "../../scripts/generate-skill.js";
import { COMMAND_GROUPS } from "../../src/reference.js";
import { REQUIRED_SCOPES, TOKEN_CREATION_URL } from "../../src/commands/auth.js";

const content = renderSkillMarkdown();

describe("renderSkillMarkdown", () => {
  it("is deterministic — same COMMAND_GROUPS in, byte-identical Markdown out", () => {
    expect(renderSkillMarkdown()).toBe(content);
  });

  it("carries trigger-shaped frontmatter (AXI §7)", () => {
    expect(content.startsWith("---\n")).toBe(true);
    const end = content.indexOf("\n---", 4);
    expect(end).toBeGreaterThan(-1);
    const frontmatter = content.slice(0, end);

    expect(frontmatter).toContain("name: calendly-axi");
    expect(frontmatter).toMatch(/description:/);
    // Trigger-shaped: outcome-focused "Use when ..." framing plus explicit
    // trigger phrases an agent matches intent against — not a plain feature
    // summary.
    expect(frontmatter).toMatch(/Use when/);
    expect(frontmatter).toMatch(/Triggers on/);
  });

  it("renders every command group and command named in COMMAND_GROUPS", () => {
    for (const group of COMMAND_GROUPS) {
      expect(content).toContain(`## ${group.group}`);
      for (const doc of group.commands) {
        const name = doc.usage.split(" ")[0];
        expect(content).toContain(`calendly-axi ${name}`);
        expect(content).toContain(doc.summary);
      }
    }
  });

  it("gives every runnable example the no-install-required npx form (AXI §7)", () => {
    const codeBlocks = [...content.matchAll(/```sh\n([\s\S]*?)```/g)].map((m) => m[1]!);
    // One block per Setup-intro command plus one per documented command.
    expect(codeBlocks.length).toBeGreaterThan(COMMAND_GROUPS.flatMap((g) => g.commands).length);

    for (const block of codeBlocks) {
      for (const line of block.split("\n")) {
        if (line.trim().length === 0) continue;
        if (line.includes("calendly-axi")) {
          expect(line.trim().startsWith("npx -y calendly-axi")).toBe(true);
        }
      }
    }
  });

  it("carries no live state — no rendered home-view data, no unfilled placeholders", () => {
    for (const marker of ["upcoming[", "account:", "bin: ", "TODO", "TBD", "FIXME"]) {
      expect(content).not.toContain(marker);
    }
  });

  it("documents the PAT creation URL and every required scope, sourced from auth.ts", () => {
    expect(content).toContain(TOKEN_CREATION_URL);
    for (const scope of REQUIRED_SCOPES) {
      expect(content).toContain(scope);
    }
  });

  it("points at the SessionStart hook as the live-state alternative, and notes only one is needed", () => {
    expect(content).toMatch(/SessionStart hook/);
    expect(content).toMatch(/only need one/);
  });
});
