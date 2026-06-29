# Security

- Owner access is restricted through GitHub App user authorization and the `GITHUB_ALLOWED_LOGIN=Reedtrullz` allowlist. Non-GitHub users can request restricted-beta access, verify email, wait for owner approval, and then log in with one-time email links as read-only `viewer` users.
- Viewer users can read the main news, situation, traffic and weather surfaces. Owner-only APIs still protect Drift/operations, saved items, source audit/source linking, private workspace mutations, notes, drawings, attachments and exports. The route-planner API is authenticated; free-text origin/destination queries are sent server-side to Nominatim/OpenStreetMap and OSRM only for transient geocoding/routing and are not persisted by Nytt.
- Secrets are supplied through GitHub Actions/VPS-managed environment files and must never be committed.
- Uploaded files are stored outside the web root, size-limited, and checksum-recorded.
- State-changing authenticated API requests require a CSRF token and same-origin browser requests. Viewer sessions are rejected before owner-only mutations.
- Public access-request submissions and email-login requests are same-origin checked, rate-limited and validated server-side. Access requests, users, identities and hashed auth tokens are administrative application data outside the source/evidence ledger.
- GitHub App user authorization uses a session-backed state nonce without OAuth scopes; the app permission model governs its user token, and logout requires the same CSRF protection.
- Email auth stores only SHA-256 token hashes in `auth_tokens`; raw verification, invite and login tokens are sent only through email links. Production must configure SMTP so restricted-beta login cannot silently depend on console delivery.
- Production responses set a Content Security Policy permitting only application assets plus the configured Kartverket and DSB map image hosts.
- Private workspace content is excluded from AI processing.
- The exported workspace package is authenticated, persisted for protected re-download, sanitizes attachment paths and includes a checksum manifest; handle it as confidential.

## Secrets Required For Deployment

`SSH_PRIVATE_KEY`, `NYTT_REPO_DEPLOY_KEY`, `NYTT_POSTGRES_PASSWORD`, `NYTT_SESSION_SECRET`, `NYTT_GITHUB_CLIENT_ID`, `NYTT_GITHUB_CLIENT_SECRET`, `NYTT_SMTP_HOST`, `NYTT_SMTP_FROM`, `NYTT_DEEPSEEK_API_KEY`, `NYTT_DATEX_USERNAME`, `NYTT_DATEX_PASSWORD`, `NYTT_RESTIC_REPOSITORY`, `NYTT_RESTIC_PASSWORD`, and `NYTT_RCLONE_CONFIG`.

Optional: `NYTT_SMTP_PORT`, `NYTT_SMTP_SECURE`, `NYTT_SMTP_USER`, `NYTT_SMTP_PASSWORD`, `NYTT_DATEX_ENDPOINT`; repository variables `NYTT_POLITILOGGEN_ENABLED` and `NYTT_DEPLOY_ENABLED`.

DATEX credentials are server-side worker secrets only. They are stored as GitHub Actions repository secrets (`NYTT_DATEX_USERNAME`, `NYTT_DATEX_PASSWORD`), mapped to container runtime variables (`DATEX_USERNAME`, `DATEX_PASSWORD`) by the deploy workflow/playbook, and must never be exposed to the frontend bundle, logs, raw fixtures, screenshots, exported workspaces, or local shell history. The default DATEX endpoint is SRTI-filtered (`GetSituation/pullsnapshotdata?srti=True`) so the worker does not poll the full national snapshot unless `NYTT_DATEX_ENDPOINT` is intentionally overridden. Changing DATEX GitHub secrets requires a new deployment before the running worker sees them.

## Known External Issue

During planning, another local repository (`/Users/reidar/Documents/Lobster/Ine-bot`) exposed a GitHub token inside its `origin` remote URL. Revoke/rotate that token and replace that remote with a credential-free HTTPS URL independently of this application.
