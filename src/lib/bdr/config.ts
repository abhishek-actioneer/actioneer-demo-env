export function bdrReadiness(): { monaco: boolean; calling: boolean; missing: string[] } {
  const required = ["MONACO_API_KEY", "CARTESIA_API_KEY", "OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (!process.env.VOICE_PUBLIC_BASE_URL && !process.env.NEXT_PUBLIC_BASE_URL && !process.env.RAILWAY_PUBLIC_DOMAIN) missing.push("VOICE_PUBLIC_BASE_URL");
  return { monaco: !!process.env.MONACO_API_KEY, calling: missing.length === 0, missing };
}
