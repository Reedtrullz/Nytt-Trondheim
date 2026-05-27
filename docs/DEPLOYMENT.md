# Deployment

The repository follows the RFMC release pattern:

1. Pull requests and pushes to `main` run `CI`: typecheck, lint/format checks, tests, browser checks, production build, audit and Docker builds.
2. When repository variable `NYTT_DEPLOY_ENABLED=true` is configured, a successful `CI` workflow on `main` triggers `Deploy to VPS`; manual dispatch remains available for an intentional first release.
3. For a new or repaired origin, the manual `Provision Origin` workflow connects with the existing VPS key, installs the dedicated Actions key and repository-scoped read-only checkout key, and provisions the Caddy hostname.
4. GitHub Actions connects to the VPS as `deploy` and runs `ansible-playbook.yml`; the VPS uses its own repository-scoped read-only deploy key at `~/.ssh/nytt_github_deploy` to clone this private repository.
5. Ansible installs/configures restic first, verifies an encrypted pre-migration backup, builds Docker images, applies migrations, health-checks a canary API container, promotes API/worker, validates and reloads Caddy, then verifies `https://nytt.reidar.tech/health`.

The deploy workflow and playbook fail before changing application state if any required SSH, application, GitHub authentication, AI or backup secret is absent. Origin TLS is provisioned before the first application release because the new Caddy hostname must exist before Cloudflare can reach it.

## Production Services

`docker-compose.yml` runs:

- `postgres`: private PostGIS storage volume.
- `migrate`: one-shot schema migration image.
- `app`: authenticated API and built web interface, exposed only on VPS localhost for Caddy.
- `worker`: scheduled ingestion and analysis process.

PostgreSQL runs only on the internal `nytt_database` network. `app` and `worker` also join `nytt_outbound` so GitHub authorization, RSS, Kartverket, MET/NVE and DeepSeek requests can reach external services. The API remains bound only to VPS localhost for Caddy.

## Backups

Ansible installs a nightly `nytt-backup.timer` and weekly `nytt-restore-check.timer`. Database dumps and uploaded files are encrypted offsite with restic using its `rclone` backend to a dedicated Google Drive folder. Configure `NYTT_RESTIC_REPOSITORY`, `NYTT_RESTIC_PASSWORD` and the restricted Google Drive `NYTT_RCLONE_CONFIG` in GitHub deployment secrets before first production deployment.

## First Deployment Prerequisites

- Create a GitHub App with callback `https://nytt.reidar.tech/auth/github/callback`, generate a Client Secret, and configure its Client ID and Client Secret as `NYTT_GITHUB_CLIENT_ID` and `NYTT_GITHUB_CLIENT_SECRET`. The App ID and downloaded private key are not required for the user-login flow.
- Add the listed repository secrets, including `NYTT_REPO_DEPLOY_KEY` for the repository-scoped read-only checkout key.
- Authorize an `rclone` Google Drive remote for the dedicated encrypted backup folder and configure `NYTT_RESTIC_REPOSITORY=rclone:nytt_drive:nytt-trondheim/restic`.
- Run `Provision Origin` once using an already-authorized VPS SSH key; it installs the dedicated Actions and repository checkout keys and configures the Caddy hostname. After it succeeds, rotate `SSH_PRIVATE_KEY` to the dedicated Actions key.
- After the first manual release succeeds, set repository variable `NYTT_DEPLOY_ENABLED=true` to permit automatic promotions from `main`.
- Confirm DNS for `nytt.reidar.tech` resolves to the VPS.
- Run origin provisioning to repair TLS/Cloudflare routing before release; the endpoint returned HTTP `525` before the `nytt.reidar.tech` Caddy hostname existed.
- Confirm Docker, Caddy and the `deploy` SSH key are available on the same VPS used by RFMC.
- Register DATEX access later if traffic-event enrichment is required.

## Rollback

The deployment preserves the prior API and worker images as `:previous` before building candidates and does not promote containers if backup verification, migration or canary health fails. If post-promotion validation fails, re-tag `:previous` as `:latest`, restart `app` and `worker`, and restore the latest verified restic snapshot before attempting any incompatible migration recovery.

## Current Provisioning State

As inspected on May 27, 2026:

- GitHub Actions CI succeeds for `main`; automatic deployment remains disabled through `NYTT_DEPLOY_ENABLED=false`.
- The `Provision Origin` workflow succeeded; the repository-scoped read-only checkout key is installed and verified on the VPS, and GitHub Actions now connects using its dedicated deployment key.
- `NYTT_POSTGRES_PASSWORD` and `NYTT_SESSION_SECRET` are configured in GitHub Actions.
- The `nytt-trondheim` GitHub App credentials, DeepSeek API credential and restricted Google Drive/rclone backup target are configured.
- Caddy now serves valid TLS for `https://nytt.reidar.tech/health`; it returns HTTP `502` until the application is deployed to localhost port `8090`.
- The Nytt canary uses localhost port `8092`, avoiding the existing Hermes proposals service on `8091`.
