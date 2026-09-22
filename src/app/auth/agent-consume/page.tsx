"use client";

import { useEffect, useState } from "react";
import { useSignIn } from "@clerk/nextjs/legacy";
import { useClerk } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";

export default function AgentConsumePage() {
  const { signIn, isLoaded } = useSignIn();
  const { setActive } = useClerk();
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState("Signing you in...");

  useEffect(() => {
    if (!isLoaded || !signIn) return;
    const ticket = params.get("ticket");
    if (!ticket) {
      setStatus("Missing ticket.");
      return;
    }

    (async () => {
      try {
        const res = await signIn.create({ strategy: "ticket", ticket });
        if (res.status === "complete" && res.createdSessionId) {
          await setActive({ session: res.createdSessionId });
          router.push("/");
        } else {
          setStatus(`Sign-in incomplete: ${res.status}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        setStatus(`Sign-in failed: ${message}`);
      }
    })();
  }, [isLoaded, signIn, params, setActive, router]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="text-sm text-muted-foreground">{status}</div>
    </div>
  );
}
