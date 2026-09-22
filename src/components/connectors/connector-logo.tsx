"use client";

import { useState } from "react";
import { Database, Smartphone, Megaphone, Plug } from "lucide-react";
import { getConnectorLogoUrl } from "@/lib/connector-logos";

const ICON_MAP: Record<string, React.ElementType> = {
  Database,
  Smartphone,
  Megaphone,
  Plug,
};

interface ConnectorLogoProps {
  name: string;
  /** Lucide icon name for fallback (e.g. "Database", "Smartphone") */
  fallbackIcon?: string;
  /** px size of the container */
  size?: number;
  className?: string;
}

export function ConnectorLogo({
  name,
  fallbackIcon = "Database",
  size = 36,
  className = "",
}: ConnectorLogoProps) {
  const logoUrl = getConnectorLogoUrl(name);
  const [imgError, setImgError] = useState(false);
  const FallbackIcon = ICON_MAP[fallbackIcon] ?? Database;
  const iconSize = Math.round(size * 0.44);

  const imgSize = size - 8; // 4px padding each side

  return (
    <div
      className={`flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, padding: 4 }}
    >
      {logoUrl && !imgError ? (
        // Use plain <img> so onError fires reliably for 400/403 responses
        // from external logo hosts (fivetran.com, brandfetch.io hotlink-block).
        // next/image proxies through /_next/image and may not propagate onError.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={name}
          width={imgSize}
          height={imgSize}
          className="object-contain"
          onError={() => setImgError(true)}
        />
      ) : (
        <FallbackIcon
          className="text-muted-foreground"
          style={{ width: iconSize, height: iconSize }}
        />
      )}
    </div>
  );
}
