import { useState, useRef, useCallback, useEffect } from "react";
import { useSidebarContext } from "@/components/sidebar-context";
import { useRouter, useSearchParams } from "next/navigation";
import { useDataset } from "@/lib/dataset-context";
import type { ChatMessage } from "@/lib/types";
import { toast } from "sonner";
import {
  saveConversation,
  getConversation,
  updateConversationMessages,
  flushToStorage,
} from "@/lib/conversation-store";

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * @param onSwitch — optional callback fired after switching conversation or creating new chat.
 *                    Use this to reset external state like panels, deep-research toggle, etc.
 */
export function useConversation(onSwitch?: () => void) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sourceCanvasItemId, setSourceCanvasItemId] = useState<string | null>(null);
  const agentMsgIdRef = useRef<string>("");

  const { setActiveId, setOnNewChat, setOnSelect, refreshChats, setActiveMessages, setProcessingChatId } = useSidebarContext();
  const { datasetId } = useDataset();

  // Stable ref so callbacks don't re-create when onSwitch changes
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;

  // ── Clear chat when dataset changes ──
  const prevDatasetRef = useRef(datasetId);
  useEffect(() => {
    if (prevDatasetRef.current !== datasetId) {
      prevDatasetRef.current = datasetId;
      setMessages([]);
      setActiveId("");
    }
  }, [datasetId, setActiveId]);

  // ── Conversation switching ──
  const switchConversation = useCallback(
    async (id: string) => {
      if (isProcessing) {
        toast("Response in progress", { description: "Wait for it to finish before switching chats." });
        return;
      }
      if (activeConvId && messages.length > 0) {
        await updateConversationMessages(activeConvId, messages);
        flushToStorage();
      }
      const conv = await getConversation(id);
      if (conv) {
        setMessages(conv.messages ?? []);
        setSourceCanvasItemId(conv.sourceCanvasItemId ?? null);
        const agentMsg = (conv.messages ?? []).find((m: ChatMessage) => m.role === "agent");
        agentMsgIdRef.current = agentMsg?.id ?? "";
      } else {
        setMessages([]);
        setSourceCanvasItemId(null);
        toast.info("This conversation is no longer available.");
        refreshChats();
        return;
      }
      setActiveConvId(id);
      onSwitchRef.current?.();
      router.push("/");
    },
    [isProcessing, activeConvId, messages, refreshChats, router]
  );

  const handleNewChat = useCallback(async () => {
    if (isProcessing) {
      toast("Response in progress", { description: "Wait for it to finish before starting a new chat." });
      return;
    }
    if (activeConvId && messages.length > 0) {
      await updateConversationMessages(activeConvId, messages);
      flushToStorage();
    }
    setMessages([]);
    setActiveConvId(null);
    setSourceCanvasItemId(null);
    onSwitchRef.current?.();
    router.push("/");
  }, [isProcessing, activeConvId, messages, router]);

  // ── Create conversation if needed ──
  const ensureConversation = useCallback(
    async (title: string): Promise<string> => {
      if (activeConvId) return activeConvId;
      const convId = createId();
      await saveConversation({
        id: convId,
        title,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        datasetId,
      });
      refreshChats();
      setActiveConvId(convId);
      return convId;
    },
    [activeConvId, datasetId, refreshChats]
  );

  // ── Handle ?conv= param ──
  const convParam = searchParams.get("conv");
  useEffect(() => {
    if (convParam && convParam !== activeConvId && !isProcessing) {
      switchConversation(convParam);
      router.replace("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convParam]);

  // ── Sync sidebar context ──
  useEffect(() => { setActiveId(activeConvId); }, [activeConvId, setActiveId]);
  useEffect(() => { setOnNewChat(handleNewChat); }, [handleNewChat, setOnNewChat]);
  useEffect(() => { setOnSelect(switchConversation); }, [switchConversation, setOnSelect]);
  useEffect(() => { setActiveMessages(messages); }, [messages, setActiveMessages]);
  useEffect(() => { setProcessingChatId(isProcessing ? activeConvId : null); }, [isProcessing, activeConvId, setProcessingChatId]);

  // ── Save on unmount + beforeunload ──
  const activeConvIdRef = useRef(activeConvId);
  const messagesRef = useRef(messages);
  activeConvIdRef.current = activeConvId;
  messagesRef.current = messages;

  useEffect(() => {
    const saveIfNeeded = () => {
      if (activeConvIdRef.current && messagesRef.current.length > 0) {
        void updateConversationMessages(activeConvIdRef.current, messagesRef.current);
        flushToStorage();
      }
    };
    window.addEventListener("beforeunload", saveIfNeeded);
    return () => {
      window.removeEventListener("beforeunload", saveIfNeeded);
      saveIfNeeded();
    };
  }, []);

  // ── Save after streaming completes ──
  const saveCurrentConversation = useCallback((convId: string) => {
    setTimeout(() => {
      setMessages((latest) => {
        void (async () => {
          await updateConversationMessages(convId, latest);
        })();
        return latest;
      });
    }, 0);
  }, []);

  return {
    messages,
    setMessages,
    activeConvId,
    setActiveConvId,
    isProcessing,
    setIsProcessing,
    sourceCanvasItemId,
    setSourceCanvasItemId,
    agentMsgIdRef,
    messagesRef,
    handleNewChat,
    ensureConversation,
    saveCurrentConversation,
    switchConversation,
    refreshChats,
  };
}
