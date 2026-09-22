"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { OnboardingStepper } from "@/components/onboarding/onboarding-stepper";
import type { WizardStep } from "@/lib/onboarding-wizard-store";

const PATH_TO_STEP: Record<string, WizardStep> = {
  "/onboarding": "account",
  "/onboarding/account": "account",
  "/onboarding/connect": "connect",
  "/onboarding/syncing": "syncing",
  "/onboarding/complete": "complete",
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentStep = PATH_TO_STEP[pathname] ?? "account";

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      {/* Header — brand only */}
      <header className="flex items-center px-8 py-6">
        <Image src="/actioneer-logo.svg" alt="Actioneer" width={132} height={19} priority />
      </header>

      {/* Content — stepper + page content, centered together as one group */}
      <main className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
        <div className="my-auto flex w-full flex-col items-center">
          <div className="mb-12 w-full max-w-xl">
            <OnboardingStepper currentStep={currentStep} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
