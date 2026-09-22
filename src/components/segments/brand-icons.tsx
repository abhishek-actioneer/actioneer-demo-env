/** Brand SVG icons for integration destinations, rendered at small sizes */

export function SalesforceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M10.05 5.1a4.49 4.49 0 0 1 3.3-1.4c1.72 0 3.22.97 3.99 2.39a5.04 5.04 0 0 1 2.16-.49c2.76 0 5 2.24 5 5s-2.24 5-5 5c-.39 0-.77-.04-1.13-.13a4.49 4.49 0 0 1-4.02 2.48c-.72 0-1.4-.17-2-.47a4.99 4.99 0 0 1-4.35 2.57c-2.21 0-4.08-1.44-4.74-3.43A4.24 4.24 0 0 1 0 12.35c0-2.35 1.9-4.25 4.25-4.25.43 0 .84.06 1.23.18A4.99 4.99 0 0 1 10.05 5.1z"
        fill="#00A1E0"
      />
    </svg>
  );
}

export function CleverTapIcon({ className }: { className?: string }) {
  // Real CleverTap brand logo (stored locally at /public/logos/clevertap.jpeg).
  // Use rounded corners so it sits cleanly alongside other icons at small sizes.
  return (
    <img
      src="/logos/clevertap.jpeg"
      alt="CleverTap"
      className={`rounded-sm ${className ?? ""}`}
      draggable={false}
    />
  );
}

export function KlaviyoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 3L2 21h20L12 3z"
        fill="#2DB77B"
      />
      <path
        d="M12 10l-4 7h8l-4-7z"
        fill="white"
      />
    </svg>
  );
}

export function MetaAdsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.2-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.37.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"
        fill="#0081FB"
      />
    </svg>
  );
}

export function BigQueryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 3h12l6 6v6l-6 6H6l-6-6V9l6-6z" fill="#4285F4" />
      <path
        d="M12 8a4 4 0 1 0 2.83 6.83l1.88 1.88a.75.75 0 0 0 1.06-1.06l-1.88-1.88A4 4 0 0 0 12 8zm0 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"
        fill="white"
      />
    </svg>
  );
}

export function FirebaseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5.24 17.54l1.62-15.1a.5.5 0 0 1 .94-.17l1.7 3.18L5.24 17.54z" fill="#FFA000" />
      <path d="M13.95 10.61L11.88 6.67l-6.64 10.87 8.71-6.93z" fill="#F57F17" />
      <path d="M18.76 17.54L17.38 4.24a.5.5 0 0 0-.87-.23l-12.27 13.53 6.28 3.56a1.5 1.5 0 0 0 1.48 0l6.76-3.56z" fill="#FFCA28" />
      <path d="M5.24 17.54L9.5 5.45l-1.7-3.18a.5.5 0 0 0-.94.17L5.24 17.54z" fill="#FFA000" />
    </svg>
  );
}

/** Registry of brand icons by destination ID */
export const BRAND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  salesforce: SalesforceIcon,
  clevertap: CleverTapIcon,
  klaviyo: KlaviyoIcon,
  "meta-ads": MetaAdsIcon,
  bigquery: BigQueryIcon,
  firebase: FirebaseIcon,
};

/** Human-readable label per destination ID */
export const DESTINATION_LABELS: Record<string, string> = {
  salesforce: "Salesforce",
  clevertap: "CleverTap",
  klaviyo: "Klaviyo",
  "meta-ads": "Meta Ads",
  bigquery: "BigQuery",
  firebase: "Firebase",
};
