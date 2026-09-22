/**
 * Lightweight shimmer skeleton for table/list pages.
 * Renders a configurable number of placeholder rows.
 */

export function SkeletonRows({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden animate-pulse">
      {/* Header */}
      <div className="bg-muted/50 border-b border-border flex">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="flex-1 py-3 px-4">
            <div className="h-3 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center ${i < rows - 1 ? "border-b border-border" : ""}`}
        >
          {Array.from({ length: columns }).map((_, j) => (
            <div key={j} className="flex-1 py-4 px-4">
              <div
                className="h-3 bg-muted rounded"
                style={{ width: j === 0 ? "70%" : "50%" }}
              />
              {j === 0 && (
                <div className="h-2.5 w-[40%] bg-muted/60 rounded mt-2" />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonHeader() {
  return (
    <div className="animate-pulse space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="h-6 w-32 bg-muted rounded" />
        <div className="h-9 w-28 bg-muted rounded-lg" />
      </div>
      <div className="h-9 w-72 bg-muted/60 rounded-lg" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-7 w-16 bg-muted/40 rounded-full" />
        ))}
      </div>
    </div>
  );
}
