/**
 * Unit coverage for the prospect-provisioning admin panel's pure logic:
 * login-email derivation, demo password format, magic-link construction, the
 * admin allowlist, the prospect dataset-restriction gating, and the invite
 * email render. No Clerk / SendGrid / DB I/O is exercised here.
 */
import { describe, it, expect } from "vitest";

import {
  companyLoginEmail,
  generateDemoPassword,
  buildMagicLink,
} from "@/lib/server/provision-utils";
import { isAdminEmail, ADMIN_EMAILS } from "@/lib/admin-allowlist";
import { getAllDatasetsForUser } from "@/lib/datasets";
import { renderInviteEmail } from "@/lib/server/invite-email";

describe("companyLoginEmail", () => {
  it("slugs a company into an analysis+tag@actioneer.com login", () => {
    expect(companyLoginEmail("Acme Corp")).toBe("analysis+acmecorp@actioneer.com");
    expect(companyLoginEmail("Yes Bank!")).toBe("analysis+yesbank@actioneer.com");
    expect(companyLoginEmail("HDFC-Life")).toBe("analysis+hdfclife@actioneer.com");
  });

  it("falls back to a safe tag when the name has no alphanumerics", () => {
    expect(companyLoginEmail("***")).toBe("analysis+prospect@actioneer.com");
  });
});

describe("generateDemoPassword", () => {
  it("produces a professional grouped alphanumeric password", () => {
    const pw = generateDemoPassword(() => 0);
    expect(pw).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  });

  it("avoids ambiguous characters (0/O/1/l/I)", () => {
    const joined = Array.from({ length: 50 }, () => generateDemoPassword()).join("");
    expect(joined).not.toMatch(/[0O1lI]/);
  });

  it("is unguessably varied across calls", () => {
    const set = new Set(Array.from({ length: 20 }, () => generateDemoPassword()));
    expect(set.size).toBeGreaterThan(1);
  });
});

describe("buildMagicLink", () => {
  it("builds the consume URL and encodes the ticket, with no double slash", () => {
    expect(buildMagicLink("https://demo.actioneer.com/", "abc 123")).toBe(
      "https://demo.actioneer.com/auth/agent-consume?ticket=abc%20123",
    );
  });
});

describe("isAdminEmail", () => {
  it("allows the six internal names on both work domains, case-insensitively", () => {
    expect(ADMIN_EMAILS).toHaveLength(12); // 6 names × 2 domains
    expect(isAdminEmail("TAHA@actioneer.com")).toBe(true);
    expect(isAdminEmail("divyansh@actioneer.com")).toBe(true);
    expect(isAdminEmail("divyansh@gameramp.com")).toBe(true);
    expect(isAdminEmail("Taha@gameramp.com")).toBe(true);
  });

  it("denies everyone else, plus null/empty", () => {
    expect(isAdminEmail("prospect@company.com")).toBe(false);
    expect(isAdminEmail("analysis+acme@actioneer.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });
});

describe("getAllDatasetsForUser — prospect restriction", () => {
  const uid = "user_test";

  it("shows ONLY the selected industry when restrictToSelected is true", () => {
    const ds = getAllDatasetsForUser(uid, ["presto"], true);
    const ids = ds.map((d) => d.id);
    expect(ids).toContain("presto");
    expect(ids).not.toContain("vastu-hfc");
    expect(ids.every((id) => id === "presto")).toBe(true);
  });

  it("shows all static samples when not restricted (existing behavior)", () => {
    const ids = getAllDatasetsForUser(uid, ["presto"], false).map((d) => d.id);
    for (const id of ["presto", "vastu-hfc", "fundsindia", "quickhelp", "healthians"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("renderInviteEmail", () => {
  const input = {
    championName: "Priya Sharma",
    dealOwnerName: "Taha",
    senderName: "Divyansh",
    loginEmail: "analysis+acme@actioneer.com",
    password: "Harbor-Falcon-3947",
    magicLink: "https://demo.actioneer.com/auth/agent-consume?ticket=abc123",
  };

  it("greets by first name and includes the owner, creds and magic link", async () => {
    const { html, text, subject } = await renderInviteEmail(input);
    expect(subject).toBe("Actioneer Demo Workspace Creds");
    // HTML splits interpolated values with React comment nodes, so assert on the
    // standalone tokens; the plain-text version keeps the greeting intact.
    for (const needle of [
      "Priya",
      "Taha",
      "analysis+acme@actioneer.com",
      "Harbor-Falcon-3947",
      "ticket=abc123",
      "Divyansh",
    ]) {
      expect(html).toContain(needle);
      expect(text).toContain(needle);
    }
    expect(text).toContain("Hi Priya");
  });

  it("contains no em-dashes or en-dashes (house style)", async () => {
    const { html, text } = await renderInviteEmail(input);
    expect(html).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/[–—]/);
  });
});
