"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";

export default function SSOCallback() {
  return (
    <>
      <AuthenticateWithRedirectCallback
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/onboarding/account"
      />
      <div className="flex h-screen flex-col items-center justify-center bg-[#111] gap-3">
        <Loader2 className="w-5 h-5 text-[#555] animate-spin" />
        <p className="text-[11.7px] text-[#444]">Signing you in...</p>
      </div>
    </>
  );
}
