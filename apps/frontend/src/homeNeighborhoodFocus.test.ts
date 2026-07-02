import { describe, expect, it } from "vitest";
import {
  homeNeighborhoodFocusOptionForQuery,
  parseHomeNeighborhoodFocusId,
} from "./homeNeighborhoodFocus.js";

describe("home neighborhood focus", () => {
  it("resolves known Trondheim postcodes to a local focus option", () => {
    expect(homeNeighborhoodFocusOptionForQuery("7041")?.label).toBe("Lade");
    expect(homeNeighborhoodFocusOptionForQuery("7030")?.label).toBe("Elgeseter");
    expect(homeNeighborhoodFocusOptionForQuery("7050")?.label).toBe("Moholt");
    expect(homeNeighborhoodFocusOptionForQuery("7088")?.label).toBe("Heimdal");
  });

  it("resolves place labels and ascii aliases", () => {
    expect(homeNeighborhoodFocusOptionForQuery("trondheim sentrum")?.id).toBe("midtbyen");
    expect(homeNeighborhoodFocusOptionForQuery("byasen")?.label).toBe("Byåsen");
    expect(homeNeighborhoodFocusOptionForQuery("Flatåsen")?.id).toBe("flatasen");
    expect(homeNeighborhoodFocusOptionForQuery("Møllenberg")?.id).toBe("mollenberg");
    expect(homeNeighborhoodFocusOptionForQuery("gloshaugen")?.id).toBe("elgeseter");
    expect(homeNeighborhoodFocusOptionForQuery("Valentinlyst")?.id).toBe("strindheim");
  });

  it("rejects unknown persisted ids and local focus queries", () => {
    expect(parseHomeNeighborhoodFocusId("ukjent")).toBeUndefined();
    expect(homeNeighborhoodFocusOptionForQuery("9999")).toBeUndefined();
  });
});
