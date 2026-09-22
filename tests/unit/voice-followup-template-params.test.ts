import { describe, expect, it } from "vitest";

import { paramsForApprovedTemplate, templateSendPriority } from "@/lib/voice-followup-sms";
import type { GupshupWhatsAppTemplate } from "@/lib/gupshup-whatsapp-client";

function template(body: string, overrides: Partial<GupshupWhatsAppTemplate> = {}): GupshupWhatsAppTemplate {
  const parameterCount = new Set(
    Array.from(body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => match[1]?.trim()),
  ).size;
  return {
    id: "tpl",
    name: "tpl",
    status: "APPROVED",
    body,
    parameterCount,
    defaultParams: [],
    ...overrides,
  };
}

const RUNTIME = {
  message: "Vastu HFC: We have noted your call. Contact our team if you need support.",
  customerName: "Rahul",
  companyName: "Vastu HFC",
  purposeName: "Loan follow-up",
  date: "July 30, 2026",
  time: "4:12 PM",
};

describe("paramsForApprovedTemplate", () => {
  it("fills positional slots with short values, not the whole message body", () => {
    const params = paramsForApprovedTemplate(
      template("Hi {{1}}, you have a payment overdue:\n\nAccount: {{2}}\nAmount due: {{3}}\nDue date: {{4}}"),
      RUNTIME,
    );
    expect(params).toEqual(["Rahul", "Vastu HFC", "Loan follow-up", "July 30, 2026"]);
  });

  it("treats a single-parameter template as the message carrier", () => {
    const params = paramsForApprovedTemplate(template("Update: {{1}}"), RUNTIME);
    expect(params).toEqual([RUNTIME.message]);
  });

  it("resolves named placeholders from the runtime", () => {
    const params = paramsForApprovedTemplate(
      template("Hello {{customerName}}, thanks from {{companyName}} on {{date}}."),
      RUNTIME,
    );
    expect(params).toEqual(["Rahul", "Vastu HFC", "July 30, 2026"]);
  });

  it("never emits a blank parameter, even past the known runtime values", () => {
    const params = paramsForApprovedTemplate(
      template("{{1}} {{2}} {{3}} {{4}} {{5}} {{6}} {{7}}"),
      RUNTIME,
    );
    expect(params).toHaveLength(7);
    for (const value of params) expect(value.trim()).not.toBe("");
  });

  it("strips newlines and braces so Meta does not reject the parameter", () => {
    const params = paramsForApprovedTemplate(template("Note: {{1}}"), {
      ...RUNTIME,
      message: "Line one\nLine two {with braces}",
    });
    expect(params).toEqual(["Line one Line two with braces"]);
  });

  it("returns no parameters for a template that declares none", () => {
    expect(paramsForApprovedTemplate(template("Thanks for your time."), RUNTIME)).toEqual([]);
  });
});

describe("templateSendPriority", () => {
  it("puts text templates ahead of media ones", () => {
    const text = { ...template("Hi {{1}}"), type: "TEXT" };
    const image = { ...template("Hi {{1}}"), type: "IMAGE" };
    expect([image, text].sort((a, b) => templateSendPriority(a) - templateSendPriority(b)))
      .toEqual([text, image]);
  });

  it("treats an unknown type as text so it is still attempted early", () => {
    expect(templateSendPriority({ ...template("Hi {{1}}"), type: undefined })).toBe(0);
  });
});
