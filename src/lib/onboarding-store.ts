const STORAGE_KEY = "sentinel-onboarding";
const STORAGE_VERSION = 1;

const STEP_IDS = ["send-query", "view-report", "explore-data"] as const;
type StepId = (typeof STEP_IDS)[number];

interface OnboardingState {
  version: number;
  steps: Record<StepId, boolean>;
  dismissed: boolean;
}

function defaults(): OnboardingState {
  return {
    version: STORAGE_VERSION,
    steps: { "send-query": false, "view-report": false, "explore-data": false },
    dismissed: false,
  };
}

export function getOnboardingState(): OnboardingState {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as OnboardingState;
    if (parsed.version !== STORAGE_VERSION) return defaults();
    return parsed;
  } catch {
    return defaults();
  }
}

function persist(state: OnboardingState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function markStepComplete(stepId: StepId): OnboardingState {
  const state = getOnboardingState();
  if (state.steps[stepId]) return state; // already done
  state.steps[stepId] = true;
  persist(state);
  return state;
}

export function isOnboardingComplete(): boolean {
  const state = getOnboardingState();
  return state.dismissed || STEP_IDS.every((id) => state.steps[id]);
}

export function dismissOnboarding(): void {
  const state = getOnboardingState();
  state.dismissed = true;
  persist(state);
}

/** Dev helper — call from browser console: `resetOnboarding()` */
export function resetOnboarding(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// Expose dev helper on window
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).resetOnboarding = resetOnboarding;
}

export { STEP_IDS, type StepId, type OnboardingState };
