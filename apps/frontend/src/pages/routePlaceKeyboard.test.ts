import { describe, expect, it } from "vitest";
import { nextSuggestionIndex } from "./routePlaceKeyboard.js";

describe("nextSuggestionIndex", () => {
  it("moves down and wraps at the end", () => {
    expect(nextSuggestionIndex(-1, 3, "ArrowDown").index).toBe(0);
    expect(nextSuggestionIndex(2, 3, "ArrowDown").index).toBe(0);
  });

  it("moves up and wraps past the start", () => {
    expect(nextSuggestionIndex(0, 3, "ArrowUp").index).toBe(2);
    expect(nextSuggestionIndex(1, 3, "ArrowUp").index).toBe(0);
  });

  it("selects the active suggestion on Enter", () => {
    const result = nextSuggestionIndex(1, 3, "Enter");
    expect(result.select).toBe(true);
    expect(result.index).toBe(1);
  });

  it("ignores Enter when nothing is active", () => {
    const result = nextSuggestionIndex(-1, 3, "Enter");
    expect(result.select).toBe(false);
  });

  it("closes the list on Escape", () => {
    const result = nextSuggestionIndex(0, 3, "Escape");
    expect(result.close).toBe(true);
    expect(result.index).toBe(-1);
  });

  it("is inert with no suggestions", () => {
    const result = nextSuggestionIndex(-1, 0, "ArrowDown");
    expect(result.index).toBe(-1);
    expect(result.select).toBe(false);
    expect(result.close).toBe(false);
  });
});
