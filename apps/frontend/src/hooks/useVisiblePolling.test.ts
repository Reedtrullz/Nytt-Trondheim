import { describe, expect, it } from "vitest";
import { shouldPollWhenVisible } from "./useVisiblePolling.js";

describe("visible polling", () => {
  it("polls only when enabled and the document is visible", () => {
    expect(shouldPollWhenVisible({ enabled: true, hidden: false })).toBe(true);
    expect(shouldPollWhenVisible({ enabled: true, hidden: true })).toBe(false);
    expect(shouldPollWhenVisible({ enabled: false, hidden: false })).toBe(false);
  });
});
