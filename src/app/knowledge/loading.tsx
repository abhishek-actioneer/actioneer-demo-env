import { SkeletonHeader } from "@/components/ui/skeleton-rows";

export default function KnowledgeLoading() {
  return (
    <>
      <div className="px-6 pt-6 pb-0 shrink-0">
        <div className="max-w-6xl mx-auto">
          <SkeletonHeader />
        </div>
      </div>
      <div className="flex-1 min-h-0 px-6 pb-6">
        <div className="max-w-6xl mx-auto h-full flex gap-0 animate-pulse">
          <div className="w-1/2 h-full border border-border rounded-l-lg p-4 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-border last:border-0">
                <div className="flex gap-2">
                  <div className="h-5 w-16 bg-muted rounded-full" />
                  <div className="h-5 w-12 bg-muted rounded-full" />
                </div>
                <div className="h-3 w-full bg-muted/60 rounded" />
                <div className="h-3 w-3/4 bg-muted/40 rounded" />
              </div>
            ))}
          </div>
          <div className="w-1/2 h-full border border-l-0 border-border rounded-r-lg flex items-center justify-center">
            <div className="h-4 w-40 bg-muted/40 rounded" />
          </div>
        </div>
      </div>
    </>
  );
}
