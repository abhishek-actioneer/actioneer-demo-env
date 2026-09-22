"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

interface BreadcrumbContextValue {
  title: string;
  setTitle: (title: string) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  title: "",
  setTitle: () => {},
});

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState("");
  return (
    <BreadcrumbContext.Provider value={{ title, setTitle }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumb() {
  return useContext(BreadcrumbContext);
}

/** Call this in detail pages to set the breadcrumb title */
export function useBreadcrumbTitle(title: string) {
  const { setTitle } = useBreadcrumb();
  useEffect(() => {
    setTitle(title);
    return () => setTitle("");
  }, [title, setTitle]);
}
