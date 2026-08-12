<h1 align="center">calendly-axi</h1>

<p align="center">An <a href="https://axi.md">AXI</a>-compliant CLI for the <a href="https://developer.calendly.com/api-docs/">Calendly API</a> — built for agents.</p>

`calendly-axi` wraps [Calendly API v2](https://developer.calendly.com/api-docs/) in an agent-ergonomic CLI: token-efficient [TOON](https://toonformat.dev/) output, a UUID/URI/name accepted for every identifier, and errors translated into structured, actionable suggestions instead of raw API noise.

Its headline workflow is **the booking loop** — see what's scheduled, share a way to book, and manage the fallout (who booked, cancel, mark no-shows). Event type management, availability, and webhooks exist to support that loop.

```
$ calendly-axi
bin: ~/.local/share/npm/bin/calendly-axi
description: "Agent-ergonomic CLI for the Calendly API — see what's scheduled, share a way to book, and manage the fallout"
account: Ada Lovelace <ada@example.com>
upcoming[3]{uuid,start,name,invitees}:
  a1b2c3d4-1111-4a2b-9c3d-000000000001,"2026-08-12 14:00 (America/New_York)",Intro Call w/ Grace Hopper,1/1
  a1b2c3d4-1111-4a2b-9c3d-000000000002,"2026-08-13 09:30 (America/New_York)",30 Minute Meeting w/ Alan Turing,1/1
  a1b2c3d4-1111-4a2b-9c3d-000000000003,"2026-08-14 16:00 (America/New_York)",Project Sync,2/3
help[3]:
  Run `calendly-axi events` to see what's scheduled
  Run `calendly-axi link <event-type>` to get a booking link out
  Run `calendly-axi types` to see what's bookable
```

## Install

```sh
npm install -g calendly-axi
```

Or run it without installing:

```sh
npx -y calendly-axi
```

## Setup

```sh
calendly-axi auth setup --token <personal-access-token>
```

Create a Personal Access Token at <https://calendly.com/integrations/api_webhooks> (Integrations → API & Webhooks → Generate new token) with these scopes: `users:read`, `organizations:read`, `event_types:read/write`, `scheduled_events:read/write`, `availability:read/write`, `scheduling_links:write`, `webhooks:read/write`. Legacy tokens without scopes have full access already.

Credentials and a bootstrap identity cache are stored in `~/.config/calendly-axi/config.json` (dir `0700`, file `0600`). Set `CALENDLY_ACCESS_TOKEN` instead to supply the token from the environment — it takes precedence over the config file, which is useful in CI and cron. Verify either path with `calendly-axi doctor`.

## Commands

| Command | What |
| --- | --- |
| `calendly-axi` | Home view: identity + up to 5 upcoming events + suggestions |
| `calendly-axi events [list\|view\|invitees\|cancel\|no-show]` | List upcoming events, inspect invitees, cancel, and mark no-shows |
| `calendly-axi link <event-type>` | Mint a single-use scheduling link for an event type |
| `calendly-axi book --type --at --name --email` | Book a meeting directly via the Scheduling API (paid plans only) |
| `calendly-axi busy` | Show busy intervals for the next 7 days |
| `calendly-axi types [list\|view\|slots\|create\|update\|availability]` | List, inspect, and manage event types — bookable slots and availability rules |
| `calendly-axi webhooks [list\|view\|create\|delete\|sample]` | Manage webhook subscriptions (reads work on Free; creation needs a paid plan) |
| `calendly-axi auth [setup\|whoami\|logout]` | Connect, inspect, or remove the stored Personal Access Token |
| `calendly-axi doctor` | Five ordered health checks — credentials, token, organization, rate-limit headroom, hooks |
| `calendly-axi hook [install\|status\|uninstall]` | Manage the SessionStart hook that injects the home view at session start |

```sh
calendly-axi events invitees <uuid> --email "ada@example.com"
calendly-axi link "30 Minute Meeting"
calendly-axi book --type <uuid> --at 2026-08-18T15:00:00Z --name "Ada Lovelace" --email ada@example.com
calendly-axi webhooks create --url https://example.com/hook --events invitee.created,invitee.canceled
```

Run `calendly-axi <command> --help` for any command's full flag reference.

## Two ways to make it ambient (pick one)

`calendly-axi` integrates into your agent's session so state is visible before you act. You only need **one** of these:

1. **SessionStart hook (recommended)** — run `calendly-axi hook install` (or just `calendly-axi auth setup`, which installs it too) to register a hook that injects the live home view (identity, upcoming events, booking-loop suggestions) at the start of every session, for Claude Code, Codex, and OpenCode. `calendly-axi hook status` shows it; `calendly-axi hook uninstall` removes it. Idempotent and self-repairing; disable everywhere with `CALENDLY_AXI_DISABLE_HOOKS=1`.
2. **Installable skill** — a static [`SKILL.md`](skills/calendly-axi/SKILL.md) the agent loads on demand (no per-session cost, broader agent support). It carries the same command guidance the hook's home view links out to, but not live state.

The hook gives you live data on every session; the skill is lower overhead and works anywhere. They're complementary — install whichever fits, or both.

## Platform boundaries

Calendly's API has real walls. `calendly-axi` documents them at the point of need rather than papering over them:

- **No delete for event types.** `types update <type> --inactive` deactivates — the strongest removal the API offers.
- **No reschedule endpoint.** Cancel with `events cancel` and rebook with `book` or `link`; invitees also carry their own `reschedule_url` for the invitee-driven path.
- **No webhook update endpoint.** Changing a subscription's URL or events is `webhooks delete` + `webhooks create`.
- **Event type writes are solo-only.** `types create`/`types update` work for one-on-one (`kind: solo`) types; group, collective, and round-robin types are read-only via the API.
- **`book` needs a paid plan** (Standard+) and has its own tighter rate limits, separate from the general per-minute cap: Trial 5/day; paid non-Enterprise 10/min, 50/hr, 100/day; Enterprise 500/min.
- **Webhook creation needs a paid plan** (Standard+) on the subscribing organization; reads work on Free.

## Development

```sh
bun install
bun run dev          # run the CLI from source
bun run build         # compile to dist/
bun run check          # type-check
bun run test             # run the suite
bun run docs               # regenerate skills/calendly-axi/SKILL.md from src/reference.ts
bun run docs:check           # fail if the committed skill is stale
```

Built on [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js). Spec-driven — see [`specs/`](specs/) for desired state and [`plans/`](plans/) for the work-in-flight DAG.

## License

MIT
