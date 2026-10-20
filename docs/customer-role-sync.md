# Discord customer roles after website payment

Website checkout and all payment providers commit a `customer_role_sync_jobs` row
with the paid order through SQLite triggers. A failed transaction rolls back the
payment and job together. Payment callbacks and wallet checkout attempt the role
immediately; a separate scheduler retries due jobs every minute with bounded
backoff. Discord role/DM failures cannot undo a committed purchase.

On startup, commerce/service history is scanned, but successfully checked customers
are not queued again for 24 hours. The last successful check lives in SQLite, so
restarts do not reset this window. Missing jobs and older successes are queued
(100 processed initially, then batches of 25); all pending retries retain their
attempt counts and due times. `guildMemberAdd` expedites synchronization after
joining or rejoining, and payment/refund jobs remain immediate regardless of
startup freshness.

A per-guild role-policy signature in `system_settings` detects changed role IDs
and spending thresholds. First adoption and policy changes conservatively recheck
successful jobs; pending jobs keep their backoff but invalidate in-flight results
under an older policy. Bump the policy signature version in
`customerRoleSyncService.js` when eligibility logic changes without new tier
values. A deliberate `backfillCustomerRoleSync(guildId, { force: true })` also
rechecks recent successes. This never resets an existing pending retry.
Jobs always resolve current purchase state when processed, and an in-flight
result cannot acknowledge a newer order revision.

Purchaser roles require a fully paid, positive-value order that is neither
cancelled nor refunded, or eligible existing service activity. VIP spending uses
confirmed purchase value and eligible service spending; unpaid carts and excess
transfers do not count. The configured `customer_role_id` / `vip_role_id` take
precedence; Store 1's canonical Patron ID is the fallback, and fixed VIP IDs are
used only in guilds containing those roles. Verification roles remain separate.

Public `/api/health` includes only aggregate `customerRoleSync` diagnostics:
startup counts, latest batch and queue counts. Startup `queued` counts actual new
or reactivated jobs, `unchanged` counts recent successes, and `pending` counts
retained retries; a scan no longer reports existing pending jobs as newly queued.
`awaitingMember` means the customer
must join the relevant Discord server. `failed` includes missing roles, hierarchy,
permissions or transient API errors. Internal jobs store bounded error codes,
never tokens or payment/credential data. Background reconciliation/retries are
silent. Interactive payment flows can notify only after a role was really granted.

If jobs fail persistently, verify `/setup-roles` targets the purchaser role and
that the bot has **Manage Roles** with its highest role above the purchaser/VIP
roles. Due jobs retry after the configuration is repaired.
