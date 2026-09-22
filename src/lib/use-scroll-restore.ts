"use client";

import { useRef, useEffect } from "react";
import { usePathname } from "next/navigation";

// Global scroll position store (survives re-renders, not page refreshes)
const scrollPositions: Record<string, number> = {};

/**
 * Saves and restores scroll position for a scrollable container per-route.
 * Returns a ref to attach to the scroll container element.
 */
export function useScrollRestore<T extends HTMLElement = HTMLElement>() {
  const pathname = usePathname();
  const ref = useRef<T>(null);
  const prevPathRef = useRef(pathname);

  // Save scroll position when pathname changes
  useEffect(() => {
    const prev = prevPathRef.current;
    if (prev !== pathname && ref.current) {
      scrollPositions[prev] = ref.current.scrollTop;
    }
    prevPathRef.current = pathname;
  }, [pathname]);

  // Restore scroll position on mount
  useEffect(() => {
    const saved = scrollPositions[pathname];
    if (saved && ref.current) {
      ref.current.scrollTop = saved;
    }
  }, [pathname]);

  // Save on unmount
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) {
        scrollPositions[pathname] = el.scrollTop;
      }
    };
  }, [pathname]);

  return ref;
}
