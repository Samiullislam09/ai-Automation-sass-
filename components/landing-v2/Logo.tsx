import { Logo as MenCraLogo } from "@/components/brand/MenCraLogo";

/** The MenCra lockup for the marketing pages (the drawing lives in components/brand/MenCraLogo.tsx). */
export function Logo({ className = "" }: { className?: string }) {
  return <MenCraLogo size={32} className={className} />;
}
