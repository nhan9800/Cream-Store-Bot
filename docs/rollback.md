# Bot rollback v2

The production workflow automatically rolls back when deployment or exact-SHA health checks
fail. Rollback state is scoped to the failed SHA, so an SSH failure before activation cannot
roll a healthy deployment back an extra version.

For a manual emergency rollback, use GitHub Actions `workflow_dispatch` with the full SHA of
a known-good commit that is already reachable from `main`. Do not use `git checkout` or edit
the live worktree by hand; doing so breaks revision and rollback tracking.

After rollback, verify both configured health URLs show:

- HTTP 200
- `ok: true`
- `discordReady: true`
- the same expected 40-character `commitSha`

If a database migration caused the incident, stop both stores and restore only a verified
SQLite backup from `backups/deploy/` under an incident-specific recovery plan. Never replace
a live SQLite file while either bot process is writing to it.
