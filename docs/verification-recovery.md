# Verification recovery — 2026-10-19

## OAuth request controls — 2026-11-14

The HTTP login and callback paths now have bounded local request budgets. A
valid signed browser flow has its own budget, so the launcher's shared loopback
address does not become a small server-wide login quota. Arbitrary forwarded-IP
headers are not trusted. New login tabs reuse a still-valid matching browser
flow; its cookie covers `/oauth` (or the configured path prefix), while legacy
callback-only cookies are expired on set/clear.

After HMAC, browser, application and store validation, SQLite atomically claims
the SHA256 state identity before any token exchange. Concurrent callbacks and
replays after a process restart cannot exchange the same state twice. Claims
contain no raw state, authorization code, browser cookie or token. The requested
scopes remain `identify guilds.join`, and membership, role and encryption checks
remain required.

A Discord HTTP429 becomes HTTP429 with a safe `Retry-After` and a clear wait
message. A persisted per-application/store cooldown blocks both fresh logins
and additional token exchanges. Header and bounded JSON `retry_after` values
are honored; long valid waits are preserved. While a body-only limit is being
read, a provisional cooldown blocks new work; only that exact observation can
resolve its fallback, without shortening a newer concurrent provider wait.
There is no automatic token POST retry and no raw provider-body logging. Success
body reads retain the request deadline and a bounded response size.

After Discord returns a validated member identity, completion is serialized
per application/store/guild/member. Each turn force-fetches the current member
and compares the canonical grant/consent version before storing tokens or
continuing after role I/O. A newer grant, deletion or revoked consent aborts
the older completion. Queued callbacks take their own baseline when their
turn begins, so a later valid completion can store its token pair normally.
Role snapshots never create or renew OAuth consent.

After the customer membership read, callback completion refreshes the full role
list and the bot's own member from Discord. It selects the verification role
from that returned list, not a stale cached alias, and rechecks its exact ID,
permissions and current hierarchy immediately before granting. Failed metadata
reads, deleted/managed roles or privileged roles withhold the role and welcome;
valid OAuth consent can still be saved with an honest partial response. The
consent comparison also runs after these additional REST waits.

This refresh closes the demonstrated stale-cache window; it does not make a
remote role edit and assignment atomic. A server administrator can still change
a role after the final fetch. See Discord's
[permission hierarchy](https://docs.discord.com/developers/topics/permissions#permission-hierarchy)
and [role assignment endpoint](https://docs.discord.com/developers/resources/guild#add-guild-member-role).

Optional welcome DMs have a durable per-member/verification-role claim and a
deterministic nonce. Browser success and the next completion do not wait for
that DM. Positive receipts are recorded; uncertain or failed welcomes are
held without automatic resends. This journal is delivery metadata, not proof
that a member received or read a welcome.

The browser success response no longer waits for a guild recovery snapshot.
The existing per-guild snapshot lock and 30-minute freshness guard still apply.
These changes control our requests; they do not prove whether Discord has
restricted an application on its own authorization page or clear such a review.
See [Discord rate-limit documentation](https://docs.discord.com/developers/topics/rate-limits)
and [OAuth state guidance](https://docs.discord.com/developers/topics/oauth2#state-and-security).

## Diagnosis

- The reported Discord page says the application is flagged by its anti-spam system pending review. This happens on Discord's authorization page before this application's callback. Resetting a token does not resolve that restriction; review it in Developer Portal and contact Discord Developer Support when needed.
- A separate, reproducible bot defect prevented the renamed `⌘ Cenar Explorer` role from being found. The stable member role is `1282638730812854345`; it must not be confused with purchaser/VIP roles.
- Both stores currently register the root `/oauth/callback` redirect. The launcher previously sent that path to Store 1 even for Store 2 authorizations.

## Fixes

- Resolve the stable Explorer ID first, then exact decorated verification aliases. Refuse managed/everyone, buyer tiers, administrative/moderation privileges, and roles outside the bot's hierarchy. An invalid explicit `VERIFIED_ROLE_ID` fails closed.
- Add signed application/store bindings to new OAuth state. The launcher's fixed Store 2 routing hint is not authentication: the child still verifies HMAC, browser cookie, expiry, application ID and store before exchanging a code. Legacy v1 states without these optional fields retain their existing validation.
- Preserve existing registered callback URLs. No OAuth scope is removed: `identify guilds.join` and encrypted recovery consent remain required.
- Ignore malformed unrelated cookies; reject invalid state safely. Provider denial is shown without reflecting arbitrary provider text. Token/profile requests have a 12-second deadline covering the body, and raw OAuth failure bodies are not logged.
- Do not resend welcome DMs to members who already have the verification role.

## Verification

- Local full suite: 142 files, 976 tests passed.
- Source smoke: 79 commands loaded.
- Focused tests cover renamed/privileged roles, state tampering and cross-store/application rejection, encrypted persistence, user cancellation, timeout, missing consent/membership and repeated-DM suppression.

## Ownership and credentials

Transfer the existing applications through Discord's supported ownership/team flow when consolidating accounts. This preserves Bot IDs, existing bot-authored messages and OAuth consent. A replacement application has a different identity and cannot edit the old bot's order/ticket messages; existing OAuth tokens belong to the old application. Do not overwrite production credentials or remove the old bot before a reviewed migration plan, backups and a working replacement are available.

New/reset credentials must be entered by the human operator in the provider UI; never paste tokens or client secrets into chat or commit them.
