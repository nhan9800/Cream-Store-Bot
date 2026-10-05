# System administration and launcher recovery

Reviewed 2026-10-05 (Asia/Saigon).

- Staff retain existing commerce/support/music operations. Every registered `/api/bot/admin/data/*`, `/admin/settings*` and `/admin/ai-knowledge*` route requires the current database role `admin`, in addition to the API key, current session version, account suspension and enrolled MFA proof checks.
- Use the registered Express route when classifying permission. Express accepts case-insensitive paths and trailing slashes; a user-controlled role header must not override the database role.
- A full SQLite download contains sensitive account and commerce data. Only Admin can create/download/list/restore backups or run maintenance. Keep website proxy/page checks as another layer; bot remains authoritative.
- Purge is operating-log retention only: integer90–3650days, minimum90days. Do not erase wallet ledger or payment receipts/replay evidence as routine log cleanup. Financial retention requires a separate decision and reconciliation plan.
- Forked stores watch their launcher's IPC connection and run the same bounded shutdown when it disconnects. This covers abrupt launcher termination where the parent cannot deliver SIGTERM. Container restart cleared actual port5000/8080 collisions on05/10; logs alone did not identify the original owning PID.
- Additive `link_warnings` schema stores per-user/per-guild warning counts. Database reinitialization retains counts.

Regression gates: real Express + temporary SQLite tests for Staff denial/forged role/Admin backup/financial retention; real subprocess SIGKILL test verifies release and reuse of a TCP port. No production restore, purge, fake payment or destructive cleanup is needed to validate these fixes.

The hosting audit is in the website repository `docs/hosting-security-audit-20261005.md`; deployment evidence is maintained in root `.project-memory/ACTIVE.md`.
