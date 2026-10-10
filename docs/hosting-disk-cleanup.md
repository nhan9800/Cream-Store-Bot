# Bot hosting disk cleanup

The VibeHost supervisor previously retained every dependency stage after `npm ci`. Each completed stage can contain a whole `previous-node_modules` installation. These are rollback snapshots, so retaining all of them can fill the3GiB hosting quota.

`scripts/cleanup-dependency-stages.mjs` measures allocated bytes without following symlinks and audits before deleting. The exclusively locked supervisor invokes it only after a validated source revision and native runtime are ready, before starting the stores. Cleanup failure does not prevent bot startup.

## Retention and boundaries

- Only direct `.vibehost/dependencies-XXXXXXXX` directories with the supervisor's recognized package manifests and known stage contents are eligible.
- Recognize the installer's optional `scripts` directory only when it contains the single regular, unlinked `patch-dependency-compat.js` file of at most64KiB. Unknown scripts, linked directories/files and larger files remain protected. This prevents the parser security update from creating permanently skipped dependency snapshots.
- Keep the two newest stages, plus the newest stage containing rollback modules if newer failed installs occupy those two slots.
- Preserve any stage younger than24hours, the current install stage and stages referenced by live `node_modules` symlinks. Skip unfamiliar content, external/symbolic stage roots and filesystem mount boundaries.
- Verify current native dependencies before applying. Recheck revision/path/inode/manifest identity, rename each candidate within the same state directory and recheck the deletion target before removing it. Symlink destinations are never traversed.
- SQLite, data, backups, environment files, current node_modules, Git history, assets, source and npm's cache are outside deletion scope.
- Scan has its own60second budget, native preflight45seconds, deletion a fresh180second budget and the supervisor a300second total timeout. Each completed removal emits progress even if later cleanup stops. Default CLI is audit only. Applying manually must hold the same exclusive supervisor lock while no managed installer is running.

Console emits aggregate `[hosting-cleanup] plan`, `removed` and `result` records with stage names, allocated bytes, retained/deleted counts and reclaimed bytes. No environment contents or customer records are printed. Hosting quota percentage must be checked in the actual panel after it refreshes; allocated file bytes are not an assertion about the provider's quota accounting.

On each managed restart and at most once per hour while the bots run, old stages are bounded again. The hourly check holds the same exclusive supervisor lock and does not stop the bots, allowing recent stages to age out after24hours without requiring another deployment. Recovery retention and runtime guards remain unchanged. Actual cleanup/deployment evidence is kept in the project's `.project-memory/ACTIVE.md`.
