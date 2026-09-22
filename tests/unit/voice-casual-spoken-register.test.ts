import { describe, expect, it } from "vitest";
import {
  casualSpokenRegisterAuthoringRules,
  casualSpokenRegisterNudge,
  isCasualSouthIndianLanguage,
} from "@/lib/voice-casual-spoken-register";

describe("casual spoken register", () => {
  it("detects Tamil/Telugu/Kannada", () => {
    expect(isCasualSouthIndianLanguage("Tamil")).toBe(true);
    expect(isCasualSouthIndianLanguage("telugu")).toBe(true);
    expect(isCasualSouthIndianLanguage("kn")).toBe(true);
    expect(isCasualSouthIndianLanguage("Hindi")).toBe(false);
  });

  it("nudges prefer casual forms and forbid formal ones", () => {
    const ta = casualSpokenRegisterNudge("Tamil");
    expect(ta).toContain("நீங்க");
    expect(ta).toContain("பேசுறேன்");
    expect(ta).toContain("பேசுகிறேன்");
    expect(ta).toMatch(/casual|phone/i);

    const te = casualSpokenRegisterNudge("Telugu");
    expect(te).toContain("మాట్లాడుతున్నా");
    expect(te).toContain("మాట్లాడుచున్నాను");

    const kn = casualSpokenRegisterNudge("Kannada");
    expect(kn).toContain("ಮಾತಾಡ್ತಾ ಇದೀನಿ");
    expect(kn).toContain("ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ");
  });

  it("authoring rules include casual OK vs formal BAD examples", () => {
    const ta = casualSpokenRegisterAuthoringRules("Tamil");
    expect(ta).toMatch(/Casual OK/);
    expect(ta).toMatch(/Formal BAD/);
    expect(ta).toContain("பேசுறேன்");
    expect(ta).toContain("பேசுகிறேன்");
  });

});
