import { describe, it, expect } from "vitest";
import { isTeamEmail } from "../../src/lib/auth-domain";

describe("isTeamEmail — dataset-switch gate", () => {
  it("unlocks internal team domains (actioneer.com + gameramp.com)", () => {
    expect(isTeamEmail("divyansh@actioneer.com")).toBe(true);
    expect(isTeamEmail("TAHA@Actioneer.com")).toBe(true); // case-insensitive
    expect(isTeamEmail("  vivek@actioneer.com  ")).toBe(true); // trims
    expect(isTeamEmail("vimarsh@gameramp.com")).toBe(true); // same team/dev domain
  });

  it("locks every other domain, including personal + customer", () => {
    expect(isTeamEmail("someone@gmail.com")).toBe(false);
    expect(isTeamEmail("buyer@flipkart.com")).toBe(false);
    expect(isTeamEmail("ops@hdfc.com")).toBe(false);
  });

  it("does not match look-alike / spoofed domains", () => {
    expect(isTeamEmail("x@actioneer.com.evil.com")).toBe(false);
    expect(isTeamEmail("x@notactioneer.com")).toBe(false);
    expect(isTeamEmail("x@actioneer.co")).toBe(false);
    expect(isTeamEmail("x@gameramp.com.evil.com")).toBe(false);
  });

  it("handles missing email safely (treated as locked)", () => {
    expect(isTeamEmail("")).toBe(false);
    expect(isTeamEmail(null)).toBe(false);
    expect(isTeamEmail(undefined)).toBe(false);
  });
});
