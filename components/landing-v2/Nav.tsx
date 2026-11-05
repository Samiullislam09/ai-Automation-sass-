"use client";
import Link from "next/link";
import { AuthLink } from "./AuthLink";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Logo } from "./Logo";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#team", label: "Team" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQs" },
  { href: "#agencies", label: "Agencies" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="relative z-30 w-full bg-white py-3 pl-6 pr-6 max-[420px]:px-4 md:px-12 lg:fixed lg:inset-x-0 lg:top-0">
        <div className="mx-auto flex w-full max-w-[1360px] items-center max-lg:gap-3">
          <Link href="/" className="flex shrink-0 items-center"><Logo /></Link>
          <div className="flex flex-1 items-center justify-between">
            <nav className="mx-auto flex items-center gap-[44px] max-xl:gap-[32px] max-lg:hidden">
              {LINKS.map(l => (
                <a key={l.href} href={l.href} className="flex min-h-[44px] items-center text-[16px] leading-[24px] text-[#0a0a0a] transition-colors hover:text-[#5d646d]">{l.label}</a>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <AuthLink guestHref="/login" guestLabel="" authedLabel="Dashboard" className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full bg-[#262626] pl-4 pr-3 max-[380px]:h-9 max-[380px]:pl-3 max-[380px]:pr-2.5 max-[380px]:text-[13px] max-[340px]:pl-2.5 max-[340px]:pr-2 max-[340px]:text-[12px] text-[14px] font-semibold leading-5 text-[#fafafa] transition-colors hover:bg-[#3d3d3d]"><span>Login</span><ArrowRight size={18} /></AuthLink>
              <button type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#e5e5e5] max-[420px]:h-10 max-[420px]:w-10 max-[340px]:h-9 max-[340px]:w-9 lg:hidden">
                <span className="relative block h-[14px] w-[18px]">
                  <span className="absolute left-0 block h-[2px] w-full rounded bg-[#0a0a0a] transition-transform duration-200" style={{ top: open ? 6 : 0, transform: open ? "rotate(45deg)" : "none" }} />
                  <span className="absolute left-0 top-[6px] block h-[2px] w-full rounded bg-[#0a0a0a] transition-opacity duration-200" style={{ opacity: open ? 0 : 1 }} />
                  <span className="absolute left-0 block h-[2px] w-full rounded bg-[#0a0a0a] transition-transform duration-200" style={{ top: open ? 6 : 12, transform: open ? "rotate(-45deg)" : "none" }} />
                </span>
              </button>
            </div>
          </div>
        </div>
        <nav aria-label="Main menu" aria-hidden={!open}
          className={`absolute left-0 right-0 top-full flex-col overflow-hidden border-b border-[#e5e5e5] bg-white px-6 shadow-[0_12px_24px_-12px_rgba(15,15,26,0.18)] transition-all duration-300 lg:hidden ${open ? "visible max-h-[320px] opacity-100" : "invisible max-h-0 opacity-0"}`}>
          {LINKS.map(l => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex min-h-[48px] items-center border-b border-[#f2f2f2] text-[16px] font-medium text-[#0a0a0a] last:border-b-0">{l.label}</a>
          ))}
        </nav>
      </header>
      <div className="hidden h-[68px] lg:block" aria-hidden="true" />
    </>
  );
}
