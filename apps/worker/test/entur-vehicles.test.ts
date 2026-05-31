import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { enturHeaders, parseEnturVehicles } from "../src/enturVehicles.js";

const fixturePath = new URL("./fixtures/entur-vehicles-atb.json", import.meta.url);

describe("Entur vehicle positions", () => {
  it("identifies Entur requests with ET-Client-Name", () => {
    expect(enturHeaders("reidar-nytt-trondheim")).toMatchObject({
      "Content-Type": "application/json",
      "ET-Client-Name": "reidar-nytt-trondheim",
    });
  });

  it("normalizes ATB vehicles into public transport vehicle rows", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseEnturVehicles(payload, { codespaceId: "ATB" });

    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).toMatchObject({
      id: "entur-vehicle:ATB:8790",
      source: "entur_vehicle_positions",
      codespaceId: "ATB",
      vehicleId: "8790",
      mode: "bus",
      publicCode: "45",
      destinationName: "Hagen",
      delaySeconds: 59,
      geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
      stale: false,
    });
    expect(result.activeVehicleIds).toEqual(["8790"]);
  });

  it("skips vehicles with missing id or invalid coordinates", () => {
    const result = parseEnturVehicles(
      JSON.stringify({
        data: {
          vehicles: [
            { vehicleId: "", location: { latitude: 63.4, longitude: 10.4 } },
            { vehicleId: "bad", location: { latitude: 200, longitude: 10.4 } },
          ],
        },
      }),
      { codespaceId: "ATB" },
    );

    expect(result.vehicles).toEqual([]);
  });
});
