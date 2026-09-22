"use client";

import { useCallback, useState } from "react";

export function useScriptHistory(setScript: (s: string) => void) {
  const [scriptHistory, setScriptHistory] = useState<string[]>([]);

  const pushHistory = useCallback((script: string) => {
    setScriptHistory((prev) => [...prev.slice(-4), script]);
  }, []);

  const undoScript = useCallback(() => {
    setScriptHistory((prev) => {
      const next = prev.slice(0, -1);
      const prevScript = prev[prev.length - 1];
      if (prevScript) setScript(prevScript);
      return next;
    });
  }, [setScript]);

  return { scriptHistory, setScriptHistory, pushHistory, undoScript };
}
