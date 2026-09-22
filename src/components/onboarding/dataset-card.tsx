"use client";

interface DatasetCardProps {
  id: string;
  name: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  /** Optional industry/category label shown as a chip next to the name (e.g. "Gaming", "Finance"). */
  category?: string;
}

export function DatasetCard({ name, description, selected, onClick, category }: DatasetCardProps) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all duration-150 ${
        selected
          ? "border-[#18181b] bg-white"
          : "border-[#e4e4e7] bg-white hover:border-[#a1a1aa]"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[12.6px] font-medium text-[#18181b]">{name}</span>
        {category && (
          <span className="text-[9px] px-1.5 py-0.5 rounded border border-[#e4e4e7] text-[#71717a] font-medium">
            {category}
          </span>
        )}
      </div>
      <p className="text-[10.8px] text-[#71717a] leading-relaxed">{description}</p>
    </button>
  );
}
