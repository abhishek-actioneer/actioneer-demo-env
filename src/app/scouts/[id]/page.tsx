"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Radar } from "lucide-react";
import { ResizablePanel } from "@/components/chat/resizable-panel";
import { ChatInput } from "@/components/chat/chat-input";
import { ScoutConfigPanel } from "@/components/scout/scout-config-panel";
import { ScoutReportPanel } from "@/components/scout/scout-report-panel";
import { MarkdownContent } from "@/lib/markdown";
import { getScout } from "@/lib/scout-data";
import type { ChatMessage } from "@/lib/types";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";

export default function ScoutDetailPage() {
  const router = useRouter();
  const params = useParams();
  const scoutId = params.id as string;
  const scout = getScout(scoutId);

  useBreadcrumbTitle(scout?.name ?? "");

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [deepResearch, setDeepResearch] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedRun = scout?.runs.find((r) => r.id === selectedRunId) ?? null;

  const handleSelectRun = useCallback(
    (runId: string) => {
      const run = scout?.runs.find((r) => r.id === runId);
      if (run) {
        setSelectedRunId(runId);
        setMessages([...run.messages]);
      }
    },
    [scout]
  );

  const handleCloseRun = useCallback(() => {
    setSelectedRunId(null);
    setMessages([]);
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);

      // Simulated scout response
      setTimeout(() => {
        const response: ChatMessage = {
          id: `scout-${Date.now()}`,
          role: "sentinel",
          content:
            "I'd need to run additional queries to answer that. In a live environment, I would analyze the data and provide a detailed response. For now, the full report on the right contains the most comprehensive analysis available for this run.",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, response]);
      }, 800);

      // Scroll to bottom
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 50);
    },
    []
  );

  if (!scout) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Scout not found</p>
          <p className="text-sm text-muted-foreground">
            This scout doesn&apos;t exist or has been deleted.
          </p>
          <button
            onClick={() => router.push("/scouts")}
            className="mt-1 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Back to Scouts
          </button>
        </div>
      </div>
    );
  }

  return (
      <div className="flex-1 flex min-w-0 h-full">
        {/* Left side: header + content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-8 pt-6 pb-4">
            <h1 className="text-2xl font-semibold text-foreground">{scout.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {scout.schedule} · {scout.status}
            </p>
          </div>

          {/* Content area */}
          <div className="flex-1 flex flex-col min-h-0 relative">
            {/* State 2: Chat view */}
            <div
              className={`absolute inset-0 flex flex-col transition-opacity duration-200 ${
                selectedRun ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              {/* Chat messages */}
              <div
                ref={scrollRef}
                className="flex-1 min-h-0 overflow-y-auto"
              >
                <div className="max-w-3xl mx-auto w-full px-4 py-4 space-y-4">
                  {messages.map((msg) => (
                    <div key={msg.id} className="animate-fade-in-up">
                      {msg.role === "user" ? (
                        <div className="flex justify-end">
                          <div className="max-w-[80%] bg-foreground text-background px-4 py-2.5 rounded-2xl rounded-br-md">
                            <p className="text-sm">{msg.content}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                            <Radar className="w-3 h-3 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm leading-relaxed prose prose-sm prose-neutral max-w-none prose-p:text-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-table:text-sm prose-table:border-collapse prose-th:text-left prose-th:py-1.5 prose-th:px-2 prose-th:font-medium prose-th:border prose-th:border-border prose-th:bg-muted/30 prose-td:py-1.5 prose-td:px-2 prose-td:border prose-td:border-border prose-li:text-foreground">
                              <MarkdownContent content={msg.content} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Chat input — reuse main chat input */}
              {selectedRun && (
                <ChatInput
                  onSend={handleSend}
                  deepResearch={deepResearch}
                  onToggleDeepResearch={() => setDeepResearch((d) => !d)}
                  dropUp
                />
              )}
            </div>

            {/* State 1: Run cards — overview state */}
            <div
              className={`absolute inset-0 transition-opacity duration-200 ${
                selectedRun ? "opacity-0 z-0 pointer-events-none" : "opacity-100 z-10"
              }`}
            >
              <div className="h-full overflow-y-auto">
                <div className="max-w-3xl mx-auto w-full px-6 py-6">
                  {scout.runs.length > 0 ? (
                    <div className="space-y-3">
                      {scout.runs.map((run) => (
                        <button
                          key={run.id}
                          onClick={() => handleSelectRun(run.id)}
                          className="w-full flex items-start gap-4 px-4 py-3 rounded-lg border border-border hover:bg-muted/30 transition-colors text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-medium">
                                Run #{run.number}
                              </span>
                              <span className="text-[9.9px] text-muted-foreground">
                                {run.runAt}
                              </span>
                            </div>
                            <p className="text-[9.9px] text-muted-foreground">
                              {run.summary}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-20">
                      <div className="text-center space-y-3 max-w-xs">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto">
                          <Radar className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium">No runs yet</p>
                        <p className="text-xs text-muted-foreground">
                          This scout hasn&apos;t run yet. Run it now or wait
                          for the next scheduled run.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel — spans full height */}
        <ResizablePanel
          defaultWidth={420}
          minWidth={320}
          maxWidth={560}
        >
          <div className="relative h-full">
            <div
              className={`absolute inset-0 transition-opacity duration-200 ${
                selectedRun ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              {selectedRun && (
                <ScoutReportPanel run={selectedRun} onClose={handleCloseRun} />
              )}
            </div>
            <div
              className={`absolute inset-0 transition-opacity duration-200 ${
                selectedRun ? "opacity-0 z-0 pointer-events-none" : "opacity-100 z-10"
              }`}
            >
              <ScoutConfigPanel
                scout={scout}
                onSelectRun={handleSelectRun}
              />
            </div>
          </div>
        </ResizablePanel>
      </div>
  );
}
