# Deployment

The repository follows the RFMC release pattern:

1. Pull requests and pushes to `main` run `CI`: typecheck, lint/format checks, tests, browser checks, production build, audit and Docker builds.
2. When repository variable `NYTT_DEPLOY_ENABLED=true` is configured, a successful `CI` workflow on `main` triggers `Deploy to VPS`; manual dispatch remains available for an intentional first release.
3. GitHub Actions connects to the VPS as `deploy` and runs `ansible-playbook.yml`.
4. Ansible updates the checkout, builds Docker images, starts PostGIS, backs up before migrations, applies migrations, health-checks a canary API container, promotes API/worker, configures Caddy and verifies `https://nytt.reidar.tech/health`.

## Production Services

`docker-compose.yml` runs:

- `postgres`: private PostGIS storage volume.
- `migrate`: one-shot schema migration image.
- `app`: authenticated API and built web interface, exposed only on VPS localhost for Caddy.
- `worker`: scheduled ingestion and analysis process.

## Backups

Ansible installs a nightly `nytt-backup.timer` and weekly `nytt-restore-check.timer`. Database dumps and uploaded files are encrypted offsite with restic. Configure repository and S3-compatible credentials in GitHub deployment secrets before first production deployment.

## First Deployment Prerequisites

- Create the GitHub OAuth application with callback `https://nytt.reidar.tech/auth/github/callback`.
- Add the listed repository secrets.
- After the first manual release succeeds, set repository variable `NYTT_DEPLOY_ENABLED=true` to permit automatic promotions from `main`.
- Confirm DNS for `nytt.reidar.tech` resolves to the VPS.
- Confirm Docker, Caddy and the `deploy` SSH key are available on the same VPS used by RFMC.
- Register DATEX access later if traffic-event enrichment is required.
