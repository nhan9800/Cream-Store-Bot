# Bot production deployment v2

The only supported production path is `.github/workflows/deploy-production.yml`.
The old HTTP deploy webhook and cPanel `.cpanel.yml` path have been removed.

## Safety gate

Keep repository variable `PRODUCTION_DEPLOY_ENABLED` unset or `false` until all leaked
credentials have been rotated and both production health URLs work over HTTPS. A push to
`main` still runs tests while this gate is off, but it does not change the host.

## GitHub configuration

Create environment `bot-production` and require approval if the account supports it.
Store these as environment secrets:

- `BOT_SSH_HOST`
- `BOT_SSH_USER`
- `BOT_SSH_PRIVATE_KEY`
- `BOT_SSH_KNOWN_HOSTS`

Store these as repository variables (not environment-only variables):

- `PRODUCTION_DEPLOY_ENABLED=false`
- `BOT_APP_ROOT` — absolute path of the production Git clone
- `BOT_HEALTH_URL` — Store 1 HTTPS `/api/health`
- `BOT_HEALTH_URL_STORE2` — Store 2 HTTPS health URL, normally `/store2/api/health`
- `BOT_SSH_PORT` — normally `22`

Generate `BOT_SSH_KNOWN_HOSTS` from a trusted administrator machine. For a non-standard
port, the entry must use `[hostname]:port`. Do not run an unverified `ssh-keyscan` in CI.

## One-time host bootstrap

1. Install Git, Node.js 22.12 or newer, npm, Bash, `flock`, and PM2 if Passenger is not used.
2. Clone the bot repository into the exact `BOT_APP_ROOT`; its `origin` must be the intended
   GitHub repository and the host must have read-only Git credentials.
3. Create private runtime files `.env` and `.env.store2`. Never copy them into Git.
4. Keep both SQLite databases under the ignored `data/` directory.
5. With PM2, the required process name is `cenar-store-launcher` from
   `ecosystem.config.cjs`. Otherwise configure Passenger to react to `tmp/restart.txt`.
6. Confirm both health URLs return `ok: true`, `discordReady: true`, and a 40-character
   `commitSha`.

## Deployment behavior

Every push to `main` (or a manually selected full SHA that is already on `main`) does this:

1. Checkout and test the exact commit with Node 22.12.
2. SSH with pinned host keys and serialize deployments with `flock`.
3. Fetch `origin/main`, validate commit type and ancestry, then reset to the exact SHA.
4. Install the lockfile, validate both store configs, integrity-check and back up both SQLite
   files, and register slash commands for both stores.
5. Restart the launcher and require both health URLs to report the exact SHA.
6. On failure, roll back only if that same SHA was activated, then health-check both stores
   on the previous SHA.

Backups are written to `backups/deploy/`, mode `0600`, with 20 retained per store. Database
restoration is deliberately manual because code rollback cannot safely infer whether a schema
migration is reversible.

After the first supervised successful run, set repository variable
`PRODUCTION_DEPLOY_ENABLED=true`.
