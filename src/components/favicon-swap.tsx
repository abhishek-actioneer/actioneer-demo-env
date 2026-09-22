"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const DEV_ICON = "/icon-dev.svg";

export function FaviconSwap() {
  const pathname = usePathname();

  useEffect(() => {
    const hostname = window.location.hostname;
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0";
    if (!isLocal) return;

    const links = document.querySelectorAll<HTMLLinkElement>(
      'link[rel~="icon"], link[rel="shortcut icon"]'
    );

    let hasDev = false;
    links.forEach((link) => {
      if (link.href.includes(DEV_ICON)) {
        hasDev = true;
      } else if (link.type === "image/svg+xml" || link.rel === "icon") {
        link.href = DEV_ICON;
        hasDev = true;
      }
    });

    if (!hasDev) {
      const link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      link.href = DEV_ICON;
      document.head.appendChild(link);
    }
  }, [pathname]);

  return null;
}
