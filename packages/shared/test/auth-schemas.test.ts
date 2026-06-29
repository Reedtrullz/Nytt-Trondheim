import { describe, expect, it } from "vitest";
import {
  accessRequestDecisionSchema,
  accessRequestInputSchema,
  emailLoginRequestSchema,
  userUpdateSchema,
} from "../src/schemas.js";

describe("restricted-beta auth schemas", () => {
  it("normalizes access request email and strips empty optional fields", () => {
    expect(
      accessRequestInputSchema.parse({
        displayName: " Ine Test ",
        email: "INE@Example.TEST ",
        message: "",
      }),
    ).toEqual({
      displayName: "Ine Test",
      email: "ine@example.test",
    });
  });

  it("rejects token fields in public request bodies", () => {
    expect(() =>
      accessRequestInputSchema.parse({
        displayName: "Ine Test",
        email: "ine@example.test",
        token: "raw-token",
      }),
    ).toThrow();
    expect(() =>
      emailLoginRequestSchema.parse({
        email: "ine@example.test",
        token: "raw-token",
      }),
    ).toThrow();
  });

  it("accepts owner approve/reject decisions only", () => {
    expect(accessRequestDecisionSchema.parse({ status: "approved" })).toEqual({
      status: "approved",
    });
    expect(accessRequestDecisionSchema.parse({ status: "rejected", reviewerNote: " " })).toEqual({
      status: "rejected",
    });
    expect(() => accessRequestDecisionSchema.parse({ status: "pending" })).toThrow();
  });

  it("requires user updates to change status or resend an invite", () => {
    expect(userUpdateSchema.parse({ status: "revoked" })).toEqual({ status: "revoked" });
    expect(userUpdateSchema.parse({ resendInvite: true })).toEqual({ resendInvite: true });
    expect(() => userUpdateSchema.parse({})).toThrow();
  });
});
