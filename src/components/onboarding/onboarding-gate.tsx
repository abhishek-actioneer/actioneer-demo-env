"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { isWizardComplete, completeWizard } from "@/lib/onboarding-wizard-store";

/**
 * Redirects to /onboarding if the wizard hasn't been completed.
 * Checks localStorage first (instant), then Clerk metadata (cross-device).
 * Wraps the main app layout — renders nothing until check completes
 * to prevent flash of app content before redirect.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Wait for Clerk to load before making decisions
    if (!isLoaded) return;

    if (isWizardComplete()) {
      setChecked(true);
    } else if (user?.publicMetadata?.onboardingComplete) {
      // Cross-device: Clerk says done, sync localStorage
      completeWizard();
      setChecked(true);
    } else {
      router.replace("/onboarding/account");
    }
  }, [router, isLoaded, user]);

  if (!checked) {
    return (
      <div className="overflow-hidden bg-background flex items-center justify-center fixed top-0 left-0 w-[calc(100vw/0.9)] h-[calc(100vh/0.9)] z-50">
        <img src="/grlogo.svg" alt="" width={32} height={32} className="animate-pulse opacity-40" />
      </div>
    );
  }

  return <>{children}</>;
}
