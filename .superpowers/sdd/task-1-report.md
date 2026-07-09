# Task 1 Report — Pure Traveller Answer Model

## Scope

- Branch: `codex/trafikk-traveller-ui-polish`
- Repo: `/Users/reidar/Projectos/Nytt`
- Owned files only:
  - `apps/frontend/src/pages/trafficJourneyView.ts`
  - `apps/frontend/src/pages/trafficJourneyView.test.ts`

## Requirements handled

- Added pure TypeScript traveller-answer model exports in `trafficJourneyView.ts`.
- Kept work inside the existing frontend page model/test surface only.
- Preserved existing answer/context behavior while adding:
  - `JourneyStepView`
  - `JourneyMapSummaryView`
  - `JourneyTravellerAnswerView`
  - `buildJourneyTravellerAnswer(...)`
- Kept traveller copy Bokmål and operator authority with AtB/Entur handoff.
- Did not add persisted evidence/source models or touch server/CSS/e2e/other frontend files.

## TDD Evidence

### RED

Command:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts
```

Observed failure:

- 4 tests failed
- Failure reason: `buildJourneyTravellerAnswer is not a function`
- This matched the expected missing-export/missing-model state before implementation

### GREEN

Command:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts
```

Observed result:

- `apps/frontend/src/pages/trafficJourneyView.test.ts` passed
- 12 tests passed, 0 failed

## Implementation summary

- Added traveller-model types for steps, map summary, and compact context text items.
- Added itinerary/walking-route step builders from existing `TravelPlan*` inputs.
- Added `buildJourneyTravellerAnswer(...)` as a pure adapter over the existing answer/context helpers.
- Kept map-point traffic out of `context.primaryTextItems`, limiting that list to non-map line alerts.
- Matched brief-specific primary meta formatting:
  - transit: time range + duration + transfer label
  - walking fallback: duration + distance

## Notes

- Existing `buildJourneyAnswerView(...)` still retains its prior meta/detail behavior for current callers.
- The new traveller model narrows presentation for the traveller-first `/trafikk` polish without changing persistence or source semantics.

## Verification

- Disk hygiene check: `df -h /System/Volumes/Data` showed 69 GiB available before test work.
- Verification used Node `v22.22.3`.

## 2026-07-09 Reviewer follow-up

### Fix scope

- Preserved mixed-context disclosure behavior where line alerts can remain the primary traveller disclosure label.
- Fixed map-only traveller context so route-adjacent traffic points still disclose as `kartpunkt`.
- Fixed traveller steps so cancelled ride legs surface as warning steps instead of disappearing.

### TDD Evidence

#### RED

Command:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts
```

Observed failures:

- `discloses map-only traffic context when no line alerts exist`
  - expected `1 kartpunkt`
  - received `Ingen kjente hindringer`
- `keeps cancelled ride legs as warning steps in traveller answers`
  - cancelled ride step was missing from `answer.steps`

#### GREEN

Command:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts
```

Observed result:

- `apps/frontend/src/pages/trafficJourneyView.test.ts` passed
- 14 tests passed, 0 failed

## 2026-07-09 Task 1 takeover follow-up

### Fix scope

- Fixed `buildJourneyTravellerAnswer(...)` precedence so a selected concrete walk-only Entur itinerary keeps its own traveller steps and itinerary-style primary meta even when `plan.walkingRoute` is also present.
- Kept the change inside the traveller-answer adapter only; `buildJourneyAnswerView(...)` selection logic and fallback walking-route behavior were left intact.

### TDD Evidence

#### RED

Command:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts -t "prefers a concrete walk-only itinerary over walkingRoute fallback detail"
```

Observed failure:

- `prefers a concrete walk-only itinerary over walkingRoute fallback detail`
  - expected `11:10 → 11:28 · 18 min · Direkte`
  - received `43 min · 3,5 km`
- Failure confirmed the traveller adapter was taking `walkingRoutePrimaryMeta(plan)` before the selected walk-only itinerary branch.

#### GREEN

Command:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts
```

Observed result:

- `apps/frontend/src/pages/trafficJourneyView.test.ts` passed
- 15 tests passed, 0 failed

### Self-review

- Scope stayed bounded to the reported precedence bug plus its regression test in the owned frontend files.
- Edge behavior checked: fallback walking-route answers still use corridor meta/step only when there is no concrete walk-only itinerary selected; transit and handoff branches are unchanged.
