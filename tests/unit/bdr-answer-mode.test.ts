import { describe, expect, it } from "vitest";
import { detectBdrAnswerMode, isBdrScreeningHold } from "@/lib/bdr/answer-mode";
import { BDR_TEMPLATES } from "@/lib/bdr/templates";

describe("phone answer classification", () => {
  it.each([
    "Hi, if you record your name and reason for calling, I'll see if this person is available.",
    "Please state your name and reason for calling.",
  ])("recognizes a screening request: %s", (text) => expect(detectBdrAnswerMode(text)).toBe("screening"));
  it("keeps screening hold separate from voicemail", () => {
    const text = "Thanks, please stay on the line while I try to reach them.";
    expect(isBdrScreeningHold(text)).toBe(true);
    expect(detectBdrAnswerMode(text)).toBeUndefined();
  });
  it("recognizes a recorded voicemail invitation without matching a product question", () => {
    expect(detectBdrAnswerMode("I'm unavailable. Please leave your message after the tone.")).toBe("voicemail");
    expect(detectBdrAnswerMode("Can your voice agents handle voicemail and call screening?")).toBeUndefined();
    expect(detectBdrAnswerMode("Hello, we mainly do plumbing.")).toBeUndefined();
  });
});

describe("campaign templates", () => {
  it.each(BDR_TEMPLATES)("provides valid editable fields and a Daniel voicemail for $name", (template) => {
    expect(template.opening).toContain("Daniel from Actioneer");
    expect(template.script.length).toBeLessThanOrEqual(15000);
    expect(template.voicemail.length).toBeLessThanOrEqual(1600);
    expect(template.voicemail).toContain("Thank you for your time, and have a wonderful day.");
  });
});
