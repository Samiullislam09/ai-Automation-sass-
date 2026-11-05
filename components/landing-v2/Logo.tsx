import { BRAND } from "@/lib/brand";

/** PLACEHOLDER logo — swap for the real lockup once the brand is final. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-[linear-gradient(135deg,#a78bfa,#6a5af0_55%,#3b82f6)] text-[15px] font-bold text-white md:h-[33px] md:w-[33px]">
        {BRAND.name.charAt(0)}
      </span>
      <span className="text-[22px] font-semibold tracking-[-0.03em] text-[#0a0a0a] md:text-[24px]">{BRAND.name}</span>
    </span>
  );
}
