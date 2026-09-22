"use client";

import { SentinelLogo } from "@/components/ui/sentinel-logo";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { usePathname } from "next/navigation";

export function ChatFAB() {
  const { isOpen, hasDetailContent, rightPanelMode, setRightPanelMode, open } = useChatPanel();
  const pathname = usePathname();

  // Hide on home page (home has its own full-page chat)
  if (pathname === "/") return null;

  // On detail pages the panel is always open — the entity header has its own chat toggle
  if (hasDetailContent && isOpen) return null;

  // On non-detail pages, hide when panel is open
  if (!hasDetailContent && isOpen) return null;

  const handleClick = () => {
    if (hasDetailContent && isOpen) {
      setRightPanelMode("chat");
    } else {
      open();
      setRightPanelMode("chat");
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 p-3 animate-in fade-in zoom-in-75">
      <button
        onClick={handleClick}
        className="fab-metallic relative flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-full text-foreground active:scale-[0.97] transition-transform duration-200"
        aria-label="Ask Actioneer"
      >
        <SentinelLogo size={16} />
        <span className="text-[11.7px] font-medium whitespace-nowrap">Ask Actioneer</span>
      </button>
    </div>
  );
}
