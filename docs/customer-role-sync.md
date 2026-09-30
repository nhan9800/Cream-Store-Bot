# Discord customer roles after website payment

Website checkout and all payment providers commit a `customer_role_sync_jobs` row
with the paid order through SQLite triggers. A failed transaction rolls back the
payment and job together. Payment callbacks and wallet checkout attempt the role
immediately; a separate scheduler retries due jobs every minute with bounded
backoff. Discord role/DM failures cannot undo a committed purchase.

On startup, paid commerce customers and existing service users are added to the
queue (100 processed initially, then batches of 25). Customers who have not joined
the server remain pending; `guildMemberAdd` expedites synchronization after joining
or rejoining. Jobs survive restarts and resolve the current purchase state each
time. An in-flight result cannot acknowledge a newer order revision.

Purchaser roles require a fully paid, positive-value order that is neither
cancelled nor refunded, or eligible existing service activity. VIP spending uses
confirmed purchase value and eligible service spending; unpaid carts and excess
transfers do not count. The configured `customer_role_id` / `vip_role_id` take
precedence; Store 1's canonical Patron ID is the fallback, and fixed VIP IDs are
used only in guilds containing those roles. Verification roles remain separate.

Public `/api/health` includes only aggregate `customerRoleSync` diagnostics:
startup counts, latest batch and queue counts. `awaitingMember` means the customer
must join the relevant Discord server. `failed` includes missing roles, hierarchy,
permissions or transient API errors. Internal jobs store bounded error codes,
never tokens or payment/credential data. Only roles actually granted trigger a
success DM.

If jobs fail persistently, verify `/setup-roles` targets the purchaser role and
that the bot has **Manage Roles** with its highest role above the purchaser/VIP
roles. Due jobs retry after the configuration is repaired.
