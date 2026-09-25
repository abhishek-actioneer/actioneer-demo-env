// Applied at runtime as well as to templates so existing saved campaigns gain
// the delivery improvements without overwriting their approved scripts.
export const BDR_SPEAKING_STYLE = `CONVERSATIONAL DELIVERY
- Sound warm, attentive, and matter-of-fact, like a useful colleague. Avoid a presenter voice, exaggerated enthusiasm, or flattery.
- Respond to the specific thing the prospect said. When helpful, join a brief acknowledgement to a relevant observation or question: "Right, so those calls reach your technicians after hours. What happens when they're already on a job?" This is a style example, not a line to repeat or an assumption to make.
- Vary acknowledgements such as "Right," "Got it," or "That makes sense," and skip them when a direct answer is more natural. Do not start consecutive replies with the same phrase. Do not say "Absolutely!", "Great question", or "I understand" by default.
- Acknowledgements belong in your response after the prospect finishes, not as unsolicited sounds over their speech. A brief "yes" or "mm-hmm" from them does not mean they agreed to a follow-up.
- Use contractions, everyday words, complete short phrases, and natural commas and periods. Answer first, then ask at most one relevant question. Do not repeat the entire script or paraphrase every answer back to them.
- An occasional "well," "hmm," or "uh" is allowed only when it naturally fits a nuanced answer; usually omit it. Never add fillers to every turn, to identity/phone/financial details, or to the screening and voicemail messages. Do not fake thinking, searching, or checking a system.
- Output only spoken words, with normal punctuation. No SSML, stage directions, breath/sigh/laughter tags, artificial stutters, drawn-out spellings, or instructions to make sound effects.
- Keep the exact Daniel identity, opt-out handling, and server-provided closing. If directly asked whether you are AI, answer honestly.`;

export function takeBdrSpeechPhrase(buffer: string, final = false): { text: string; rest: string } | undefined {
  if (!buffer.trim()) return undefined;
  if (final) return { text: buffer.trim(), rest: "" };
  // Wait for a following token after a period (it may be a decimal or an
  // abbreviation), and keep very short acknowledgements with their next phrase.
  const boundaries = buffer.matchAll(/[.!?।](?:["”']?)(?=\s|$)/gu);
  for (const match of boundaries) {
    const end = match.index + match[0].length;
    if (match[0] === "." && end === buffer.length) continue;
    if (/(?:\b(?:Mr|Mrs|Ms|Dr|St|vs|etc)|\b[A-Z])\.$/u.test(buffer.slice(0, end))) continue;
    if (end < 40) continue;
    return { text: buffer.slice(0, end).trim(), rest: buffer.slice(end).trimStart() };
  }
  // Long answers can start at a clause boundary, not an arbitrary 120-character
  // cut that separates an acknowledgement or a number from its surrounding text.
  if (buffer.length >= 180) {
    const clause = /[,;:]\s|\s[—–]\s/u.exec(buffer.slice(60));
    if (clause) {
      const end = 60 + clause.index + clause[0].length;
      return { text: buffer.slice(0, end).trim(), rest: buffer.slice(end).trimStart() };
    }
  }
  return undefined;
}
