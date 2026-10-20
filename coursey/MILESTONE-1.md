# Milestone 1 — synthetic multi-site development slice

Decision: fork self-hosted Ycode; paid Ycode Cloud is out of scope. This supersedes
the recommendation in the October 20 CCPM audit while retaining its evidence.

## What now works

Two synthetic customers use the same PostgreSQL database, Auth, REST, Storage and
Next/Ycode application. Customer A has two sites with independent memberships;
customer B has one. Each customer can create pages, save layers, edit CMS values,
preview drafts and publish a homepage using native Ycode handlers. Anonymous
visitors receive the appropriate site's published page. Publishing A does not
change B's published records. Browser form sign-in, editor initialization and
cookie-authenticated reload work for both clients.

Draft assets live in private site buckets. Normal owner uploads, draft updates and
deletes succeed. Other clients, nonmembers and removed members cannot retrieve
private files. Published files become readable through metadata-backed policies;
in-place overwrite/delete is denied while published references exist. Settings,
drafts and memberships are checked independently of UI filtering.

## Changes

- New local fork `/opt/ccpm/ycode-platform`, branch `coursey/multisite`, based on
  Ycode `1.37.4` / `5683c22e43965a6b079e5ed9b415cac4165583b4` from
  `alex-coursey/ycode`. The production Vercel target was rechecked and remains at
  that SHA, READY. The MIT license and existing notices are unchanged.
- Operator control schema for customers, sites, verified hostnames, memberships
  and reserved platform-admin identities. Platform administration currently uses
  the separate migration CLI/DB role, not a web API or implicit client bypass.
- Native Ycode tables are provisioned into separate schemas in **one database**.
  Native unique constraints and relationships stay local to each schema. Ordinary
  API roles have replacement RLS; the runtime has no owner/service-role credential.
- Verified Auth identity + live membership + registered hostname determine the
  site. Guessed IDs, caller tenant headers and user metadata confer no access.
- Native server-client/Knex hooks enforce the selected schema and ordinary DB
  role. Dynamic public rendering and cache bypass avoid shared-cache contamination.
- Explicit development route gates and database denial disable unaudited global
  services. Private asset URLs use authenticated application routes.
- Pinned migration/table inventories reject unreviewed upstream schema changes.
  Provisioning/resecuring applies grants only with replacement policies in place.

Remote creation was unavailable: GitHub SSH authentication failed, and installed
connector operations do not offer repository creation/forking. No code was pushed
to the repository attached to production. Add a dedicated origin when repository
creation access is available; local implementation is complete for this slice.

## Tests and results

| Check | Result |
| --- | --- |
| Real Auth + PostgREST + native Next HTTP scenarios | 11 passed |
| Actual migrated-table RLS/role/FK scenarios | 5 passed |
| Chromium native login/editor/cookie reload | Passed for A and B |
| Upstream Ycode suite | 253 tests passed, no failures/skips |
| CCPM suite in separate temporary DB | 27 tests, 124 assertions passed |
| TypeScript | Passed |
| ESLint on new platform TypeScript/handlers | Passed |
| Production build in isolated copy | Passed; existing Inter build-time download required network |
| Fresh schema provisioning + resecuring | Exercised with synthetic site A's second schema |

HTTP coverage includes bilateral guessed page IDs, forged tenant/site headers,
anonymous/nonmember/removed-member access, designer/editor/viewer permissions,
admin-versus-owner membership rules, last-owner protection, immediate membership
revocation without refreshing JWTs, metadata-role spoofing, invalid JWTs and
cross-origin mutation denial. Direct REST tests verify persisted data rather than
interpreting a zero-row 204 as a successful unauthorized write.

CMS coverage includes independent collections/fields/items, allowed editor value
changes, denied viewer changes, no cross-client value mutation and rejection of
foreign-site field relationships. Direct SQL tests cover 13 native content tables
in both directions, RLS catalog enforcement and runtime privilege restrictions.

Native full publication also publishes uploaded assets and leaves the other site's
published assets unchanged. Concurrent A/B page publication and repeated public
reads retain the correct site's content with shared content caches bypassed.

Storage tests have positive controls: owners can upload/update/delete drafts, so
negative results are not merely broken endpoints. Anonymous/private reads, cross-
client reads/writes/deletes and published-file immutability use real Storage APIs.
Browser testing complements these checks; create/edit/publish automation exercises
the native HTTP handlers rather than simulating every editor mouse interaction.

The original audit probe remains unchanged in CCPM at commit `791e9d6`; the new
regression suite replaces its minimal policy fixtures with the migrated schema and
asserts that private cross-client operations are denied.

## Remaining isolation and operational gaps

This is **not production-ready** and is not a claim of exhaustive security review.
Custom layer embeds/HTML and all media/font variants need dedicated XSS/CSP tests
before real untrusted clients are invited. Global code settings and visitor page
passwords are blocked, but layer-level custom code has not received that complete
review. Localization, version-restore paths and all nested native mutation paths
are not exhaustively end-to-end tested, even though they use schema/RLS boundaries.

Forms, Realtime, MCP, API keys, AI, external integrations/import/export, global Auth
user administration, webhook and cron flows are disabled; these must not be
silently enabled by a future upstream merge. Shared caches remain bypassed. Real
DNS verification/TLS/cutover, concurrent revocation stress, production load
and resource limits, legacy data import, all-site schema upgrades, restore drills
and CCPM provisioning/SSO are not delivered. Reserved platform-admin records do
not yet implement a management API.

No production data, provider resources, domains or deployment configuration was
changed. Existing CCPM local edits and the audit commit remain intact. The
isolation stack uses synthetic data and loopback-only published ports. Detailed
setup, environment names, backup/rollback requirements and migration limitations
are in [DEPLOYMENT.md](DEPLOYMENT.md); authorization and maintenance contracts are
in [AUTHORIZATION.md](AUTHORIZATION.md) and [UPSTREAM.md](UPSTREAM.md).

## Next concrete implementation step

Close the custom-embed/HTML execution surface with explicit capability gates and
XSS/CSP regression tests, then add membership-revocation race/stress
checks beyond the passing concurrent A/B publication scenario. After those pass, build a restore-tested legacy-site import/all-site upgrade
runner and connect operator provisioning to CCPM. Do not cut production over or
invite real clients before those gaps have been resolved and reviewed.
