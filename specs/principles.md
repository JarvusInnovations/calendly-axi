# Principles

The project's philosophy, written down as decisive rules. Each picks a side of a real trade-off so an implementer can resolve an unspecified case the way the author would. Distilled from the [AXI principles](https://axi.md) and the patterns proven in [harvest-axi](https://github.com/JarvusInnovations/harvest-axi) and [remarkable-axi](https://github.com/JarvusInnovations/remarkable-axi).

## The booking loop is the center of gravity

The reason calendly-axi exists is the loop an agent runs on someone's behalf: **see what's scheduled → share a way to book → manage the fallout** (who booked, cancel, mark no-shows). Event type management, availability, and webhooks exist to support that loop. When a design choice trades off booking-loop ergonomics against anything else — schema defaults, home-view content, suggestion ordering — favor the loop. The home view answers "what's coming up"; the flagship suggestions are "get a link out" and "who booked."

## Accept any identifier form; never make the agent build a URI
>
> Calendly references every resource by full URI (`https://api.calendly.com/users/ABC123`) in query params and response bodies, but takes bare UUIDs in path segments. Forcing agents to juggle both forms is exactly the ergonomic failure this tool wraps.

Every argument that names a resource accepts a **UUID, a full Calendly URI, or (for event types) a human name** — the tool normalizes internally. Output leads with the short form: list rows carry the UUID as their id column; detail views also show the full URI and any user-facing URL. An agent should be able to paste any identifier it has seen anywhere — in our output, in a webhook payload, in a browser URL — and have it work.

## Never make the agent discover scope
>
> The Calendly API infers nothing from the caller: every list endpoint demands an explicit `user` or `organization` URI, and getting them requires extra round-trips.

`auth setup` caches the authenticated user's URI and current organization once; every command defaults its scoping to that cached self. Widening is always explicit (`--org` for organization scope, `--user <who>` for another user) and never guessed. A fresh agent session must be able to run `calendly-axi events` with zero discovery calls.

## Paginate to completion; never silently cap
>
> Calendly's cursor pagination reports no total count — only `next_page_token`. A page that looks complete is indistinguishable from a truncated one unless the tool says so.

Read commands fetch every page by default within their resolved window or declared `--limit`. When results are bounded and more pages exist, say so loudly — `count: 50 shown, more available` plus a raise-the-limit or narrow-the-window hint — never a silent truncation that reads as "this is all there is." When the fetch did drain the cursor, mark it definitively (`complete: true`).

## Human time in, stamped window out

Never make the agent compute ISO timestamps. Accept human forms — `--from 2026-08-11`, `--since 7d`, `--until 30d`, named windows like `today`/`week` — convert internally to the UTC ISO-8601 the API wants, and **echo the resolved window back in the output header** so a wrong window is visible, not silent. Where the API imposes hard window caps (7 days for busy times, 31 days for slots), an over-cap request fails fast with the cap stated — we don't silently clamp.

## Idempotent, non-interactive mutations

Every write completes with flags alone — never prompt. Cancelling an already-canceled event or marking an already-marked no-show is a no-op with exit 0, not an error. Reserve non-zero exits for intents that genuinely cannot be satisfied.

## Booking and cancelling are outward-facing — be deliberate, not chatty
>
> `book` and `events cancel` trigger real emails/SMS to real invitees the moment they succeed, and the Scheduling API carries its own tight platform limits (10/min, 100/day on paid non-Enterprise plans).

Outward-facing mutations take **fully explicit arguments** — invitee name, email, and exact start time for `book`; no default or inferred invitee identity, ever. They remain non-interactive (no confirmation prompts — the agent's harness owns consent), but their output states plainly what notifications went out. Client-side awareness of the Scheduling API's special limits belongs in the tool, not in the agent's head.

## The API's boundaries are spec'd, not papered over
>
> Calendly's API cannot delete an event type, create group/collective types, reschedule an event, or update a webhook. A wrapper that hides those walls sends agents hunting for commands that can't exist.

Where the platform lacks a capability, the tool says so at the point of need: `types update --active false` is documented as the stand-in for delete; cancel-and-rebook as the stand-in for reschedule; delete-and-recreate as the stand-in for webhook update. Errors and help text name the boundary and the workaround — the tool never fakes a capability and never leaves the wall undocumented.

## Translate errors; never leak raw API noise

Calendly error bodies get translated into structured AXI errors on stdout with an actionable suggestion referencing a `calendly-axi` command — never a raw JSON dump or stack trace. Plan-gated 403s deserve special care: say **which paid tier unlocks the feature** (e.g. `book` needs Standard+; webhook creation needs a paid plan) instead of a bare "forbidden." Scope-gated 403s (`InsufficientScopeError`) name the missing token scope and point at regenerating the PAT.

## Token-based auth, unattended-friendly

Auth is a Calendly Personal Access Token stored in config (env-overridable via `CALENDLY_ACCESS_TOKEN`), set up via an agent-guided `auth setup`. No OAuth, no browser callback — cron jobs and background sweeps run unattended. Single account: one token, one config; multi-account is deliberately out of scope until a real need appears.
