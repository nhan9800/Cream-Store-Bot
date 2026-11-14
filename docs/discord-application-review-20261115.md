# Discord authorization restriction — 2026-11-15

## Confirmed routing

Anonymous, nonconsenting login handshakes were inspected and stopped before
Discord authorization. State values, cookies and secrets are omitted.

| Surface | Application ID | Callback | Requested scopes |
| --- | --- | --- | --- |
| Website Discord Studio | `1382729296724099132` | `https://cenarstore.xyz/api/auth/callback/discord` | `identify email guilds connections guilds.members.read` |
| Store 1 verification | `1382729296724099132` | `https://api.cenarstore.xyz/oauth/callback` | `identify guilds.join` |
| Store 2 verification | `1139187282075721768` | `https://api.cenarstore.xyz/oauth/callback` | `identify guilds.join` |

Studio and Store 1 share an application identity. The customer's screenshot
reports a Discord anti-spam restriction pending review on Discord's own page.
A shared application restriction therefore explains both reported failures;
the exact enforcement reason and current review status are visible only to
Discord and the application owner. Store 2 is a distinct application and its
restriction status has not been established.

At inspection, both bot health endpoints reported Discord readiness and no
observed OAuth provider HTTP 429 or active cooldown. REST monitoring reported
zero observed rate-limit events in the current Store 1 process. These local
counters cannot detect or clear an application authorization restriction.

## Owner recovery steps

1. Sign into [Discord Developer Portal](https://discord.com/developers/applications/1382729296724099132/information)
   as the owner/team of application `1382729296724099132`; inspect notices and
   any review requests for this existing application.
2. Open [Discord's application enforcement appeal](https://dis.gd/app-appeal),
   linked from Section 9 of the
   [Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service).
   Attach the reported screenshot and the observed time/timezone. Add the
   application's actual owner email and any notice/reference number in the
   provider form, never in a public repository or chat.
3. After Discord confirms restoration, test one fresh browser flow through
   Studio and one through Store 1 verification. Confirm the expected callback
   and role result; do not repeatedly submit authorization while restricted.

No appeal was submitted, credentials changed, application replaced, consent
granted or customer role assigned during this diagnosis. Changing hosting or
resetting a bot token does not itself resolve the restriction shown in the
screenshot.

## Review request draft (owner must review and submit)

Subject: Review requested: Cenar Store application authorization restricted

Hello Discord Developer Support,

I am the owner/authorized team member of Cenar Store application
1382729296724099132. Customers see an anti-spam/review restriction on Discord's
authorization page. It blocks both our website's Discord Profile Studio login
and our Discord server's verification flow, which use this same application.

Website callback: https://cenarstore.xyz/api/auth/callback/discord
Verification callback: https://api.cenarstore.xyz/oauth/callback

The attached screenshot shows the error. Please tell us the specific issue or
required corrective action and review the application's authorization access.
We will provide any additional information through this support request.

Our bot currently uses signed browser-bound, expiring OAuth state, single-use
callback claims, bounded requests and persisted HTTP 429 cooldowns. Verification
requires explicit customer authorization; the reported page appears before
our callback. These details describe our bot implementation and do not claim
to establish the reason for Discord's restriction.

Thank you.
