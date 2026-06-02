import { describe, expect, it } from "vitest";
import type { SituationExplanation } from "../src/types.js";

describe("SituationExplanation", () => {
  it("serializes the decision model without losing source roles", () => {
    const explanation = {
      createdBecause: ["To uavhengige kilder rapporterte samme hendelse."],
      sourceRoles: [
        { provider: "nrk", role: "evidence" },
        { provider: "met", role: "context" },
        { provider: "datex_travel_time", role: "telemetry" },
        { provider: "deepseek", role: "private" },
      ],
      locationConfidence: "mixed",
      dismissalReason: "false_positive",
    } satisfies SituationExplanation;

    expect(JSON.parse(JSON.stringify(explanation))).toEqual(explanation);
  });
});
