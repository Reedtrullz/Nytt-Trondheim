export type RouteSuggestionKey = "ArrowDown" | "ArrowUp" | "Enter" | "Escape";

/**
 * Pure combobox navigation state machine for the route place input.
 * Returns the next active suggestion index, or -1 when no option is active.
 */
export function nextSuggestionIndex(
  current: number,
  count: number,
  key: RouteSuggestionKey,
): { index: number; select: boolean; close: boolean } {
  if (count <= 0) return { index: -1, select: false, close: false };
  switch (key) {
    case "ArrowDown":
      return { index: (current + 1) % count, select: false, close: false };
    case "ArrowUp":
      return { index: (current - 1 + count) % count, select: false, close: false };
    case "Enter": {
      if (current < 0 || current >= count) return { index: current, select: false, close: false };
      return { index: current, select: true, close: false };
    }
    case "Escape":
      return { index: -1, select: false, close: true };
  }
}
