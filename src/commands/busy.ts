import { calendlyRequest, requireCredentials } from "../calendly/client.js";
import { uuidFromUri } from "../calendly/ids.js";
import { resolveScope, resolveSelf } from "../calendly/scope.js";
import type { ProfileCache } from "../config.js";
import { BUSY_FLAGS, parseFlags, str } from "../flags.js";
import { renderListResponse } from "../output/index.js";
import type { FieldDef } from "../output/schema.js";
import { formatInZone } from "../time/format.js";
import { resolveWindow } from "../time/windows.js";

/** `busy` — see `specs/commands/busy.md`. */

interface BusyRow {
  type: "calendly" | "external";
  start_time: string;
  end_time: string;
  event?: string;
}

function whoLabel(userFlag: string | undefined, self: ProfileCache): string {
  return userFlag ?? self.name;
}

export async function busyCommand(args: string[]) {
  const parsed = parseFlags("busy", args, BUSY_FLAGS);
  const creds = requireCredentials();
  const self = await resolveSelf(creds);

  const userFlagRaw = str(parsed, "--user");
  const scope = await resolveScope({ user: userFlagRaw }, creds, self);

  const window = resolveWindow(
    {
      from: str(parsed, "--from"),
      to: str(parsed, "--to"),
      until: str(parsed, "--until"),
      named: str(parsed, "--window"),
    },
    { timeZone: self.timezone, capDays: 7, default: { until: "7d" } },
  );

  const res = await calendlyRequest<{ collection: BusyRow[] }>("user_busy_times", {
    credentials: creds,
    query: { user: scope.user, start_time: window.from, end_time: window.to },
  });

  const rows = [...res.collection].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  );

  // The API only returns a URI reference for calendly-type rows — name
  // lookup is a best-effort enrichment per `specs/commands/busy.md`'s
  // schema (`name` = the event name for calendly rows). A failed lookup
  // just leaves that row's name blank rather than failing the whole command.
  const eventUris = [...new Set(rows.filter((r) => r.type === "calendly" && r.event).map((r) => r.event!))];
  const nameByUri = new Map<string, string>();
  for (const uri of eventUris) {
    try {
      const evRes = await calendlyRequest<{ resource: { name?: string } }>(`scheduled_events/${uuidFromUri(uri)}`, {
        credentials: creds,
      });
      if (evRes.resource?.name) nameByUri.set(uri, evRes.resource.name);
    } catch {
      // best-effort — leave the name blank for this row
    }
  }

  const schema: FieldDef[] = [
    { name: "start", extract: (r) => formatInZone(String(r.start_time), self.timezone) },
    { name: "end", extract: (r) => formatInZone(String(r.end_time), self.timezone) },
    { name: "type", extract: (r) => r.type },
    {
      name: "name",
      extract: (item) => {
        const r = item as unknown as BusyRow;
        return r.type === "calendly" && r.event ? (nameByUri.get(r.event) ?? "") : "";
      },
    },
  ];

  const who = whoLabel(userFlagRaw, self);
  const anyExternal = rows.some((r) => r.type === "external");

  const header: Record<string, unknown> = { for: who, window: window.label, complete: true };
  if (!anyExternal) {
    header.note =
      "no external-calendar rows appeared — this may mean no calendar is connected (or conflict-check is off), not that a connected calendar is empty";
  }

  return renderListResponse({
    header,
    name: "busy",
    items: rows as unknown as Array<Record<string, unknown>>,
    schema,
    suggestions: ["calendly-axi types slots <type>", "calendly-axi events"],
    emptyMessage: `no busy intervals for ${who} in ${window.label}`,
  });
}
