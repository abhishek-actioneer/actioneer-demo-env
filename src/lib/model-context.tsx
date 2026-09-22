"use client";

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { MODELS, DEFAULT_MODEL, type ModelId, type LLMModel } from "@/lib/model-registry";
import { setActiveModelId } from "./api-client";

const STORAGE_KEY = "sentinel-model-id";

interface ModelContextValue {
  modelId: ModelId;
  model: LLMModel;
  switchModel: (id: ModelId) => void;
  /** Spread into fetch() headers to forward the selected model to API routes */
  modelHeaders: { "x-model-id": ModelId };
}

const ModelContext = createContext<ModelContextValue>({
  modelId: DEFAULT_MODEL,
  model: MODELS[0],
  switchModel: () => {},
  modelHeaders: { "x-model-id": DEFAULT_MODEL },
});

export function ModelProvider({ children }: { children: ReactNode }) {
  const [modelId, setModelId] = useState<ModelId>(DEFAULT_MODEL);

  // Sync from localStorage after hydration — never read in useState initializer (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as ModelId | null;
      if (stored && MODELS.some((m) => m.id === stored)) {
        setModelId(stored);
        setActiveModelId(stored);
      }
    } catch {
      // localStorage unavailable (private browsing etc.) — keep default
    }
  }, []);

  const switchModel = useCallback((id: ModelId) => {
    setModelId(id);
    setActiveModelId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore write failures
    }
  }, []);

  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  const modelHeaders = useMemo(() => ({ "x-model-id": modelId }), [modelId]);

  return (
    <ModelContext.Provider value={{ modelId, model, switchModel, modelHeaders }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel() {
  return useContext(ModelContext);
}
