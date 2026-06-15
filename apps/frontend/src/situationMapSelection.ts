import type { MapFirstSituation } from "@nytt/shared";

export interface SituationSelectionResult {
  selectedSituation?: MapFirstSituation;
  selectionMissing: boolean;
}

export function resolveSelectedSituation(
  situations: MapFirstSituation[],
  selectedSituationId?: string,
): SituationSelectionResult {
  if (!selectedSituationId) {
    return { selectedSituation: situations[0], selectionMissing: false };
  }
  const selectedSituation = situations.find((situation) => situation.id === selectedSituationId);
  return {
    selectedSituation,
    selectionMissing: selectedSituation === undefined,
  };
}
