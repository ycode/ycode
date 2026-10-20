# Coursey platform authorization contract

Decision recorded before schema changes, 2026-10-20. Base: Ycode 1.37.4,
5683c22e43965a6b079e5ed9b415cac4165583b4. MIT LICENSE remains unchanged.

A customer is a commercial owner, not an identity. A customer owns many sites.
A user is a shared Supabase Auth identity. A site membership binds that identity
to one site with owner, admin, designer, editor or viewer role. Customer membership
is not implicitly inherited by sites. A platform administrator is explicitly
registered in the control schema and may provision sites; it is not an editable
Auth metadata field. CCPM remains the operator management panel; this milestone
must not grant CCPM users automatic platform access.

Owners/admins manage their site's memberships and content; designers create/edit
and publish structure/content; editors edit CMS content only; viewers read drafts
and preview. Clients cannot create platform admins, change customer ownership,
select arbitrary schemas or execute SQL. Owners cannot remove the last owner.
Removal takes effect on the next database authorization check, including with an
unexpired JWT. Every request derives identity from verified Supabase Auth and
checks a live site membership. Hostnames resolve through an operator-maintained
verified domain registry. Caller-supplied tenant/site headers grant no authority.

One PostgreSQL database, one Supabase Auth/storage stack, separate schema per site.
Schemas partition native Ycode tables, unique constraints and foreign keys. They
are not themselves access control: replacement RLS calls control-schema membership
functions for the specific site. Anonymous access is limited to published content
and explicitly public configuration. Private asset buckets have matching policies;
published asset access is derived from published asset metadata, not the bucket's
public flag. Clients cannot overwrite published file bytes in place.

Application content access uses user/anonymous credentials, never service-role
credentials. Direct SQL runtime credentials have no BYPASSRLS, schema ownership,
DDL or control-table mutation privileges. Operator provisioning is a separate
CLI/process with separate credentials. No request may fall back to the operator
connection. Async work requires explicit site and actor context and reauthorization.

Until specifically implemented/tested, setup/devtools/import-export/MCP/API keys,
AI/integrations/webhooks/cron, arbitrary code, password-protected visitor pages,
and public forms must fail closed in platform mode. Do not expose legacy public
schema tables. Disable shared caches until site/auth dimensions and invalidation
are covered. Never use this development stack with production credentials/data.

Implementation status: platform_admins reserves explicit platform-user identities.
This milestone has no web provisioning/admin API or automatic support bypass.
The operator-only CLI is authorized by a separate migration-role connection;
customer HTTP requests never receive that credential or role.
