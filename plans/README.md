# Plans

Specs ([`../specs/`](../specs/)) describe **state** — what should be true. Plans describe **motion** — the work bringing code into conformance. Each plan declares its scope, the specs it implements, dependencies on other plans, and the validation criteria that flip it to `done`. Once merged and closed out, a plan freezes as the historical record of what got built.

The full protocol (frontmatter schema, body template, status lifecycle, closeout ritual) lives in the **specops** skill — see [`../.agents/skills/specops/references/plans-protocol.md`](../.agents/skills/specops/references/plans-protocol.md).

No hand-drawn DAG here — it would rot. Query the live graph:

```sh
.agents/skills/specops/scripts/specops next   # what's ready to work on
.agents/skills/specops/scripts/specops dag    # mermaid graph
```
