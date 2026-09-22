/**
 * Onboarding wizard state — separate from the in-app onboarding widget.
 * Tracks progress through the post-signup wizard flow.
 */

const STORAGE_KEY = "sentinel-onboarding-wizard";
const STORAGE_VERSION = 1;

export type WizardStep = "account" | "connect" | "syncing" | "complete";

export const WIZARD_STEPS: WizardStep[] = ["account", "connect", "syncing", "complete"];

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  account: "Account",
  connect: "Data",
  syncing: "Syncing",
  complete: "Complete",
};

export interface AccountInfo {
  orgName: string;
  appName: string;
  appUrl: string;
}

export interface WizardState {
  version: number;
  currentStep: WizardStep;
  accountInfo: AccountInfo;
  selectedConnectors: string[];
  selectedDataset: string;
  completed: boolean;
}

function defaults(): WizardState {
  return {
    version: STORAGE_VERSION,
    currentStep: "account",
    accountInfo: { orgName: "", appName: "", appUrl: "" },
    selectedConnectors: [],
    selectedDataset: "",
    completed: false,
  };
}

export function getWizardState(): WizardState {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as WizardState;
    if (parsed.version !== STORAGE_VERSION) return defaults();
    return parsed;
  } catch {
    return defaults();
  }
}

function persist(state: WizardState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function setWizardStep(step: WizardStep): WizardState {
  const state = getWizardState();
  state.currentStep = step;
  persist(state);
  return state;
}

export function setAccountInfo(info: AccountInfo): WizardState {
  const state = getWizardState();
  state.accountInfo = info;
  persist(state);
  return state;
}

export function setSelectedConnectors(connectors: string[]): WizardState {
  const state = getWizardState();
  state.selectedConnectors = connectors;
  persist(state);
  return state;
}

export function setSelectedDataset(datasetId: string): WizardState {
  const state = getWizardState();
  state.selectedDataset = datasetId;
  persist(state);
  return state;
}

export function completeWizard(): WizardState {
  const state = getWizardState();
  state.completed = true;
  persist(state);
  return state;
}

export function isWizardComplete(): boolean {
  return getWizardState().completed;
}

export function resetWizard(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// Dev helper
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).resetWizard = resetWizard;
}
