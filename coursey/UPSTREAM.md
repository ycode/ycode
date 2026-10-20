# Fork maintenance

Local repository: /opt/ccpm/ycode-platform; branch coursey/multisite.
Base: alex-coursey/ycode at 5683c22e43965a6b079e5ed9b415cac4165583b4,
package version 1.37.4. Upstream remote: https://github.com/ycode/ycode.git.
Preserve LICENSE (MIT, Copyright (c) 2026 Ycode) and existing notices.

Remote fork creation is unavailable: local GitHub SSH authentication fails and
available connector operations do not include creating a repository/fork. No
changes will be pushed to the repository connected to production deployment.
Create a dedicated repository later and add it as origin; never point origin at
the production-connected alex-coursey/ycode repository for this work.

Keep platform code/migrations/tests in coursey/ with small explicit hooks into
upstream modules. Record and review every upstream database migration. Run them
per site under the migration role, apply replacement RLS before granting access,
and test all sites in one database. Never enable new upstream routes automatically.
A site schema reduces changes to native IDs/foreign keys; it does not remove the
need to review dynamic/raw SQL, settings, storage, caching and background work.

Update procedure: fetch upstream, branch from last tested platform commit, merge
one upstream release, inventory new tables/routes/credential paths, apply all-site
migration in a copy, run policy/HTTP/storage/browser tests and restore tests, then
review deploy. Keep the pinned previous image and whole-database plus storage
backup for rollback. No production upgrade until the affected surface passes.
