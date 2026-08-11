---
status: done
depends: [events-read, types-read]
specs:
  - specs/commands/events.md
  - specs/commands/link.md
  - specs/api/scheduled-events.md
  - specs/api/booking.md
issues: []
pr: 10
---

# Plan: Events writes + link

## Scope

**In:** `events cancel` (reason, notification statement, already-canceled no-op), `events no-show` (mark + `--undo` via the invitee's `no_show.uri`, both idempotent), and `link <event-type>` (single-use scheduling link, name resolution via types-read's resolver). **Out:** `book` (own plan), shares.

## Implements

- `specs/commands/events.md` — cancel + no-show sections.
- `specs/commands/link.md` — fully.
- `specs/api/scheduled-events.md` — cancellation + no-show endpoints.
- `specs/api/booking.md` — the `scheduling_links` half.

## Validation

- [ ] Live round-trip: book a slot (web UI or `book` if landed), `events cancel <e> --reason test` → confirmation naming invitees notified; repeat → `already canceled (no-op)`, exit 0. *(No live credentials on this machine — see Notes; fixture/spy-based coverage in `test/commands/events.test.ts` instead.)*
- [ ] No-show mark → invitee row shows `no_show: yes`; `--undo` clears it; both repeated → no-ops, exit 0. *(Same live-credentials constraint — see Notes.)*
- [ ] `link "30 min"` resolves by name, prints booking_url + resolved type identity + single-use note; booking through the URL then reusing it confirms single-use. *(Name resolution + output shape covered by `test/commands/link.test.ts`; the actual single-use enforcement is a live-Calendly-side guarantee, unverifiable without credentials.)*
- [x] Cancel help text names the no-reschedule boundary and the rebook path — verified via `calendly-axi events --help` against the built bundle: `"no reschedule endpoint — cancel and rebook with \`book\` or \`link\`; invitees hold their own reschedule_url (cancel)"`.

## Risks / unknowns

- The exact error Calendly returns for double-cancel (needed for the no-op translation) is undocumented — capture live, encode as fixture. **Still open at closeout** — see Follow-ups. Implemented as a documented heuristic (`looksLikeAlready` in `src/commands/events.ts`: translated message contains "already" plus a keyword, restricted to `VALIDATION_ERROR`/`CONFLICT`) applied identically to double-cancel and double-mark-no-show.

## Notes

- **No-show design decision (both mark and `--undo`)**: `events no-show <invitee>` requires the invitee's **full URI** (`.../scheduled_events/{event}/invitees/{invitee}`), not a bare UUID — for *both* operations, not just `--undo`. Calendly nests every invitee URI under its event and exposes no flat `GET /invitees/{uuid}`, so a bare UUID has no event context to resolve against either path. Building a synthetic flat `/invitees/{uuid}` URI to POST for `mark` would just relay a confusing Calendly-side error instead of a clear client-side one, so the restriction was made uniform rather than mark-only. A bare UUID fails fast with `VALIDATION_ERROR` before any network call, pointing at `events invitees <event> --email <e>` for the URI. This is a deliberate, documented deviation from the project's usual "UUID/URI/name, resolved internally" identifier rule — driven by the resource shape, not preference. Landed as a spec clarification (`specs/commands/events.md`) ahead of the implementation commit, per spec-first practice.
- `events invitees`'s suggestions (both the multi-row list and the single-match detail view) were updated to carry the full invitee URI instead of a bare uuid placeholder, so an agent chaining from `invitees` into `no-show` always has a usable next command.
- `events cancel` pre-fetches the event unconditionally (for name/start, needed either way for the confirmation line) — that same fetch is also the primary already-canceled detector; the `looksLikeAlready` catch is belt-and-suspenders for a race between two concurrent cancels, not the main path.
- Mid-session, `origin/develop` advanced twice (the `book` and `types-write` plans merged as PR #8 and #9) while this plan was in flight. Rebased onto `origin/develop` both times per the "rebase, never backmerge" convention; both rebases produced a conflict in `test/commands/stubs.test.ts` (three plans' worth of NOT_IMPLEMENTED-stub removals landing in the same region) — resolved by keeping the union of all three removals plus one pointer comment, no logic lost.

## Follow-ups

- Tracked as: live round-trip validation (cancel confirmation + no-op repeat, no-show mark/`--undo` + no-op repeat, `link`'s single-use enforcement) pending a human running these against a real Calendly account — see the three unchecked Validation boxes above.
- Tracked as: confirm the live shape of Calendly's double-cancel and double-mark-no-show error bodies against a real account, then tighten (or relax) `looksLikeAlready`'s keyword heuristic in `src/commands/events.ts` to match exactly.
