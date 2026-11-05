import { Search, PenLine, ShieldCheck, Send } from "lucide-react";
import { BRAND } from "@/lib/brand";

/** Sits where the reference shows its customer-logo strip. We have no customers to show yet,
 *  so it states four things the product really does instead. */
const ITEMS = [
  { icon: Search, label: "Real search data", color: "#2563eb" },
  { icon: PenLine, label: "Your brand's tone", color: "#7c5cff" },
  { icon: ShieldCheck, label: "Approval on every step", color: "#2fb574" },
  { icon: Send, label: "WordPress ready", color: "#21759B" },
];

export function ValueStrip() {
  return (
    <section aria-label={`Why teams choose ${BRAND.short}`} className="flex h-[196px] flex-col items-center justify-center gap-7 px-4 max-md:h-[150px] max-md:gap-5">
      <p className="text-[18px] leading-[1.5] text-[#737373] max-md:text-[15px]">Why teams choose {BRAND.short}</p>
      <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-3 max-md:gap-x-5 max-md:gap-y-2">
        {ITEMS.map(it => (
          <span key={it.label} className="inline-flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.02em] text-[#0a0a0a] max-md:text-[14px]">
            <it.icon size={24} style={{ color: it.color }} className="max-md:h-[18px] max-md:w-[18px]" />{it.label}
          </span>
        ))}
      </div>
    </section>
  );
}
