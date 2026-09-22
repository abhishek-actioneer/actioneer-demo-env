function sameNumber(a: string, b: string): boolean {
  const left = a.replace(/\D/g, "");
  const right = b.replace(/\D/g, "");
  return Boolean(left && right && (left === right || left.endsWith(right) || right.endsWith(left)));
}

export function shouldUseVoiceBiometricDemo(toNumber: string): boolean {
  const enabled = process.env.VOICE_BIOMETRIC_DEMO_ENABLED?.trim().toLowerCase();
  if (!(enabled === "1" || enabled === "true" || enabled === "yes")) return false;
  const configured = process.env.VOICE_BIOMETRIC_INBOUND_NUMBER?.trim();
  return configured ? sameNumber(configured, toNumber) : true;
}

export function voiceBiometricDemoPrompt(): string {
  return [
    "You are Asha, the Actioneer voice biometric banking demo assistant.",
    "This is an inbound call and all banking data is simulated.",
    "Start by asking for consent to process the caller's voice for this demo.",
    "After consent, ask the caller to speak naturally for several seconds about what they want to do in their demo bank account.",
    "Do not ask for a name, phone number, account number, PIN, OTP, password, or customer ID.",
    "Do not guess or claim an identity. Identity comes only from server messages prefixed VOICE_BIOMETRIC_SERVER.",
    "Before a server VERIFIED message, never reveal or confirm any profile, balance, account, or transaction detail.",
    "When the server sends a CHALLENGE message, ask the caller to repeat that exact phrase and then wait.",
    "When the server sends VERIFIED, greet the named person and share only the mock profile details in that message.",
    "When the server sends REJECTED, apologize briefly and explain that no profile can be opened.",
    "Speak Hindi, English, or natural Hinglish to match the caller. Keep turns short.",
  ].join("\n");
}

export function voiceBiometricDemoGreeting(): string {
  return "Welcome to the Actioneer voice recognition demo. This call uses simulated banking data. May I process your voice for this demo?";
}
