FROM nytt-trondheim-build:test AS baseline-build
COPY scripts/perf/baseline/export.ts /app/apps/server/src/export.ts
COPY scripts/perf/export-baseline.tsconfig.json /app/apps/server/export-baseline.tsconfig.json
COPY scripts/perf/export-baseline-compile.mjs /baseline/compile.mjs
WORKDIR /app/apps/server
RUN --network=none node /baseline/compile.mjs

FROM scratch AS baseline-evidence
COPY --from=baseline-build /baseline/production-export.js /export.before.js
COPY --from=baseline-build /baseline/compiler.json /compiler.json

FROM nytt-trondheim-api:test AS baseline-runtime
COPY --from=baseline-build /app/apps/server/dist/export.js /app/apps/server/dist/export.baseline.js
COPY --from=baseline-build /baseline/compiler.json /app/apps/server/dist/export.baseline.compiler.json
