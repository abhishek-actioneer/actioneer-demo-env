"use client";

import { use } from "react";
import dynamic from "next/dynamic";

const CanvasPage = dynamic(() => import("@/components/canvas/canvas-page"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading canvas...</p>
      </main>
    </div>
  ),
});

export default function CanvasDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <CanvasPage boardId={id} />;
}
