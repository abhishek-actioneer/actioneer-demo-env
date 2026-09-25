// Match automated announcements, not a human asking about voicemail features.
export function detectBdrAnswerMode(text: string): "screening" | "voicemail" | undefined {
  const value = text.toLowerCase().replace(/[’']/g, "'");
  if (/(?:record|state|say|provide|tell)[\s\S]{0,55}(?:your )?name[\s\S]{0,70}(?:reason|why|calling)/i.test(value)
    || /(?:screening (?:this|your|the) call|call is being screened|google (?:call|screening) assistant)/i.test(value)) return "screening";
  if (/(?:please |you (?:can|may) )leave[\s\S]{0,45}(?:message|name and (?:number|phone))/i.test(value)
    || /(?:at|after) the (?:beep|tone)|you(?:'ve| have) reached[\s\S]{0,100}(?:mailbox|voicemail)|(?:mailbox|voicemail) is (?:full|not set up)/i.test(value)) return "voicemail";
}

export function isBdrScreeningHold(text: string): boolean {
  return /(?:please|just) (?:hold|wait)|stay on the line|one moment|see if.{0,45}available|try(?:ing)? to (?:connect|reach)|thank you[,.! ]*please/i.test(text);
}

export const BDR_AMD_RESULTS = ["human", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax", "unknown"] as const;
