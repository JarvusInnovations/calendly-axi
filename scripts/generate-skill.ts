#!/usr/bin/env bun
/**
 * Renders `skills/calendly-axi/SKILL.md` from `src/reference.ts`'s
 * COMMAND_GROUPS — the same single source that drives the top-level
 * `--help` listing and every per-command `--help` block, so the installable
 * skill can never drift from the CLI's own guidance. Deterministic: same
 * source, byte-identical output. See `specs/architecture.md` ("Docs & skill
 * generation") and the AXI §7 skill-publishing rules.
 *
 * Usage:
 *   bun run docs          # regenerate skills/calendly-axi/SKILL.md
 *   bun run docs:check    # fail (nonzero) if the committed file is stale
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_GROUPS, DESCRIPTION, type CommandDoc, type CommandGroup } from "../src/reference.js";
import { REQUIRED_SCOPES, TOKEN_CREATION_URL } from "../src/commands/auth.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SKILL_MD_PATH = join(REPO_ROOT, "skills", "calendly-axi", "SKILL.md");

// AXI §7: a skill may be loaded without the package installed globally, so
// every runnable example uses the no-install-required `npx -y` form.
const BIN = "calendly-axi";
const NPX_BIN = `npx -y ${BIN}`;

/** Rewrite a `calendly-axi ...` example from COMMAND_GROUPS to its npx form. */
function npxify(example: string): string {
  return example.startsWith(`${BIN} `) ? `${NPX_BIN}${example.slice(BIN.length)}` : example;
}

// Trigger-shaped frontmatter (AXI §7): terse, outcome-focused, so an agent
// loads this skill on the right intent. Hand-authored rather than derived —
// COMMAND_GROUPS carries flag/usage detail, not the higher-level intents a
// trigger needs to name.
const FRONTMATTER = `---
name: calendly-axi
description: >-
  See what's scheduled on Calendly, get a scheduling link or book a meeting
  directly, and manage the fallout — cancel events, mark no-shows, adjust
  event types and availability, inspect webhook subscriptions. Use when asked
  about Calendly meetings or bookings: what's coming up, who booked, share a
  way to book, book directly, cancel or "reschedule" (cancel + rebook) an
  event, mark someone a no-show, create/update/deactivate an event type,
  check busy times, or manage a Calendly webhook subscription. Triggers on
  "Calendly", "scheduled events", "booking link", "no-show", "event types",
  "availability", "webhooks", "who booked".
---`;

function renderPitch(): string {
  // DESCRIPTION already reads "Agent-ergonomic CLI for the Calendly API —
  // see what's scheduled, ..." — reuse its tail rather than restating it.
  const afterDash = DESCRIPTION.split("—")[1]?.trim() ?? DESCRIPTION;
  return [
    "# calendly-axi",
    "",
    `An [AXI](https://axi.md)-compliant CLI for the [Calendly API](https://developer.calendly.com/api-docs/) — ${afterDash}. Token-efficient [TOON](https://toonformat.dev/) output; every identifier takes a UUID, a full Calendly URI, or (for event types) a name.`,
    "",
    "> This skill is static. For live state at session start (what's coming up next, with no invocation needed), install the SessionStart hook instead (see the project README) — the hook and this skill are two paths to the same tool; you only need one.",
    "",
    `Every example below runs via \`${NPX_BIN}\` so it works whether or not the package is installed globally. If \`${BIN}\` is already on PATH, drop the \`npx -y\` prefix.`,
  ].join("\n");
}

/** Quick-start body inserted at the top of the "Setup" group section — not a
 * heading of its own, so the group's own `## Setup` heading (from
 * COMMAND_GROUPS) isn't duplicated. */
function renderSetupIntro(): string {
  const scopes = REQUIRED_SCOPES.map((scope) => `\`${scope}\``).join(", ");
  return [
    "```sh",
    npxify(`${BIN} auth setup --token <personal-access-token>`),
    "```",
    "",
    `Create a Personal Access Token at <${TOKEN_CREATION_URL}> (Integrations → API & Webhooks → Generate new token) with these scopes: ${scopes}. Verify with \`${npxify(`${BIN} doctor`)}\`.`,
  ].join("\n");
}

function renderCommandDoc(doc: CommandDoc): string {
  const lines: string[] = [`### \`${BIN} ${doc.usage}\``, "", doc.summary, ""];

  if (doc.flags?.length) {
    lines.push("Flags:", "");
    for (const flag of doc.flags) lines.push(`- ${flag}`);
    lines.push("");
  }

  if (doc.examples?.length) {
    lines.push("```sh");
    for (const example of doc.examples) lines.push(npxify(example));
    lines.push("```", "");
  }

  return lines.join("\n").trimEnd();
}

function renderGroup(group: CommandGroup, intro?: string): string {
  const body = intro ? [intro, ...group.commands.map(renderCommandDoc)] : group.commands.map(renderCommandDoc);
  return [`## ${group.group}`, ...body].join("\n\n");
}

function renderFooter(): string {
  return [
    "## Getting help",
    "",
    `Run \`${npxify(`${BIN} <command> --help`)}\` for any command's full flag reference. Run \`${NPX_BIN}\` (no args, needs credentials) for the live home view — or skip the invocation entirely by installing the SessionStart hook (\`${npxify(`${BIN} hook install`)}\`).`,
  ].join("\n");
}

/** Pure render — same COMMAND_GROUPS in, byte-identical Markdown out. */
export function renderSkillMarkdown(): string {
  const setupGroup = COMMAND_GROUPS.find((group) => group.group === "Setup");
  const otherGroups = COMMAND_GROUPS.filter((group) => group.group !== "Setup");

  const sections = [
    FRONTMATTER,
    "",
    renderPitch(),
    "",
    ...(setupGroup ? [renderGroup(setupGroup, renderSetupIntro()), ""] : []),
    ...otherGroups.flatMap((group) => [renderGroup(group), ""]),
    renderFooter(),
    "",
  ];

  return sections.join("\n");
}

function writeSkill(): void {
  mkdirSync(dirname(SKILL_MD_PATH), { recursive: true });
  writeFileSync(SKILL_MD_PATH, renderSkillMarkdown());
}

function checkSkill(): void {
  const generated = renderSkillMarkdown();

  let committed: string;
  try {
    committed = readFileSync(SKILL_MD_PATH, "utf-8");
  } catch {
    console.error(
      "skills/calendly-axi/SKILL.md does not exist yet.\nRun `bun run docs` to generate it, then commit the result.",
    );
    process.exit(1);
    return;
  }

  if (generated === committed) {
    console.error("skills/calendly-axi/SKILL.md is up to date.");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "calendly-axi-docs-"));
  const freshPath = join(dir, "SKILL.md");
  writeFileSync(freshPath, generated);

  console.error(
    [
      "skills/calendly-axi/SKILL.md is stale — src/reference.ts (or its docs generator) changed without regenerating it.",
      `A freshly generated copy was written to: ${freshPath}`,
      `Diff it against the committed file: diff ${SKILL_MD_PATH} ${freshPath}`,
      "Run `bun run docs` to regenerate, then commit skills/calendly-axi/SKILL.md.",
    ].join("\n"),
  );
  process.exit(1);
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    checkSkill();
  } else {
    writeSkill();
    console.error(`wrote ${SKILL_MD_PATH}`);
  }
}
