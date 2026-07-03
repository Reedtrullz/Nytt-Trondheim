import type { Situation } from "./types.js";

export type SituationPublicVisibility = NonNullable<Situation["publicVisibility"]>;

export const defaultSituationPublicVisibility = "public" satisfies SituationPublicVisibility;

export function situationPublicVisibility(
  situation: Pick<Situation, "publicVisibility">,
): SituationPublicVisibility {
  return situation.publicVisibility ?? defaultSituationPublicVisibility;
}

export function isPublicSituation(situation: Pick<Situation, "publicVisibility">): boolean {
  return situationPublicVisibility(situation) === "public";
}
