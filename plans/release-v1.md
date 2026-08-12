---
status: done
depends: [docs-skill]
specs:
  - specs/architecture.md
issues: []
---

# Plan: Release v1.0.0

> **Operational plan — do not auto-execute.** Publishing claims the npm name irreversibly and needs human-held credentials; every step below runs with explicit human sign-off, not in an agent wave.

## Scope

**In:** pre-publish verification (`npm pack` → clean install → run against the live API), the manual first `npm publish` (registry bootstrap for trusted publishing), configuring the trusted publisher on npmjs.com (`publish-npm.yml`), verifying `BOT_GITHUB_TOKEN` is granted to this repo (flagged missing at bootstrap), registering the tool in the `axi` catalog (`catalog.yaml` + `pnpm run docs:gen`, separate PR in that repo), and shepherding the `Release: v1.0.0` PR through the release-flow skill. **Out:** feature work of any kind.

## Implements

- `specs/architecture.md` — build & distribution section, end state: installable `calendly-axi` on npm with OIDC-published releases.

## Validation

- [x] `npm pack --dry-run` shows only `dist`, `skills/calendly-axi`, LICENSE, README; tarball installs clean in a scratch dir and `calendly-axi --version` + one authed live command work from it. *(Verified 2026-08-12 — clean-room install also exercised the hook install/uninstall cycle.)*
- [x] Manual `0.1.0` publish done by a human; trusted publisher configured; next CI release publishes with `_npmUser: GitHub Actions` + provenance attestation (verified via `npm view`). *(v1.0.0 shows `trustedPublisher: github` + SLSA provenance.)*
- [x] `BOT_GITHUB_TOKEN` visible to the repo before any Release PR merge. *(Installed as a repo-level secret 2026-08-12.)*
- [x] Release PR retitled past any manually-published version (no registry collision). *(v0.1.0 → v1.0.0, recomputed from the changelog.)*
- [ ] `axi` catalog entry merged; tool listed on the generated docs. *(PR open upstream with checks passed — <https://github.com/kunchenguid/axi/pull/138>; merge is the upstream maintainer's.)*
- [x] `v1.0.0` released with the full spec'd surface; every prior plan `done`. *(Released 2026-08-12 — <https://github.com/JarvusInnovations/calendly-axi/releases/tag/v1.0.0>.)*

## Risks / unknowns

- Org-secret access needs an org admin; if unavailable, `release-publish` fails at merge time — resolve before merging, not after.

## Notes

Executed 2026-08-12 as the human-gated runbook it was written to be: repo-level `BOT_GITHUB_TOKEN`, manual `0.1.0` bootstrap publish + trusted-publisher config by the maintainer, everything else driven by the orchestrator. The pre-publish live mutation pass (recorded across the domain plans) surfaced and fixed three API contract errors before anything shipped.

## Follow-ups

- Tracked as: upstream catalog PR <https://github.com/kunchenguid/axi/pull/138> (open, checks passed — awaiting maintainer merge).
- Tracked as: two live boxes elsewhere await an elapsed/consumed booking (no-show round-trip in `events-write`, link single-use enforcement); plus probing `active: true` on `types create` (noted in `types-write`).
