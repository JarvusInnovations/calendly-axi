# calendly-axi specs

These specs declare the **desired state** of calendly-axi. Implementation follows spec — the spec leads, the code conforms. Work-in-flight is tracked in [`../plans/`](../plans/); each plan names the specs it implements.

## Layout

```
specs/
├── README.md              # this file
├── principles.md          # project-wide decisive rules (the philosophy)
├── architecture.md        # stack, structure, build, config, docs generation
├── api/                   # the Calendly API v2 contract we consume
│   ├── conventions.md      # base URL, bearer auth, pagination, rate limits, errors, URI convention
│   ├── event-types.md      # event type CRUD (solo-only writes), one-off types, slots, availability
│   ├── scheduled-events.md # events, invitees, cancellation, no-shows, busy times
│   ├── booking.md          # POST /invitees (Scheduling API) + single-use scheduling links
│   └── webhooks.md         # webhook subscriptions + sample payloads
├── behaviors/             # cross-cutting rules spanning multiple commands
│   ├── identifier-resolution.md  # UUID / URI / name in — normalized internally
│   ├── scoping.md                # users/me bootstrap, cached org, explicit scope widening
│   ├── pagination-and-limits.md  # cursor pagination, no-total-count handling, loud caps
│   └── time-windows.md           # human date flags in, stamped ISO window out, API caps
└── commands/              # one file per command surface
    ├── home.md             # no-args ambient view
    ├── auth.md             # PAT setup, whoami, logout + doctor
    ├── hook.md             # session-hook install/status/uninstall
    ├── types.md            # event types: list/view/slots/create/update/availability
    ├── events.md           # scheduled events: list/view/invitees/cancel/no-show
    ├── book.md             # book a meeting via the Scheduling API
    ├── link.md             # create a single-use scheduling link
    ├── busy.md             # user busy times
    └── webhooks.md         # webhook subscriptions: list/view/create/delete/sample
```

## Conventions

- Specs declare **what** must be true, not **how** to build it.
- Every command spec lists its default TOON schema (the minimal column set), its flags, and its contextual-disclosure suggestions.
- When code and spec diverge, the spec is right and the code is a bug — fix the spec first if the spec is wrong.
