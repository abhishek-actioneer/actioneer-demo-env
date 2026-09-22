function isProduction(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN) return true;
  return false;
}

export interface VoiceRuntimeConfigHealth {
  ok: boolean;
  production: boolean;
  errors: string[];
}

export function getVoiceRuntimeConfigHealth(): VoiceRuntimeConfigHealth {
  const production = isProduction();
  const errors: string[] = [];

  return {
    ok: errors.length === 0,
    production,
    errors,
  };
}

export function assertVoiceRuntimeConfigForStartup(): void {
  const health = getVoiceRuntimeConfigHealth();
  if (health.ok) return;
  throw new Error(
    `[voice/runtime-config] Invalid production configuration:\n- ${health.errors.join("\n- ")}`,
  );
}
