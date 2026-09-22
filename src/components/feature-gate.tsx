"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isFeatureEnabled, type FeatureId } from "@/lib/feature-flags";

/**
 * Wrap a page component to redirect to "/" if the feature is disabled.
 * Usage: <FeatureGate feature="scouts">...page content...</FeatureGate>
 */
export function FeatureGate({ feature, children }: { feature: FeatureId; children: React.ReactNode }) {
  const router = useRouter();
  const enabled = isFeatureEnabled(feature);

  useEffect(() => {
    if (!enabled) router.replace("/");
  }, [enabled, router]);

  if (!enabled) return null;
  return <>{children}</>;
}
