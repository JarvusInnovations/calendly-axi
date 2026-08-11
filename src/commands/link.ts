import { calendlyRequest, requireCredentials } from "../calendly/client.js";
import { resolveEventTypeIdentifier } from "../calendly/ids.js";
import { resolveSelf } from "../calendly/scope.js";
import { LINK_FLAGS, parseFlags, requirePositional } from "../flags.js";
import { compact, joinBlocks, renderHelp, renderObject } from "../output/index.js";

/**
 * `link <event-type>` — see `specs/commands/link.md` and
 * `specs/api/booking.md`. Mints a `max_event_count: 1` scheduling link, the
 * "send them a way to book" move — works on every plan (unlike `book`,
 * which needs Standard+).
 */
export async function linkCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("link", args, LINK_FLAGS);
  const creds = requireCredentials();
  const self = await resolveSelf(creds);

  const typeArg = requirePositional(parsed, 0, "event-type", "calendly-axi link <event-type>");
  // Resolved against self scope by default, per `plans/events-write.md` —
  // `link` takes no `--org`/`--user` widening (`LINK_FLAGS` is empty).
  const { uuid, uri } = await resolveEventTypeIdentifier(typeArg, { user: self.user_uri });

  const linkRes = await calendlyRequest<{ resource: { booking_url: string } }>("scheduling_links", {
    method: "POST",
    credentials: creds,
    body: { max_event_count: 1, owner: uri, owner_type: "EventType" },
  });

  // The scheduling_links response doesn't echo the type's name/duration, so
  // one more fetch confirms the agent grabbed the right type before pasting
  // the URL into a message — per specs/commands/link.md.
  const typeRes = await calendlyRequest<{ resource: { name?: string; duration?: number } }>(
    `event_types/${uuid}`,
    { credentials: creds },
  );

  return joinBlocks(
    renderObject(
      compact({
        booking_url: linkRes.resource.booking_url,
        event_type: compact({ uuid, name: typeRes.resource.name, duration: typeRes.resource.duration }),
        single_use: "yes — the link admits exactly one booking, then dies",
      }),
    ),
    renderHelp([
      "calendly-axi events --email <invitee-email>",
      "calendly-axi link <other-event-type>",
    ]),
  );
}
