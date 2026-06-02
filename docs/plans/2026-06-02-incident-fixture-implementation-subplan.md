# Incident Correctness Fixture Implementation Subplan

Parent plan: `docs/plans/2026-06-02-incident-correctness-fixtures.md`

This is the repo-local Task 17 execution split. The goal is to prove the highest-risk incident false-positive and false-negative cases without mixing unrelated fixes into one change.

## 17A — clusters/classify adversarial fixtures

Scope:
- `apps/worker/test/fixtures/incident-fixtures.ts`
- `apps/worker/test/classify.test.ts`
- `apps/worker/test/clusters.test.ts`
- `apps/worker/src/classify.ts`
- `apps/worker/src/clusters.ts`

Fixtures covered:
- Same place, different event must not merge.
- Same event with explicit local place aliases must merge.
- Broad Trondheim-only mentions must not activate a situation.
- MET/NVE warnings without article confirmation must not activate.
- MET warnings may attach as context to reported incidents without changing activation basis.
- High-impact official DATEX traffic may activate without articles.
- Low-impact planned DATEX remains non-promoted.
- Later real event after dismissed false positive must open a fresh case.

Verification:
```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm test -- apps/worker/test/classify.test.ts apps/worker/test/clusters.test.ts
npm test -- apps/worker/test/datex.test.ts -t "low-impact planned roadworks"
npm run typecheck
```

Commit:
- `7aa0826 test: add incident correctness fixture builders`
- `7e6ac8b test: harden situation activation adversarial fixtures`

## 17B — Politiloggen active/inactive lifecycle

Scope:
- `apps/worker/test/politiloggen.test.ts`
- `apps/worker/src/politiloggen.ts` only if the lifecycle fixture fails.

Fixture covered:
- Inactive Politiloggen threads without an existing situation do not create new active situations.
- Existing Politiloggen situations become resolved when the upstream thread becomes inactive.
- Resolution remains traceable through official timeline evidence.

Verification:
```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm test -- apps/worker/test/politiloggen.test.ts
npm run typecheck
```

Commit:
- `d28798d test: cover politiloggen inactive lifecycle`

## Final gate for Task 17

Run from the repo root before marking Task 17 complete:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm test -- apps/worker/test/classify.test.ts apps/worker/test/clusters.test.ts apps/worker/test/politiloggen.test.ts
npm test -- apps/worker/test/datex.test.ts -t "low-impact planned roadworks"
npm run typecheck
npm run lint
npm run format:check
```

Do not claim CI/deploy/live verification in Task 17. That belongs to Task 23 after merge/push.
