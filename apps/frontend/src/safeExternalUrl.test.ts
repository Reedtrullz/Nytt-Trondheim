import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./safeExternalUrl.js";

describe("safeExternalUrl", () => {
  it("allows http and https URLs", () => {
    expect(safeExternalUrl("https://example.test/a?b=1")).toBe("https://example.test/a?b=1");
    expect(safeExternalUrl("http://example.test/a")).toBe("http://example.test/a");
  });

  it("rejects browser-executable or local schemes", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeExternalUrl("file:///etc/passwd")).toBeUndefined();
  });

  it("rejects malformed or blank values", () => {
    expect(safeExternalUrl("not a url")).toBeUndefined();
    expect(safeExternalUrl("   ")).toBeUndefined();
    expect(safeExternalUrl(undefined)).toBeUndefined();
  });
});
