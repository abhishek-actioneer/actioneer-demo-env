import { describe, expect, it } from "vitest";
import { buildVoiceCampaignScriptPrompt } from "@/lib/prompts/voice-campaign";
import {
  buildCampaignBriefPurpose,
  resolveVoiceCampaignPurpose,
} from "@/lib/voice-campaign-purpose";
import type { Purpose } from "@/lib/purpose-types";

const topUpPurpose: Purpose = {
  purposeId: "VASTU_TOPUP",
  sku: "VASTU-TOPUP",
  name: "Existing Customer Top-Up Loan",
  category: "housing-finance",
  tagline: "Additional finance for trusted borrowers",
  description: "Top-up finance for eligible existing customers.",
  valueProp: "Existing relationship review",
  priceDisplay: "Eligibility and rate shared after review",
  cta: "Ask for an advisor callback",
};

describe("voice campaign purpose resolution", () => {
  it("turns a free-text use case into a brief-only purpose instead of using the first catalog item", () => {
    const brief = "Call borrowers with a bounced EMI to understand payment blockers and offer servicing help.";
    const resolved = resolveVoiceCampaignPurpose({
      purposes: [topUpPurpose],
      campaignBrief: brief,
    });

    expect(resolved.category).toBe("campaign-brief");
    expect(resolved.description).toBe(brief);
    expect(resolved.name).not.toContain("Top-Up");
  });

  it("uses stable, brief-specific IDs for generated purposes", () => {
    const first = buildCampaignBriefPurpose("Run an EMI servicing campaign.");
    const same = buildCampaignBriefPurpose("Run an EMI servicing campaign.");
    const different = buildCampaignBriefPurpose("Run a document collection campaign.");

    expect(first.purposeId).toBe(same.purposeId);
    expect(first.purposeId).not.toBe(different.purposeId);
  });

  it("uses an explicitly selected catalog purpose", () => {
    const resolved = resolveVoiceCampaignPurpose({
      purposeId: topUpPurpose.purposeId,
      purposes: [topUpPurpose],
      campaignBrief: "Discuss additional finance.",
    });

    expect(resolved).toBe(topUpPurpose);
  });

  it("uses an explicit inline custom purpose", () => {
    const custom = buildCampaignBriefPurpose("Help customers complete pending KYC.", {
      purposeId: "CUSTOM_KYC_HELP",
      name: "KYC completion help",
    });
    const resolved = resolveVoiceCampaignPurpose({
      purposeId: custom.purposeId,
      inlinePurpose: custom,
      purposes: [topUpPurpose],
      campaignBrief: custom.description,
    });

    expect(resolved).toBe(custom);
  });

  it("rejects an unknown explicit purpose instead of falling back to the first catalog item", () => {
    expect(() => resolveVoiceCampaignPurpose({
      purposeId: "MISSING_PURPOSE",
      purposes: [topUpPurpose],
      campaignBrief: "Run a servicing campaign.",
    })).toThrow("Purpose not found: MISSING_PURPOSE");
  });

  it("does not inject catalog product facts into a brief-only generation prompt", () => {
    const brief = "Call borrowers with a bounced EMI to understand payment blockers and offer servicing help.";
    const purpose = buildCampaignBriefPurpose(brief);
    const prompt = buildVoiceCampaignScriptPrompt(
      {
        name: "Recent EMI bounce borrowers",
        description: "Borrowers whose latest EMI bounced",
        sql: "SELECT borrower_id FROM collections_full WHERE payment_status = 'bounced'",
        userCount: 120,
      },
      purpose,
      "Hinglish",
      {
        companyName: "Example Lender",
        entityName: "borrowers",
        systemContext: "PRIVATE SCHEMA AND ANALYTICS CONTEXT",
        domainHints: "PRIVATE DOMAIN HINTS",
        reportMeta: { totalEvents: "9M", totalUsers: "1M", dateRangeLabel: "all time", dbName: "private.db" },
      },
      brief,
    );

    expect(prompt.user).toContain(brief);
    expect(prompt.user).toContain("this is not a separate product or offer");
    expect(prompt.user).not.toContain("Top-Up Loan");
    expect(prompt.user).not.toContain("VASTU_TOPUP");
    expect(prompt.user).not.toContain("SELECT borrower_id");
    expect(prompt.user).not.toContain("PRIVATE SCHEMA AND ANALYTICS CONTEXT");
    expect(prompt.user).not.toContain("PRIVATE DOMAIN HINTS");
    expect(prompt.user).not.toContain("9M");
  });

  it("asks the model to generate the full-agent build trace instead of fixed phases", () => {
    const brief = "Call recent borrowers to understand onboarding blockers.";
    const prompt = buildVoiceCampaignScriptPrompt(
      {
        name: "Recently onboarded borrowers",
        description: "Borrowers onboarded in the last 30 days",
        sql: "SELECT borrower_id FROM borrowers",
        userCount: 240,
      },
      buildCampaignBriefPurpose(brief),
      "Hinglish",
      { companyName: "Example Lender", entityName: "borrowers" },
      brief,
      "Ananya",
      "female",
      { fullAgent: true },
    );

    expect(prompt.system).toContain('"generation"');
    expect(prompt.system).toContain('"steps"');
    expect(prompt.user).toContain("Choose 4 to 8 meaningful steps");
    expect(prompt.user).toContain("do not follow a fixed phase template");
  });
});
