# Security

- Production access is restricted through GitHub OAuth and the `GITHUB_ALLOWED_LOGIN=Reedtrullz` allowlist.
- All `/api` data, notes, drawings, attachments and exports require an authenticated owner session.
- Secrets are supplied through GitHub Actions/VPS-managed environment files and must never be committed.
- Uploaded files are stored outside the web root, size-limited, and checksum-recorded.
- Private workspace content is excluded from AI processing.
- The exported workspace package is authenticated and includes private information; handle it as confidential.

## Secrets Required For Deployment

`SSH_PRIVATE_KEY`, `NYTT_POSTGRES_PASSWORD`, `NYTT_SESSION_SECRET`, `NYTT_GITHUB_CLIENT_ID`, `NYTT_GITHUB_CLIENT_SECRET`, `NYTT_OPENAI_API_KEY`, `NYTT_RESTIC_REPOSITORY`, `NYTT_RESTIC_PASSWORD`, `NYTT_BACKUP_ACCESS_KEY`, and `NYTT_BACKUP_SECRET_KEY`.

Optional: `NYTT_DATEX_ENDPOINT`, `NYTT_DATEX_API_KEY`; repository variables `NYTT_POLITILOGGEN_ENABLED` and `NYTT_DEPLOY_ENABLED`.

## Known External Issue

During planning, another local repository (`/Users/reidar/Documents/Lobster/Ine-bot`) exposed a GitHub token inside its `origin` remote URL. Revoke/rotate that token and replace that remote with a credential-free HTTPS URL independently of this application.
