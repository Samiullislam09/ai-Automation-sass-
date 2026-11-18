import { BRAND } from "@/lib/brand";

/** The MenCra mark and lockup. ONE drawing, used everywhere (landing, auth, dashboard, favicon, social image).
 *
 *  The mark is a circle-shaped "M" in white on the product's violet-to-blue gradient rounded square. It is a raster (public/brand/mencra-mark-v2.png); app/icon.png, app/apple-icon.png and
 *  app/favicon.ico are made from the same drawing. */
export const MARK_GRADIENT = ["#a78bfa", "#6a5af0", "#3b82f6"] as const;

export function LogoMark({ size = 32, className = "", title }: { size?: number; className?: string; title?: string }) {
  // public/brand/mencra-mark-v2.png: 512x512, gradient rounded square with the white circle-M.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/mencra-mark-v2.png" alt={title ?? ""} width={size} height={size} className={className} aria-hidden={title ? undefined : true} style={{ display: "block", objectFit: "contain" }} />
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
