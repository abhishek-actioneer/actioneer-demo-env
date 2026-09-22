"use client";

import { useState } from "react";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { useClerk } from "@clerk/nextjs";
import Image from "next/image";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";

export default function AuthPage() {
  const { signIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();
  const { setActive } = useClerk();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isLoaded = signInLoaded && signUpLoaded;
  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function handleGoogleSSO() {
    if (!signIn) return;
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/auth/sso-callback",
        redirectUrlComplete: "/",
      });
    } catch (err) {
      setError(getClerkError(err));
    }
  }

  // Single email + password path: sign in if the account exists, otherwise
  // create it with the same password. No email codes.
  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !signIn || !signUp) return;
    setError("");
    setLoading(true);

    try {
      const result = await signIn.create({ identifier: email.trim(), password });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        window.location.href = "/";
        return;
      }
      setError("Could not sign you in. Please try again.");
    } catch (err: unknown) {
      const code = (err as { errors?: Array<{ code: string }> }).errors?.[0]?.code;
      if (code === "form_identifier_not_found") {
        // New account: create with email + password.
        try {
          const created = await signUp!.create({ emailAddress: email.trim(), password });
          if (created.status === "complete") {
            await setActive({ session: created.createdSessionId });
            window.location.href = "/onboarding/account";
            return;
          }
          setError("We could not finish creating your account. Please contact your Actioneer team.");
        } catch (signUpErr) {
          setError(getClerkError(signUpErr));
        }
      } else {
        setError(getClerkError(err));
      }
    } finally {
      setLoading(false);
    }
  }

  const isTouchDevice = typeof window !== "undefined" && "ontouchstart" in window;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-white py-10">
      {/* Centered auth card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        // Render this page 20% larger by default (matches a 120% browser zoom).
        // Scoped to the auth card only, so no other page is affected.
        style={{ zoom: 1.2 }}
        className="relative z-10 w-full max-w-sm px-8"
      >
        {/* Logo + heading — centered */}
        <div className="flex flex-col items-center text-center mb-8">
          <Image
            src="/actioneer-logo.svg"
            alt="Actioneer"
            width={184}
            height={27}
            priority
            className="mb-6"
          />
          <h1 className="text-[19.8px] font-semibold text-[#18181b]">
            Welcome to Actioneer
          </h1>
        </div>

        {/* Google SSO */}
        <button
          onClick={handleGoogleSSO}
          disabled={!isLoaded}
          className="flex items-center justify-center gap-2.5 w-full h-11 rounded-lg bg-white text-[12.6px] font-medium text-[#18181b] border border-[#e4e4e7] hover:bg-[#f4f4f5] active:scale-[0.97] transition-all shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-[#e4e4e7]" />
          <span className="text-[10.8px] text-[#a1a1aa]">or</span>
          <div className="flex-1 h-px bg-[#e4e4e7]" />
        </div>

        {/* Email + password */}
        <form onSubmit={handlePasswordSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="name@work-email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus={!isTouchDevice}
            spellCheck={false}
            autoComplete="email"
            required
            className="w-full h-11 px-4 rounded-lg bg-white border border-[#e4e4e7] text-[12.6px] text-[#18181b] placeholder:text-[#a1a1aa] focus:border-[#71717a] focus:outline-none transition-colors"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            spellCheck={false}
            autoComplete="current-password"
            required
            className="w-full h-11 px-4 rounded-lg bg-white border border-[#e4e4e7] text-[12.6px] text-[#18181b] placeholder:text-[#a1a1aa] focus:border-[#71717a] focus:outline-none transition-colors"
          />

          {error && <p className="text-[10.8px] text-[#dc2626]">{error}</p>}

          <button
            type="submit"
            disabled={loading || !isLoaded || !canSubmit}
            className={`w-full h-11 rounded-lg text-[12.6px] font-medium active:scale-[0.97] transition-all flex items-center justify-center gap-2 ${
              canSubmit
                ? "bg-[#18181b] text-white hover:bg-[#27272a] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "bg-[#f4f4f5] text-[#a1a1aa] border border-[#e4e4e7] cursor-not-allowed"
            }`}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
          </button>
        </form>

        {/* Legal */}
        <p className="text-[9.9px] text-[#a1a1aa] mt-10 leading-relaxed text-center">
          By signing in, you agree to our{" "}
          <a href="https://actioneer.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[#71717a] hover:text-[#18181b] transition-colors">
            Privacy Policy
          </a>{" "}
          and{" "}
          <a href="https://actioneer.com/terms" target="_blank" rel="noopener noreferrer" className="text-[#71717a] hover:text-[#18181b] transition-colors">
            Terms of Service
          </a>.
        </p>
      </motion.div>

      {/* Clerk CAPTCHA container (required for bot protection) */}
      <div id="clerk-captcha" className="hidden" />
    </div>
  );
}

function getClerkError(err: unknown): string {
  const clerkErr = err as { errors?: Array<{ message?: string; longMessage?: string }> };
  return clerkErr.errors?.[0]?.longMessage ?? clerkErr.errors?.[0]?.message ?? "Something went wrong. Please try again.";
}
