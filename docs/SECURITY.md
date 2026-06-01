# Security

- Production access is restricted through GitHub App user authorization and the `GITHUB_ALLOWED_LOGIN=Reedtrullz` allowlist.
- All `/api` data, notes, drawings, attachments and exports require an authenticated owner session. The route-planner API is also authenticated; free-text origin/destination queries are sent server-side to Nominatim/OpenStreetMap and OSRM only for transient geocoding/routing and are not persisted by Nytt.
- Secrets are supplied through GitHub Actions/VPS-managed environment files and must never be committed.
- Uploaded files are stored outside the web root, size-limited, and checksum-recorded.
- State-changing authenticated API requests require an owner-session CSRF token and same-origin browser requests.
- GitHub App user authorization uses a session-backed state nonce without OAuth scopes; the app permission model governs its user token, and logout requires the same CSRF protection.
- Production responses set a Content Security Policy permitting only application assets plus the configured Kartverket and DSB map image hosts.
- Private workspace content is excluded from AI processing.
- The exported workspace package is authenticated, persisted for protected re-download, sanitizes attachment paths and includes a checksum manifest; handle it as confidential.

## Secrets Required For Deployment

`SSH_PRIVATE_KEY`, `NYTT_REPO_DEPLOY_KEY`, `NYTT_POSTGRES_PASSWORD`, `NYTT_SESSION_SECRET`, `NYTT_GITHUB_CLIENT_ID`, `NYTT_GITHUB_CLIENT_SECRET`, `NYTT_DEEPSEEK_API_KEY`, `NYTT_DATEX_USERNAME`, `NYTT_DATEX_PASSWORD`, `NYTT_RESTIC_REPOSITORY`, `NYTT_RESTIC_PASSWORD`, and `NYTT_RCLONE_CONFIG`.

Optional: `NYTT_DATEX_ENDPOINT`; repository variables `NYTT_POLITILOGGEN_ENABLED` and `NYTT_DEPLOY_ENABLED`.

DATEX credentials are server-side worker secrets only. They are stored as GitHub Actions repository secrets (`NYTT_DATEX_USERNAME`, `NYTT_DATEX_PASSWORD`), mapped to container runtime variables (`DATEX_USERNAME`, `DATEX_PASSWORD`) by the deploy workflow/playbook, and must never be exposed to the frontend bundle, logs, raw fixtures, screenshots, exported workspaces, or local shell history. The default DATEX endpoint is SRTI-filtered (`GetSituation/pullsnapshotdata?srti=True`) so the worker does not poll the full national snapshot unless `NYTT_DATEX_ENDPOINT` is intentionally overridden. Changing DATEX GitHub secrets requires a new deployment before the running worker sees them.

## Known External Issue

During planning, another local repository (`/Users/reidar/Documents/Lobster/Ine-bot`) exposed a GitHub token inside its `origin` remote URL. Revoke/rotate that token and replace that remote with a credential-free HTTPS URL independently of this application.
