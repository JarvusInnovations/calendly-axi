export const DESCRIPTION =
  "Agent-ergonomic CLI for the Calendly API — see what's scheduled, share a way to book, and manage the fallout";

export interface CommandDoc {
  usage: string;
  summary: string;
  flags?: string[];
  examples?: string[];
}

export interface CommandGroup {
  group: string;
  commands: CommandDoc[];
}

/**
 * The one place the v1 command surface is described. The home view's help
 * lines, every `--help` block, and the generated `skills/calendly-axi/SKILL.md`
 * (via `docs-skill`) all derive from this, so documentation cannot drift from
 * the implementation. This is a skeleton as of `foundation` — every command
 * here is currently a stub; per-command detail sharpens as each plan lands.
 */
export const COMMAND_GROUPS: CommandGroup[] = [
  {
    group: "Booking loop",
    commands: [
      {
        usage: "events [list|view|invitees|cancel|no-show] [<args>] [flags]",
        summary: "List upcoming events, inspect invitees, cancel, and mark no-shows",
        flags: [
          "--status active|canceled     filter by event status (list/invitees)",
          "--email <invitee-email>      filter/select by invitee email",
          "--from/--to/--since/--until  time window (list; default: upcoming)",
          "--org                        organization-wide instead of self-scoped",
          "--user <who>                 scope to another user",
          "--limit <n>                  cap the result count (list; default 100)",
          "--reason <text>               cancellation reason (cancel)",
          "--undo                        clear a no-show mark (no-show)",
        ],
        examples: [
          "calendly-axi events",
          "calendly-axi events view <uuid>",
          "calendly-axi events invitees <uuid>",
          'calendly-axi events cancel <uuid> --reason "scheduling conflict"',
          "calendly-axi events no-show <invitee-uuid>",
        ],
      },
      {
        usage: "link <event-type>",
        summary: "Mint a single-use scheduling link for an event type",
        examples: ['calendly-axi link "30 Minute Meeting"', "calendly-axi link <event-type-uuid>"],
      },
      {
        usage: "book --type <event-type> --at <iso-datetime> --name <name> --email <email> [flags]",
        summary: "Book a meeting directly via the Scheduling API (paid plans only)",
        flags: [
          "--type <event-type>   required — UUID, URI, or name",
          "--at <iso-datetime>   required — exact slot start (from `types slots`)",
          "--name <name>         required — invitee name",
          "--email <email>       required — invitee email",
          "--timezone <tz>       defaults to the profile timezone",
          "--location <json>     when the event type offers a location choice",
          "--answer <pos>=<text> repeatable — custom-question answers",
          "--guests <e,e,...>    additional invitee emails",
        ],
        examples: [
          'calendly-axi book --type <uuid> --at 2026-08-18T15:00:00Z --name "Ada Lovelace" --email ada@example.com',
        ],
      },
      {
        usage: "busy [--from --to | --until <dur>] [--user <who>]",
        summary: "Show busy intervals for the next 7 days (calendly events + connected-calendar blocks)",
        examples: ["calendly-axi busy", "calendly-axi busy --until 3d"],
      },
    ],
  },
  {
    group: "Event types",
    commands: [
      {
        usage: "types [list|view|slots|create|update|availability] [<args>] [flags]",
        summary: "List, inspect, and manage event types — bookable slots and availability rules",
        flags: [
          "--org                organization-wide listing (admin required)",
          "--all / --inactive   include or restrict to inactive types (list)",
          "--from/--to/--until  slot-lookup window (slots; default 7d, cap 31d)",
          "--name/--duration/--description/--color/--locations   scalar + JSON fields (create/update)",
          "--active/--inactive  reactivate, or the documented stand-in for delete (update)",
          "--rules <json|@file> availability rules (availability)",
        ],
        examples: [
          "calendly-axi types",
          "calendly-axi types view <uuid>",
          "calendly-axi types slots <uuid> --until 14d",
          'calendly-axi types create --name "Intro Call" --duration 30',
        ],
      },
    ],
  },
  {
    group: "Webhooks",
    commands: [
      {
        usage: "webhooks [list|view|create|delete|sample] [<args>] [flags]",
        summary: "Manage webhook subscriptions (reads work on Free; creation needs a paid plan)",
        flags: [
          "--scope organization|user|group   default: organization",
          "--user <who> / --group <id>       scope target",
          "--url <https-url> --events <e,e>  required for create",
          "--signing-key <key>               passed through, never stored (create)",
          "--event <event>                   which sample payload to fetch (sample)",
        ],
        examples: [
          "calendly-axi webhooks",
          "calendly-axi webhooks view <uuid>",
          "calendly-axi webhooks create --url https://example.com/hook --events invitee.created,invitee.canceled",
          "calendly-axi webhooks delete <uuid>",
          "calendly-axi webhooks sample --event invitee.created",
        ],
      },
    ],
  },
  {
    group: "Setup",
    commands: [
      {
        usage: "auth [setup|whoami|logout] [flags]",
        summary: "Connect, inspect, or remove the stored Calendly Personal Access Token",
        flags: [
          "--token <pat>   Personal Access Token (setup)",
          "--refresh       re-fetch identity instead of using the cache (whoami)",
        ],
        examples: [
          "calendly-axi auth setup --token <pat>",
          "calendly-axi auth whoami",
          "calendly-axi auth logout",
        ],
      },
      {
        usage: "doctor",
        summary: "Ordered health checks: credentials, token, organization, rate-limit headroom, hooks",
        examples: ["calendly-axi doctor"],
      },
      {
        usage: "hook [install|status|uninstall]",
        summary: "Manage the SessionStart hook that injects the home view at session start",
        examples: ["calendly-axi hook status", "calendly-axi hook install"],
      },
    ],
  },
];

/** Flat lookup of a command's documentation by its first word. */
export function commandDoc(name: string): CommandDoc | undefined {
  for (const group of COMMAND_GROUPS) {
    for (const doc of group.commands) {
      const first = doc.usage.split(" ")[0];
      if (first === name) return doc;
    }
  }
  return undefined;
}

/** Render the `--help` block for a single top-level command. */
export function renderCommandHelp(name: string): string | null {
  const doc = commandDoc(name);
  if (!doc) return null;

  const lines = [`usage: calendly-axi ${doc.usage}`, "", doc.summary];

  if (doc.flags?.length) {
    lines.push("", "flags:");
    for (const flag of doc.flags) lines.push(`  ${flag}`);
  }

  if (doc.examples?.length) {
    lines.push("", "examples:");
    for (const example of doc.examples) lines.push(`  ${example}`);
  }

  // The SDK writes this string verbatim, so the trailing newline is ours.
  return `${lines.join("\n")}\n`;
}

/** Render the top-level help listing every command by group. */
export function renderTopLevelHelp(): string {
  const lines = [
    `calendly-axi — ${DESCRIPTION}`,
    "",
    "usage: calendly-axi <command> [args] [flags]",
  ];

  for (const group of COMMAND_GROUPS) {
    lines.push("", `${group.group}:`);
    const width = Math.max(...group.commands.map((c) => c.usage.length));
    for (const doc of group.commands) {
      lines.push(`  ${doc.usage.padEnd(width)}  ${doc.summary}`);
    }
  }

  lines.push(
    "",
    "Run `calendly-axi <command> --help` for usage on any command.",
    "Run `calendly-axi` with no arguments to see what's coming up.",
  );

  return lines.join("\n");
}
