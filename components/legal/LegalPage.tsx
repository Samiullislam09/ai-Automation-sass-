import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/MenCraLogo";
import { BRAND } from "@/lib/brand";

export const LEGAL_UPDATED = "16 November 2026";

/** Shared frame for Privacy, Terms and Refund: light page, the logo, a readable column, links between the three. */
export function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[#171717]" style={{ colorScheme: "light" }}>
      <header className="border-b border-[#ececec]">
        <div className="mx-auto flex max-w-[860px] items-center justify-between px-6 py-4">
          <Link href="/" aria-label={`${BRAND.name} home`}><Logo size={30} /></Link>
          <Link href="/signup" className="inline-flex h-10 items-center rounded-full bg-[#262626] px-5 text-[14px] font-medium text-white">Start free</Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[760px] px-6 pb-20 pt-12">
        <h1 className="text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] max-sm:text-[28px]">{title}</h1>
        <p className="mt-2 text-[14px] text-[#525252]">Last updated: {LEGAL_UPDATED}</p>
        <p className="mt-6 text-[16px] leading-[1.7] text-[#404040]">{intro}</p>
        <div className="legal-body mt-8 space-y-8 text-[16px] leading-[1.7] text-[#404040]">{children}</div>
        <p className="mt-12 border-t border-[#ececec] pt-6 text-[14px] text-[#525252]">
          Questions about this page? Write to <a className="font-medium text-[#5242d8] underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
        </p>
      </main>
      <footer className="border-t border-[#ececec] bg-[#fafafa]">
        <nav aria-label="Legal" className="mx-auto flex max-w-[860px] flex-wrap items-center justify-center gap-x-6 gap-y-1 px-6 py-5 text-[14px]">
          <Link className="inline-flex min-h-11 items-center text-[#525252] hover:text-[#171717]" href="/privacy">Privacy Policy</Link>
          <Link className="inline-flex min-h-11 items-center text-[#525252] hover:text-[#171717]" href="/terms">Terms &amp; Conditions</Link>
          <Link className="inline-flex min-h-11 items-center text-[#525252] hover:text-[#171717]" href="/refund">Refund Policy</Link>
          <span className="text-[#525252]">&copy; {new Date().getFullYear()} {BRAND.name}</span>
        </nav>
      </footer>
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-[21px] font-semibold leading-[1.3] tracking-[-0.01em] text-[#0a0a0a]">{children}</h2>;
}

export function UL({ items }: { items: ReactNode[] }) {
  return <ul className="list-disc space-y-1.5 pl-6">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}
