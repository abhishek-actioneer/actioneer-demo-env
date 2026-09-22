"use client";

import { useEffect } from "react";

/**
 * Hides Clerk's "Secured by Clerk" and "Development mode" badges
 * in local development for design review purposes.
 *
 * Clerk removes these automatically on production instances.
 * Enable: set NEXT_PUBLIC_CLERK_STRIP_DEV=1 in .env.local
 */
export function ClerkDevStrip() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_CLERK_STRIP_DEV !== "1") return;

    const HIDDEN_TEXTS = ["secured by", "development mode"];

    function strip(root: Element | Document = document) {
      const walker = document.createTreeWalker(
        root instanceof Document ? root.body : root,
        NodeFilter.SHOW_ELEMENT,
      );
      let node: Node | null = walker.currentNode;
      while (node) {
        const el = node as HTMLElement;
        const text = el.textContent?.toLowerCase().trim() ?? "";
        if (
          HIDDEN_TEXTS.some((t) => text === t || text.startsWith(t)) &&
          el.children.length <= 2 &&
          text.length < 40
        ) {
          // Walk up to the nearest container (padding wrapper)
          const target = el.closest("[class*='cl-']") ?? el;
          (target as HTMLElement).style.display = "none";
        }
        node = walker.nextNode();
      }
    }

    // Initial pass (Clerk renders async)
    const timer = setTimeout(strip, 500);

    // Watch for Clerk injecting new nodes
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const added of m.addedNodes) {
          if (added instanceof Element) strip(added);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return null;
}
