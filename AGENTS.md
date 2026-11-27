# Cenar Discord bot and API

This repository owns Discord interactions, commerce rules, order and payment state, and the SQLite data the website reaches through the bot API. Website routes and UI live in `nhan9800/cenar-website`. Check the current dependencies and paths in code before relying on historical release notes.

## Start here

- [Session workflow and evidence](docs/agent-harness.md)
- [Bot and website boundary](docs/architecture.md)
- [Website integration contract](docs/BOT_API.md)
- [UI craft playbook: cards, custom emoji, announcements](docs/ui-craft-playbook.md) and [Components V2 style guide](docs/discord-components-v2-style-guide.md)
- [Refund ledger, cases and VietQR](docs/refund-ledger.md)
- [Announcement behavior and verification](docs/announcement-ai-repair-20261030.md)
- [VibeHost deployment](docs/VIBEHOST_DEPLOY_GUIDE.md) and [rollback](docs/rollback.md)

Run `node scripts/check-agent-harness.mjs` for a read-only checkout and document check. In the shared Cenar workspace, follow the parent `AGENTS.md` and start with `.project-memory/INDEX.md` and `.project-memory/ACTIVE.md`.

## Verify changes

- Use `npm ci` for locked installs and `npm test -- path/to/relevant.test.js` for focused tests. Use `npm run smoke` for source validation.
- For dependency or hosting changes, run `npm run check:deps`, `npm run check:staged-runtime`, and `npm audit --omit=dev --audit-level=high`.
- Production promotion uses the verified `bot-production` revision. After an authorized deployment, check both store health endpoints for the exact promoted SHA and `discordReady` before recording completion.
- Use fixtures or private previews for Discord and payment tests. Real sends, supplier purchases, and payment actions require explicit task scope. Preserve SQLite data, backups, environment files, and rollback state.
