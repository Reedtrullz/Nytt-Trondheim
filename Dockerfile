FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN npm ci --omit=dev --workspace @nytt/shared --workspace @nytt/server --workspace @nytt/worker
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/src/db/schema.sql apps/server/dist/db/schema.sql
COPY --from=build /app/apps/worker/dist apps/worker/dist
RUN chown -R node:node /app
USER node

FROM runtime-base AS api
COPY --from=build /app/apps/frontend/dist apps/frontend/dist
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:8080/health || exit 1
CMD ["node", "apps/server/dist/index.js"]

FROM runtime-base AS worker
HEALTHCHECK --interval=60s --timeout=10s --start-period=5m --retries=3 CMD node -e "const pg=require('pg'); const client=new pg.Client({connectionString:process.env.DATABASE_URL}); client.connect().then(()=>client.query(\"SELECT 1 FROM worker_cycle_metrics WHERE id='latest' AND cycle_completed_at > now() - interval '2 hours'\" )).then((result)=>process.exit(result.rowCount>0?0:1)).catch(()=>process.exit(1)).finally(()=>client.end().catch(()=>{}));"
CMD ["node", "apps/worker/dist/index.js"]
