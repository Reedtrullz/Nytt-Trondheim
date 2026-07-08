import { describe, expect, it } from "vitest";
import {
  optionalTrafficMapFlagFromKey,
  optionalTrafficMapFlagKey,
} from "./useTrafficMap.js";

describe("useTrafficMap optional flag keys", () => {
  it("preserves omitted include flags as undefined instead of false", () => {
    expect(optionalTrafficMapFlagKey(undefined)).toBe("undefined");
    expect(optionalTrafficMapFlagFromKey("undefined")).toBeUndefined();
  });

  it("round-trips explicit boolean include flags", () => {
    expect(optionalTrafficMapFlagKey(false)).toBe("false");
    expect(optionalTrafficMapFlagFromKey("false")).toBe(false);
    expect(optionalTrafficMapFlagKey(true)).toBe("true");
    expect(optionalTrafficMapFlagFromKey("true")).toBe(true);
  });
});
