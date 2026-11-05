import Link from "next/link";
import { BRAND } from "@/lib/brand";

const LINKS: [string, string][] = [
  ["Features", "#features"], ["Pricing", "#pricing"], ["FAQs", "#faq"],
  ["Privacy Policy", "/privacy"], ["Terms & Conditions", "/terms"], ["Refund Policy", "/refund"],
];

export function Footer() {
  return (
    <footer className="sec-footer rounded-t-[40px] rounded-b-none border-t border-[#e5e5e5] bg-gradient-to-b from-white to-[#f5f5f5] px-10 pb-10 pt-[41px] text-[#0a0a0a] max-[1279px]:py-8 max-lg:px-6 max-[767px]:rounded-t-[32px] max-[767px]:py-6 max-[600px]:px-4 max-lg:pb-28">
      <div className="mx-auto max-w-[1360px]">
        <div className="flex flex-col items-center">
          <p className="text-center text-[18px] font-medium leading-[1.5]">Ready to start?</p>
          <div className="mt-3 flex items-center justify-center gap-4">
            <Link href="/signup" className="inline-flex h-11 items-center justify-center rounded-full bg-[#262626] px-5 text-[14px] font-semibold text-[#fafafa] transition-colors hover:bg-[#3d3d3d]">Start free</Link>
            <Link href="/login" className="inline-flex h-11 items-center justify-center rounded-full border border-[#e5e5e5] bg-white px-5 text-[14px] font-semibold text-[#0a0a0a] transition-colors hover:bg-[#fafafa]">Log in</Link>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-1 gap-y-2 max-[1279px]:mt-8 max-[767px]:mt-6">
          {LINKS.map(([t, h]) => (
            <Link key={t} href={h} className="inline-flex min-h-11 items-center justify-center px-4 py-2 text-[14px] font-medium leading-[1.5] text-[#737373] transition-colors hover:text-[#0a0a0a] max-[1279px]:px-3 max-[1279px]:py-1.5">{t}</Link>
          ))}
        </div>

        <div className="mt-10 w-full space-y-3 text-center max-[1279px]:mt-8 max-[767px]:mt-6">
          <p className="text-[11px] leading-[1.6] text-[#737373]">© {new Date().getFullYear()} {BRAND.name}. All rights reserved. Contact: <a href={`mailto:${BRAND.supportEmail}`} className="text-[#737373] underline underline-offset-2 hover:text-[#0a0a0a]">{BRAND.supportEmail}</a></p>
        </div>

        <div aria-hidden className="select-none overflow-hidden pt-8 text-center text-[clamp(56px,15vw,220px)] font-semibold leading-[0.9] tracking-[-0.04em] text-[#f6f6f6]">{BRAND.short}</div>
      </div>
    </footer>
  );
}
