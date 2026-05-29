import { describe, expect, it } from "vitest";
import { situationTimeMeta } from "./situationTime.js";

describe("situation time metadata", () => {
  it("shows both the original incident time and the last updated time", () => {
    expect(
      situationTimeMeta({
        createdAt: "2026-05-29T08:05:00.000Z",
        updatedAt: "2026-05-29T10:30:00.000Z",
      }),
    ).toBe("Hendelsen startet 29. mai 2026, 10:05 · Oppdatert 29. mai 2026, 12:30");
  });
});
