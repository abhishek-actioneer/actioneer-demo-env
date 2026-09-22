"use client";

/**
 * Sentinel/Actioneer logo — monochrome, theme-aware.
 * Light mode: dark icon on light container. Dark mode: light icon on dark container.
 *
 * Variants:
 * - "bare"      — just the icon, no container (for sidebar header, inline text)
 * - "contained" — icon inside a subtle rounded container (for chat avatars)
 */

interface SentinelLogoProps {
  /** Icon size in px (default 18) */
  size?: number;
  /** "bare" = icon only, "contained" = icon in bg container, "metallic" = gradient fill (default "bare") */
  variant?: "bare" | "contained" | "metallic";
  className?: string;
}

const LOGO_PATHS = [
  "M213.502 185.999H240.024V240H168.022L213.502 185.999Z",
  "M135.492 185.999H156.013V240H84.0112L135.492 185.999Z",
  "M57.4807 185.999H72.0017V240H0L57.4807 185.999Z",
  "M209.141 93.0703H239.319V169.758H166.892L209.141 93.0703Z",
  "M131.744 93.0703H158.372V169.758H85.9443L131.744 93.0703Z",
  "M48.3068 93.0703H73.1593V169.758H0.731934L48.3068 93.0703Z",
  "M203.412 0H239.319V76.6878H166.892L203.412 0Z",
  "M119.172 0H158.372V76.6878H85.9443L119.172 0Z",
  "M32.6958 0H73.1593V76.6878H0.731934L32.6958 0Z",
];

function LogoSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 241 240" fill="none" aria-hidden="true">
      {LOGO_PATHS.map((d) => (
        <path key={d.slice(0, 12)} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

function MetallicLogoSvg({ size }: { size: number }) {
  const id = "metal-grad";
  // Center of the viewBox for rotation
  const cx = 120.5;
  const cy = 120;
  return (
    <svg width={size} height={size} viewBox="0 0 241 240" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="241" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="oklch(0.70 0.005 75)" />
          <stop offset="20%" stopColor="oklch(0.35 0.003 75)" />
          <stop offset="40%" stopColor="oklch(0.85 0.008 75)" />
          <stop offset="60%" stopColor="oklch(0.30 0.003 75)" />
          <stop offset="80%" stopColor="oklch(0.80 0.006 75)" />
          <stop offset="100%" stopColor="oklch(0.40 0.003 75)" />
          <animateTransform
            attributeName="gradientTransform"
            type="rotate"
            from={`0 ${cx} ${cy}`}
            to={`360 ${cx} ${cy}`}
            dur="12s"
            repeatCount="indefinite"
          />
        </linearGradient>
      </defs>
      {LOGO_PATHS.map((d) => (
        <path key={d.slice(0, 12)} d={d} fill={`url(#${id})`} />
      ))}
    </svg>
  );
}

export function SentinelLogo({ size = 18, variant = "bare", className }: SentinelLogoProps) {
  if (variant === "contained") {
    const iconSize = Math.round(size * 0.95);
    const containerSize = Math.round(size * 1.7);
    return (
      <div
        className={`shrink-0 flex items-center justify-center rounded-md bg-muted text-foreground ${className ?? ""}`}
        style={{ width: containerSize, height: containerSize }}
      >
        <LogoSvg size={iconSize} />
      </div>
    );
  }

  if (variant === "metallic") {
    return (
      <div className={`shrink-0 ${className ?? ""}`}>
        <MetallicLogoSvg size={size} />
      </div>
    );
  }

  return (
    <div className={`shrink-0 text-foreground ${className ?? ""}`}>
      <LogoSvg size={size} />
    </div>
  );
}
