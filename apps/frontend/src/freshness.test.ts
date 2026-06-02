import { describe, expect, it } from "vitest";
import { headerFreshnessLabel } from "./freshness.js";

const now = new Date("2026-05-31T12:20:00+02:00");

describe("header freshness label", () => {
  it("shows Oppdatert HH:MM when the newest source check is fresh", () => {
    expect(
      headerFreshnessLabel(
        [
          {
            source: "nrk",
            label: "NRK",
            state: "ok",
            detail: "RSS",
            lastCheckedAt: "2026-05-31T12:08:00+02:00",
          },
          {
            source: "adressa",
            label: "Adresseavisen",
            state: "ok",
            detail: "RSS",
            lastCheckedAt: "2026-05-31T11:40:00+02:00",
          },
        ],
        now,
      ),
    ).toBe("Oppdatert 12:08");
  });

  it("shows Sist oppdatert HH:MM when the newest source check is stale", () => {
    expect(
      headerFreshnessLabel(
        [
          {
            source: "nrk",
            label: "NRK",
            state: "ok",
            detail: "RSS",
            lastCheckedAt: "2026-05-31T11:59:00+02:00",
          },
        ],
        now,
      ),
    ).toBe("Sist oppdatert 11:59");
  });

  it("shows degraded copy when any checked source is non-OK", () => {
    expect(
      headerFreshnessLabel(
        [
          {
            source: "nrk",
            label: "NRK",
            state: "ok",
            detail: "RSS",
            lastCheckedAt: "2026-05-31T12:08:00+02:00",
          },
          {
            source: "datex",
            label: "DATEX",
            state: "awaiting_access",
            detail: "Mangler tilgang",
            lastCheckedAt: "2026-05-31T12:07:00+02:00",
          },
        ],
        now,
      ),
    ).toBe("Delvis oppdatert 12:08 · 1 kilde trenger tilsyn");
  });

  it("shows source-state warning when no non-OK source has a valid timestamp", () => {
    expect(
      headerFreshnessLabel([{ source: "nrk", label: "NRK", state: "disabled", detail: "Av" }], now),
    ).toBe("Kildeavvik: 1 kilde trenger tilsyn");
  });
});
