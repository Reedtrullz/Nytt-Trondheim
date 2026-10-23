FROM node:22-bookworm-slim AS build
WORKDIR /app
# pnpm comes from Corepack at the exact version pinned by package.json "packageManager".
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
# Self-contained production-only dependency trees for the server and worker
# (replaces `npm ci --omit=dev --workspace ...`). @nytt/shared, including its
# built dist, is copied into each node_modules. --legacy keeps the normal
# symlinked workspace links for development (pnpm 10 otherwise requires
# inject-workspace-packages for deploy).
RUN pnpm --filter @nytt/server deploy --prod --legacy /prod/server \
  && pnpm --filter @nytt/worker deploy --prod --legacy /prod/worker

FROM node:22-bookworm-slim AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /prod/server/package.json apps/server/package.json
COPY --from=build /prod/server/node_modules apps/server/node_modules
COPY --from=build /prod/worker/package.json apps/worker/package.json
COPY --from=build /prod/worker/node_modules apps/worker/node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/src/db/schema.sql apps/server/dist/db/schema.sql
COPY --from=build /app/apps/worker/dist apps/worker/dist
RUN chown -R node:node /app
USER node

FROM runtime-base AS api
COPY --from=build /app/apps/frontend/dist apps/frontend/dist
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:8080/health/live || exit 1
CMD ["node", "apps/server/dist/index.js"]

FROM runtime-base AS worker
# Run from the worker package so `require('pg')` in the healthchecks (here and in
# docker-compose.yml) resolves from apps/worker/node_modules.
WORKDIR /app/apps/worker
HEALTHCHECK --interval=60s --timeout=10s --start-period=5m --retries=3 CMD node -e "const pg=require('pg'); const client=new pg.Client({connectionString:process.env.DATABASE_URL}); client.connect().then(()=>client.query(\"SELECT 1 FROM worker_cycle_metrics WHERE id='latest' AND cycle_completed_at > now() - interval '2 hours'\" )).then((result)=>process.exit(result.rowCount>0?0:1)).catch(()=>process.exit(1)).finally(()=>client.end().catch(()=>{}));"
CMD ["node", "dist/index.js"]
