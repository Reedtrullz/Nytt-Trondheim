# Deployment

The repository follows the RFMC release pattern:

1. Pull requests and pushes to `main` run `CI`: typecheck, lint/format checks, tests, browser checks, production build, audit and Docker builds.
2. When repository variable `NYTT_DEPLOY_ENABLED=true` is configured, a successful `CI` workflow on `main` triggers `Deploy to VPS`; manual dispatch remains available for an intentional first release.
3. GitHub Actions connects to the VPS as `deploy` and runs `ansible-playbook.yml`; the VPS uses its own repository-scoped read-only deploy key at `~/.ssh/nytt_github_deploy` to clone this private repository.
4. Ansible installs/configures restic first, verifies an encrypted pre-migration backup, builds Docker images, applies migrations, health-checks a canary API container, promotes API/worker, validates and reloads Caddy, then verifies `https://nytt.reidar.tech/health`.

The deploy workflow and playbook fail before changing the VPS if any required SSH, application, OAuth, AI or backup secret is absent.

## Production Services

`docker-compose.yml` runs:

- `postgres`: private PostGIS storage volume.
- `migrate`: one-shot schema migration image.
- `app`: authenticated API and built web interface, exposed only on VPS localhost for Caddy.
- `worker`: scheduled ingestion and analysis process.

PostgreSQL runs only on the internal `nytt_database` network. `app` and `worker` also join `nytt_outbound` so OAuth, RSS, Kartverket, MET/NVE and OpenAI requests can reach external services. The API remains bound only to VPS localhost for Caddy.

## Backups

Ansible installs a nightly `nytt-backup.timer` and weekly `nytt-restore-check.timer`. Database dumps and uploaded files are encrypted offsite with restic. Configure repository and S3-compatible credentials in GitHub deployment secrets before first production deployment.

## First Deployment Prerequisites

- Create the GitHub OAuth application with callback `https://nytt.reidar.tech/auth/github/callback`.
- Add the listed repository secrets.
- Add a read-only GitHub deploy key for this private repository and install its private key as `/home/deploy/.ssh/nytt_github_deploy` on the VPS.
- After the first manual release succeeds, set repository variable `NYTT_DEPLOY_ENABLED=true` to permit automatic promotions from `main`.
- Confirm DNS for `nytt.reidar.tech` resolves to the VPS.
- Repair origin TLS/Cloudflare routing before release; the endpoint returned HTTP `525` during readiness inspection on May 26, 2026.
- Confirm Docker, Caddy and the `deploy` SSH key are available on the same VPS used by RFMC.
- Register DATEX access later if traffic-event enrichment is required.

## Rollback

The deployment preserves the prior API and worker images as `:previous` before building candidates and does not promote containers if backup verification, migration or canary health fails. If post-promotion validation fails, re-tag `:previous` as `:latest`, restart `app` and `worker`, and restore the latest verified restic snapshot before attempting any incompatible migration recovery.
