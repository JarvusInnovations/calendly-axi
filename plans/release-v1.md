---
status: planned
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

- [ ] `npm pack --dry-run` shows only `dist`, `skills/calendly-axi`, LICENSE, README; tarball installs clean in a scratch dir and `calendly-axi --version` + one authed live command work from it.
- [ ] Manual `0.1.0` publish done by a human; trusted publisher configured; next CI release publishes with `_npmUser: GitHub Actions` + provenance attestation (verified via `npm view`).
- [ ] `BOT_GITHUB_TOKEN` visible to the repo before any Release PR merge.
- [ ] Release PR retitled past any manually-published version (no registry collision).
- [ ] `axi` catalog entry merged; tool listed on the generated docs.
- [ ] `v1.0.0` released with the full spec'd surface; every prior plan `done`.

## Risks / unknowns

- Org-secret access needs an org admin; if unavailable, `release-publish` fails at merge time — resolve before merging, not after.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
