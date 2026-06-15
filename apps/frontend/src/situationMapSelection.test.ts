import type { MapFirstSituation } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { resolveSelectedSituation } from "./situationMapSelection.js";

const situation = {
  id: "skogbrann-bymarka",
  title: "Skogbrann i Bymarka",
} as MapFirstSituation;

describe("situation map selection", () => {
  it("uses the first situation only when the URL has no explicit selection", () => {
    expect(resolveSelectedSituation([situation]).selectedSituation?.id).toBe("skogbrann-bymarka");
  });

  it("does not silently fall back when the selected URL id is filtered out", () => {
    expect(resolveSelectedSituation([situation], "missing-id")).toEqual({
      selectedSituation: undefined,
      selectionMissing: true,
    });
  });
});
