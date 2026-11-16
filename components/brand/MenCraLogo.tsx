import { BRAND } from "@/lib/brand";

/** The MenCra mark and lockup. ONE drawing, used everywhere (landing, auth, dashboard, favicon, social image).
 *
 *  The mark is an "M" built as two rising peaks — growth, steady and upward — with a four-point spark beside the right peak:
 *  the AI that does the work. It sits on a rounded square in the product's violet-to-blue gradient and reads at 16 px
 *  (the browser tab) as well as at 512 px. The same geometry is in public/brand/mencra-mark.svg and app/icon.svg. */
export const MARK_GRADIENT = ["#a78bfa", "#6a5af0", "#3b82f6"] as const;

export function LogoMark({ size = 32, className = "", title }: { size?: number; className?: string; title?: string }) {
  const id = `mc-g-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={id} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={MARK_GRADIENT[0]} />
          <stop offset="0.55" stopColor={MARK_GRADIENT[1]} />
          <stop offset="1" stopColor={MARK_GRADIENT[2]} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path d="M8.5 23.5V11.5L16 19l7.5-7.5v12" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M26 2.8Q26 5.8 29 5.8Q26 5.8 26 8.8Q26 5.8 23 5.8Q26 5.8 26 2.8Z" fill="#fff" />
    </svg>
  );
}

/** Mark + wordmark. `tone` is the wordmark colour: "dark" on light surfaces, "light" on dark ones. */
export function Logo({ size = 30, tone = "dark", className = "", showName = true }: { size?: number; tone?: "dark" | "light"; className?: string; showName?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      {showName ? (
        <span className="font-semibold leading-none tracking-[-0.03em]" style={{ fontSize: Math.round(size * 0.76), color: tone === "dark" ? "#0a0a0a" : "#f5f5fa" }}>
          Men<span style={{ color: tone === "dark" ? "#5242d8" : "#b4a8ff" }}>Cra</span>
        </span>
      ) : (
        <span className="sr-only">{BRAND.name}</span>
      )}
    </span>
  );
}
