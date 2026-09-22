"use client";

import { createContext, useContext } from "react";
import type { DataPointClickPayload } from "./card-renderers/types";

type DrilldownHandler = (cardId: string, payload: DataPointClickPayload) => void;

const DrilldownHandlerContext = createContext<DrilldownHandler | null>(null);

export function DrilldownHandlerProvider({
  handler,
  children,
}: {
  handler: DrilldownHandler | null;
  children: React.ReactNode;
}) {
  return (
    <DrilldownHandlerContext.Provider value={handler}>
      {children}
    </DrilldownHandlerContext.Provider>
  );
}

export function useDrilldownHandler(): DrilldownHandler | null {
  return useContext(DrilldownHandlerContext);
}
