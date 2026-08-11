---
status: planned
depends: [auth-identity]
specs:
  - specs/commands/webhooks.md
  - specs/api/webhooks.md
issues: []
---

# Plan: Webhooks

## Scope

**In:** `webhooks list/view/create/delete/sample` — org-scope defaults, client-side event-name and per-scope validation, duplicate-create no-op, signing-key passthrough (never stored), retry_started_at surfaced as failing-deliveries warning, no-update boundary in delete's help. **Out:** any local webhook receiver/listener — out of scope for this tool entirely.

## Implements

- `specs/commands/webhooks.md` — fully.
- `specs/api/webhooks.md` — fully.

## Validation

- [ ] `webhooks` (no config beyond auth) lists org-scope subscriptions; `--scope user` defaults user to self.
- [ ] `create` with an unknown event → exit 2 listing valid events; `meeting_recap.*` under org scope → per-scope constraint error, zero API calls.
- [ ] Live (paid account): create against a test HTTPS endpoint → detail output; duplicate create → existing subscription reported, exit 0; delete → gone; repeat delete → no-op exit 0.
- [ ] `sample --event invitee.created` returns a rendered payload; oversized payloads note total size.
- [ ] Config file never contains a signing key after a `--signing-key` create (test asserts).

## Risks / unknowns

- The documented 409-on-duplicate behavior needs live confirmation; if Calendly happily double-subscribes instead, drop the no-op translation and update the api spec to match reality.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
