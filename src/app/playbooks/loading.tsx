import { SkeletonHeader, SkeletonRows } from "@/components/ui/skeleton-rows";

export default function PlaybooksLoading() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <SkeletonHeader />
        <SkeletonRows rows={4} columns={4} />
      </div>
    </main>
  );
}
