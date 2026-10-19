# Verification recovery — 2026-10-19

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
