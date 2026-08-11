---
status: done
depends: [auth-identity]
specs:
  - specs/commands/webhooks.md
  - specs/api/webhooks.md
issues: []
pr: 5
---

# Plan: Webhooks

## Scope

**In:** `webhooks list/view/create/delete/sample` — org-scope defaults, client-side event-name and per-scope validation, duplicate-create no-op, signing-key passthrough (never stored), retry_started_at surfaced as failing-deliveries warning, no-update boundary in delete's help. **Out:** any local webhook receiver/listener — out of scope for this tool entirely.

## Implements

- `specs/commands/webhooks.md` — fully.
- `specs/api/webhooks.md` — fully.

## Validation

- [x] `webhooks` (no config beyond auth) lists org-scope subscriptions; `--scope user` defaults user to self.
- [x] `create` with an unknown event → exit 2 listing valid events; `meeting_recap.*` under org scope → per-scope constraint error, zero API calls.
- [ ] Live (paid account): create against a test HTTPS endpoint → detail output; duplicate create → existing subscription reported, exit 0; delete → gone; repeat delete → no-op exit 0.
- [x] `sample --event invitee.created` returns a rendered payload; oversized payloads note total size.
- [x] Config file never contains a signing key after a `--signing-key` create (test asserts).

## Risks / unknowns

- The documented 409-on-duplicate behavior needs live confirmation; if Calendly happily double-subscribes instead, drop the no-op translation and update the api spec to match reality.

## Notes

_(closeout)_

Implemented all five subcommands (`list`/`view`/`create`/`delete`/`sample`) against
fetch-spy fixtures only — no live Calendly credentials were available on this machine,
so the entire Validation list above except the live-only round-trip line is verified by
`test/commands/webhooks.test.ts` (23 cases covering scope defaults/combos, client-side
event and per-scope validation with zero API calls, the 409-no-op path, delete
idempotency, signing-key non-persistence, and sample truncation).

Two small, additive changes to already-merged shared building blocks, both covering
gaps this plan's scope needed and neither touching other commands' behavior:

- `src/calendly/ids.ts`: added a `groups` `ResourceKind` (webhooks' `--group` needs the
  same UUID/URI duality as every other identifier) and loosened `resolveIdentifier`'s
  `label` parameter from `ResourceKind` to `string` (it was only ever used in a message,
  and the tighter type blocked a human-friendly label like `"webhook"` for
  `webhook_subscriptions`).
- `src/calendly/scope.ts`: exported the existing (previously private) `resolveUserFlag`
  helper so `webhooks`'s three-way `--scope organization|user|group` (which doesn't fit
  `resolveScope`'s self-widening `--org`/`--user` shape) could reuse the same
  email/UUID/URI resolution instead of duplicating it.

Assumed the `sample_webhook_data` response uses the same `{ resource: {...} }` single-
resource envelope as every other endpoint, per `specs/api/webhooks.md`'s "wrapping ...
per conventions" line — not flagged as a separate risk since the spec already commits to
that envelope generally.

`src/reference.ts`: touched only the `webhooks` command-group entry (flags list gained
the "no update endpoint" note and https/no-`--group`-on-sample callouts); no other
command's entry was reformatted or touched, per the concurrency note. `src/flags.ts` was
not touched at all — `WEBHOOKS_FLAGS` already matched the spec exactly.

## Follow-ups

_(closeout)_

- None. The one open item is the pre-existing Risks/unknowns line above (live 409
  confirmation), which requires a paid Calendly account and isn't blocking — it stays
  unchecked with this Notes entry as the record.
