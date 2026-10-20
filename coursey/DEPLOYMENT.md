# Development deployment and migration runbook

This is the first Coursey fork milestone, not a production deployment procedure
that has been exercised against customer data. The production Vercel site and
CCPM deployment remain unchanged. Paid Cloud is not used.

## Topology

One development PostgreSQL database (`coursey_dev`), one GoTrue Auth service,
one PostgREST service, one Storage service and one Next/Ycode application.
Customers A/B have schemas `site_alpha`, `site_beta`; customer A also owns
`site_alpha_two`. These are schemas **within the same database**, not databases
or Supabase projects. Operator-owned control tables hold customers, sites,
verified domains, memberships and platform administrators.

This development stack uses real Supabase GoTrue and Storage images plus
PostgREST on stock PostgreSQL. It is a deliberately reduced self-hosted stack,
not Supabase's entire production distribution. Realtime, Studio, Edge Functions,
external integrations and customer-facing forms are not deployed/enabled.

All published ports bind to loopback:

- `http://alpha.localhost:3310/ycode`
- `http://beta.localhost:3310/ycode`
- `http://alpha-two.localhost:3310/ycode`
- Auth/REST/Storage development gateway: `127.0.0.1:54329`

If a local resolver does not resolve `*.localhost`, use a local hosts entry or
`curl --resolve alpha.localhost:3310:127.0.0.1`. Do not expose these ports publicly
or attach production credentials. The gateway has development CORS behavior and
is not a production gateway. Domain `verified` flags are operator-seeded in this
synthetic environment; real DNS ownership/certificate automation is not built.

## Clean development setup

Run from `/opt/ccpm/ycode-platform`. Docker is sufficient; the host needs no Ruby
or Node installation. `node_modules` are installed in this separate checkout.

1. `docker run --rm --user 1000:1000 -v "$PWD:/workspace:z" -w /workspace node:22-bookworm npm ci --ignore-scripts --no-audit --no-fund`
2. `python3 coursey/dev/generate-secrets.py` creates a mode-0600 development env
   outside source at `/opt/ccpm/dev-secrets/coursey.env`; it refuses replacement.
3. `docker compose --env-file /opt/ccpm/dev-secrets/coursey.env -f coursey/dev/compose.yml up -d db auth rest storage gateway`
4. Wait for Auth `/auth/v1/health` and Storage `/storage/v1/status` to return 200.
   Auth and Storage must finish their own global migrations before the platform
   migrations. No production service is part of this Compose project.
5. `python3 coursey/dev/run-migration.py control` applies
   `coursey/migrations/001-control.sql`, then `002-storage-grants.sql` once.
6. `python3 coursey/dev/seed.py` creates seven synthetic Auth users, two customers,
   three operator-registered sites and their memberships. This seed is one-time;
   it does not silently replace identities. Login details are stored mode 0600 in
   ignored `coursey/test-results/identities.json`; never commit or print it.
7. Run `python3 coursey/dev/run-migration.py site SITE_ID` for each registered
   synthetic site. IDs appear in the seed source (not secret). All 46 original
   upstream migrations are fingerprinted in `coursey/upstream-migrations.json`;
   44 run per site. The global storage migration and global Auth role bootstrap
   are deliberately skipped. Each schema is built in a single transaction,
   original policies replaced, and grants applied only after replacement RLS.
8. `docker compose --env-file /opt/ccpm/dev-secrets/coursey.env -f coursey/dev/compose.yml up -d web`

`secure-site SITE_ID` reapplies replacement policies transactionally to an
existing registered schema. It is not a general upstream schema-upgrade runner.
New/changed upstream migrations or unknown tables fail provisioning until their
fingerprints and policies are deliberately reviewed. Never regenerate the
manifest blindly as part of an upgrade.

Auth identities are shared, but site access is never inherited merely from a
customer, hostname parameter, user metadata, global Auth role or existing token.
Members can manage already registered users through `/coursey/api/members`;
platform registration/provisioning remains an operator CLI operation in this
milestone. Built-in global Ycode invite/user-admin routes remain disabled.

## Environment names and credential separation

| Process | Names | Purpose |
| --- | --- | --- |
| Development Compose only | `DEV_DATABASE_PASSWORD`, `DEV_JWT_SECRET`, `DEV_ANON_KEY`, `DEV_SERVICE_KEY` | Random development values generated outside source; never reuse in production |
| Ycode runtime | `COURSEY_PLATFORM=true` | Enables the explicit fork hooks and route gates |
| Ycode runtime | `COURSEY_DATABASE_URL` | Restricted SQL login: no superuser/BYPASSRLS/DDL/ownership/control-table mutation; SQL pool rejects privileged roles and switches to authenticated/anon |
| Ycode runtime | `SUPABASE_URL` | Internal gateway URL reachable by the server |
| Ycode runtime/browser config | `COURSEY_SUPABASE_PUBLIC_URL`, `SUPABASE_PUBLISHABLE_KEY` | Public gateway URL and public Auth/API key; never a service key |
| Operator CLI only | `COURSEY_MIGRATION_DATABASE_URL` | Owner/migration connection, injected into the isolated CLI process only |
| Optional browser runner | `COURSEY_BROWSER_WEB_HOST=web` | Resolves synthetic hostnames to the isolated web service |

The web service receives neither the service-role key nor the migration owner
connection. Legacy `getSupabaseAdmin` calls are intercepted in platform mode and
return an ordinary site-scoped user/anon client; all native repositories thus use
RLS. Legacy Knex calls receive a pool fixed to the verified site/actor and ordinary
DB role. Pool search_path excludes the legacy public schema. Unknown/missing
request contexts throw, including background work without an authenticated site.

The shared cookie name is explicitly set to `coursey-auth` on browser and server,
so internal/public gateway hostnames do not create different session cookie names.
Cookies are host-only, SameSite=Lax, Secure under production HTTPS; browser Auth
requires readable cookies. The proxy forwards/persists refreshed session cookies.
Unsafe browser requests with a different Origin are rejected. Bearer-token clients
are independently verified through Auth. Requests are authorized again in RLS;
proxy/UI checks do not substitute for database enforcement.

`generate-secrets.py --rotate-api` changes development JWT/API keys while retaining
the database password. Recreate auth/rest/storage/web to apply them. Old development
JWTs cease to verify; sign in again. This was exercised after the browser runner
printed a development public key in a failed-request diagnostic. The runner now
suppresses request diagnostics. No production credentials were involved.

## Regression commands

```sh
python3 coursey/tests/http_isolation.py
python3 coursey/tests/rls_regression.py
docker compose --env-file /opt/ccpm/dev-secrets/coursey.env -f coursey/dev/compose.yml exec -T web npm test
docker compose --env-file /opt/ccpm/dev-secrets/coursey.env -f coursey/dev/compose.yml exec -T web npx tsc --noEmit
```

HTTP tests use real GoTrue JWTs, PostgREST, Storage and native Ycode endpoints;
SQL tests use actual migrated Ycode tables. The earlier CCPM audit probe remains
unchanged as the upstream counterexample. The new suite reverses its expected
outcome: cross-client private access must fail. Anonymous published access must
succeed. Tests intentionally mutate only synthetic development data.

Browser tests have their own dependency lockfile to avoid changing upstream
package-lock.json. Build `docker build -t coursey-ycode-browser-tests coursey/tests/browser`,
then run the image on `coursey-ycode-dev_default` with
`COURSEY_BROWSER_WEB_HOST=web`, source mounted at `/workspace`, and the command
from its Dockerfile. Only ignored test-results need to be writable. Its gateway
interception is a test-network adapter, not an authorization bypass; the real Auth
service still verifies passwords and sets the browser session. The browser smoke
checks native form login, editor loading, cookie-authenticated reload and separated
data for both clients. Create/edit/preview/publish and storage mutations are covered
through native HTTP handlers, not by simulated browser tenant filtering.

## Before any production migration

Do not run these scripts against the existing Vercel/Supabase deployment. First:

1. Record a pinned code/image revision and the current Vercel configuration,
   Supabase schema/policies/grants/extensions/Auth configuration and storage inventory.
2. Back up all four CCPM databases, preserve its separate env/encryption keys,
   take an independent Supabase database backup and copy storage file bytes plus
   metadata. Restrict backup permissions. Database dumps alone do not contain files.
3. Restore into an isolated target and verify Auth identities, content, assets and
   login before claiming a backup/rollback path. No production backup/restore was
   claimed or performed in this milestone.
4. Build a separate production candidate with properly separated migration/Auth/
   Storage/runtime roles and TLS gateway. Preserve the working deployment.
5. Add control tables, register the legacy customer/site and verified domains,
   migrate the legacy public tables into a site schema with explicit import tooling,
   preserve IDs and foreign keys, replace policies/grants and revoke legacy public
   exposure. This legacy import is **not implemented** yet. Do not run upstream
   per-site seeds over existing customer data.
6. Copy legacy public assets to a private site bucket, repair URLs and metadata,
   identify published references and verify anonymous/private behavior. Treat old
   public URLs as already public; moving files does not erase cached copies.
7. Run the expanded isolation/browser/storage suite, concurrent publish/revocation
   tests, load/resource tests and a restore drill. Add monitored migrations and a
   production gateway/domain-verification flow. Then request approval for cutover.

Rollback before cutover: stop the isolated Compose project; its volumes preserve
test data. Rollback after a future cutover must restore compatible code + database
+ storage together and revert DNS/editor URLs, with a write-reconciliation plan.
Do not undo multi-client schemas by flattening them into public, drop ownership
columns, or point the old single-site app at the shared platform database.

## Current operational limits

The application is an isolated development deployment. No custom-domain ownership
verification/TLS automation, legacy import, all-site upgrade runner, CCPM provisioning
UI/SSO, production monitoring or load qualification has been delivered. Realtime,
forms, MCP, API keys, external integrations/import/export, global user management,
AI, cron and webhook operations are gated; associated secret/integration tables
are also default-denied in RLS. Maps and process-wide HTML publication stamps are
disabled. Shared content caches are bypassed; public HTML is dynamic and private
assets use noncacheable authenticated routes. This favors correctness over scale.

Static global-code settings and visitor page passwords are blocked. Layer-level
custom embeds/scripts and designer-supplied HTML still require a dedicated XSS/CSP
review; do not onboard untrusted real clients yet. Native feature surfaces such as
localization, version restore, every font/media variant and concurrent workflows
are not exhaustively end-to-end tested. The bounded per-site/identity SQL pool is
appropriate to this proof, not a capacity-planned production pool.

Use the explicit route snapshot in `coursey/routes.ts` plus migrations/table
fingerprints when reviewing upstream changes. Review newly introduced static
routes for collisions with dynamic parameter patterns. Preserve the MIT license
and notices; do not overwrite the production-connected source repository.
