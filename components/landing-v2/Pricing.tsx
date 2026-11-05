"use client";
import Link from "next/link";
import { useState } from "react";
import { Check, ShieldCheck, PenLine, Search, Share2, KeyRound, CalendarClock, Palette, Mail, BarChart3, UserRound, Building2, Megaphone, TriangleAlert, CircleCheck, Image as ImageIcon, LayoutTemplate, Link2, Users, type LucideIcon } from "lucide-react";

import { PLAN } from "./plan";
/* ===== PLACEHOLDERS: prices live in ./plan.ts, tool costs below. ===== */
/* Illustrative monthly costs of doing it the usual way. NOT measured data. */
const TOOLS: { id: string; label: string; cost: number; icon: LucideIcon; color: string }[] = [
  { id: "writer", label: "Freelance writer", cost: 400, icon: PenLine, color: "#7c5cff" },
  { id: "seo", label: "SEO specialist", cost: 300, icon: Search, color: "#2563eb" },
  { id: "social", label: "Social media manager", cost: 250, icon: Share2, color: "#e1306c" },
  { id: "kw", label: "Keyword tool", cost: 99, icon: KeyRound, color: "#d97706" },
  { id: "sched", label: "Scheduling tool", cost: 29, icon: CalendarClock, color: "#0891b2" },
  { id: "design", label: "Graphic designer", cost: 200, icon: Palette, color: "#db2777" },
  { id: "email", label: "Email tool", cost: 49, icon: Mail, color: "#ea580c" },
  { id: "analytics", label: "Analytics tool", cost: 50, icon: BarChart3, color: "#16a34a" },
  { id: "va", label: "Virtual assistant", cost: 350, icon: UserRound, color: "#4f46e5" },
  { id: "agency", label: "Content agency", cost: 800, icon: Building2, color: "#0f766e" },
  { id: "copy", label: "Copywriter", cost: 350, icon: Megaphone, color: "#c026d3" },
  { id: "stock", label: "Stock images", cost: 29, icon: ImageIcon, color: "#0284c7" },
  { id: "lp", label: "Landing page builder", cost: 39, icon: LayoutTemplate, color: "#65a30d" },
  { id: "links", label: "Link building", cost: 250, icon: Link2, color: "#9333ea" },
  { id: "community", label: "Community manager", cost: 300, icon: Users, color: "#e11d48" },
];
const INCLUDED: [string, string][] = [
  ["Keyword research", " from real search data"],
  ["Articles", " in your tone, with links to your own pages"],
  ["Approval", " on every action, every decision logged"],
  ["Chat manager", " in English, Hinglish or Roman Urdu"],
  ["Publishing", " to WordPress or a webhook"],
  ["Site Brain", " that learns your services and audience"],
];

export function Pricing() {
  const [sel, setSel] = useState<string[]>(["writer", "seo", "kw"]);
  const [yearly, setYearly] = useState(true);
  const chosen = TOOLS.filter(t => sel.includes(t.id));
  const total = chosen.reduce((s, t) => s + t.cost, 0);
  const n = chosen.length;
  const yearlyPerYear = PLAN.yearly, monthlyPerYear = PLAN.monthly * 12;
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  return (
    <section id="pricing" className="sec-pricing relative mx-auto w-full max-w-[1440px] scroll-mt-[84px] text-[#0a0a0a] max-lg:pb-9">
      <div className="absolute inset-x-[40px] inset-y-0 max-w-[1360px] overflow-hidden rounded-t-[60px] bg-[linear-gradient(180deg,#efecff_-86.7%,#fff_49.1%)] max-[901px]:rounded-t-[32px] max-lg:inset-x-0" />
      <div className="absolute inset-x-[40px] top-0 h-[733px] w-auto max-w-[1360px] overflow-hidden rounded-[44px] opacity-50 max-lg:inset-x-0 max-lg:w-full"
        style={{ background: "linear-gradient(180deg,rgba(255,255,255,0) 63.165%,#fff 100%),radial-gradient(ellipse 680px 366.5px at 612px -73.3px,rgba(255,255,255,0.5) 0%,rgba(255,255,255,0) 100%),radial-gradient(ellipse 544px 293.2px at 40.8px 696.35px,rgba(139,108,255,0.8) 0%,rgba(139,108,255,0) 100%),radial-gradient(ellipse 612px 329.85px at 54.4px 58.64px,rgba(196,181,253,0.95) 0%,rgba(196,181,253,0) 100%),radial-gradient(ellipse 816px 439.8px at 1196.8px 183.25px,rgba(99,140,250,0.9) 0%,rgba(99,140,250,0) 100%),#a99cf6" }} />

      <div className="relative z-[2] mx-auto w-[1200px] max-w-[calc(100%-48px)] pb-[100px] pt-[100px] max-lg:w-full max-lg:max-w-none max-lg:pb-7 max-lg:pt-8">
        <div className="mx-auto flex w-[773px] max-w-full flex-col items-center gap-[14px] text-center max-lg:w-[min(440px,calc(100%-32px))] max-lg:gap-3">
          <h2 className="text-[48px] font-medium leading-[1.06] tracking-[-0.96px] max-lg:text-[28px] max-lg:leading-[1.18]">The best value in marketing</h2>
          <p className="w-[773px] max-w-full text-[20px] font-normal leading-[normal] max-lg:w-full max-lg:max-w-[370px] max-lg:text-[15px] max-lg:leading-[1.5]">One subscription replaces the freelancers and tools you pay for today.</p>
        </div>

        <div className="mx-auto mt-9 flex w-[1200px] max-w-full items-stretch gap-3 max-lg:flex-col max-lg:px-4">
          {/* LEFT: what you pay today */}
          <div className="flex w-[424px] flex-[0_0_424px] flex-col rounded-[24px] border-[1.2px] border-[#f0e3db] bg-white p-4 shadow-[0_20px_44px_-10px_rgba(209,77,51,0.09),0_4px_12px_rgba(77,51,38,0.05)] max-lg:w-full max-lg:flex-none">
            <div className="flex items-center justify-between">
              <span className="inline-flex h-[34px] items-center gap-2 rounded-full border border-[#ffd3d3] bg-white py-2 pl-[14px] pr-4 text-[12px] font-semibold uppercase tracking-[0] text-[#ce3b27]"><TriangleAlert size={15} />What you pay today</span>
              <span className="text-[11px] font-medium uppercase tracking-[1.2px] text-[#a98a7c]"><strong className="font-semibold text-[#3a2a24]">{n}</strong> {n === 1 ? "tool" : "tools"}</span>
            </div>
            <p className="mt-3 text-[15px] font-medium text-[#3a2a24]">What do you pay for today?</p>
            <div className="mt-7 flex flex-wrap justify-center gap-[9px]">
              {TOOLS.map(t => {
                const on = sel.includes(t.id);
                return (
                  <button key={t.id} type="button" aria-pressed={on} aria-label={t.label} onClick={() => toggle(t.id)}
                    className={`relative flex aspect-square h-[60px] w-[60px] flex-[0_0_60px] items-center justify-center rounded-[15px] bg-white p-0 transition-all ${on ? "border-[1.6px] border-[#6a5af0] bg-white shadow-[0_4px_12px_rgba(106,90,240,0.18)]" : "border-[1.6px] border-[#f0e8e1] !bg-[#f8f5f2] hover:!bg-[#f3eee9]"}`}>
                    <t.icon size={26} style={{ color: on ? t.color : "#a7a29d" }} className={on ? "" : "opacity-60"} />
                    {on && <span className="absolute -right-1 -top-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-[#0a0a0a] text-white"><Check size={11} strokeWidth={3} /></span>}
                  </button>
                );
              })}
            </div>
            <div className="relative mt-4 flex min-h-0 flex-[1_1_auto] flex-col">
              <div className="flex min-h-0 flex-[1_1_0] flex-col overflow-y-auto pr-[14px] [scrollbar-gutter:stable] [scrollbar-width:thin]">
                {chosen.map(t => (
                  <div key={t.id} className="flex items-center gap-3 py-[10px] [&+&]:border-t [&+&]:border-t-[#f1eae2]">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-[#f0dcd4] bg-white"><t.icon size={17} style={{ color: t.color }} /></span>
                    <div className="flex min-w-0 flex-1 flex-col"><span className="text-[15.5px] font-medium text-[#4a3830]">{t.label}</span></div>
                    <strong className="whitespace-nowrap text-[15.5px] font-semibold text-[#3a2a24]">${t.cost}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 flex min-h-[85px] items-center justify-between gap-3 rounded-[18px] border border-[#ffd3d3] bg-transparent p-5">
              <div className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-[17px] font-semibold text-[#3a2a24]">Total</span>
                <small className="text-[12.5px] text-[#a98a7c]">{n} separate {n === 1 ? "tool" : "tools"} · {n} {n === 1 ? "bill" : "bills"} to track</small>
              </div>
              <strong className="shrink-0 whitespace-nowrap text-[34px] font-semibold tracking-[-0.6px] text-[#d6402e]">${total}<small className="text-[14px] font-medium text-[rgba(214,64,46,0.7)]">/month</small></strong>
            </div>
          </div>

          <div className="grid h-[38px] w-[38px] flex-[0_0_38px] place-items-center self-center rounded-full bg-[linear-gradient(90deg,#a78bfa_4%,#6a5af0_50%,#3b82f6_96%)] text-[16px] font-medium leading-[1.5] text-white shadow-[0_4px_12px_-3px_rgba(13,13,26,0.22)]" aria-hidden>VS</div>

          {/* RIGHT: the plan */}
          <article className="group relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] bg-white p-[9px] shadow-[0_10px_30px_-6px_rgba(15,15,26,0.1),0_2px_6px_rgba(15,15,26,0.05)]">
            <span aria-hidden className="lv-ring z-[1]" />
            <div role="radiogroup" aria-label="Choose how to pay" className="grid grid-cols-2 items-stretch gap-3 p-1 pt-[12px] max-[1279px]:gap-2">
              {[false, true].map(y => {
                const on = yearly === y;
                return (
                  <button key={String(y)} type="button" role="radio" aria-checked={on} onClick={() => setYearly(y)}
                    className={`relative flex min-w-0 cursor-pointer flex-col rounded-[18px] border-2 border-transparent p-4 text-left transition-colors duration-200 max-[1279px]:p-3 ${on ? "bg-[#f1eeff]" : "bg-[#efeff1] hover:bg-[#e8e8eb]"}`}>
                    {on && <span aria-hidden className="pointer-events-none absolute -inset-[2px] rounded-[18px] p-[2px] lv-ring" />}
                    {y && <span className="absolute left-1/2 top-0 z-[2] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#0a0a0a] px-3 py-[3px] text-[12px] font-medium text-white shadow-[0_2px_6px_rgba(15,15,26,0.18)]">Save ${monthlyPerYear - yearlyPerYear}</span>}
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[16px] font-semibold leading-[1.5] tracking-[-0.096px] text-[#111114]">{y ? "Pay once a year" : "Pay monthly"}</h3>
                      <span aria-hidden className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full ${on ? "bg-[#6a5af0]" : "border-[1.5px] border-[#b8b8be] bg-white"}`}>{on && <span className="h-[7px] w-[7px] rounded-full bg-white" />}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-baseline gap-x-[6px] text-[#111114]">
                      <strong className="text-[40px] font-semibold leading-[1.05] tracking-[-1.28px] max-[1279px]:text-[32px] max-[1279px]:tracking-[-1.02px]">${y ? PLAN.yearly : PLAN.monthly}</strong>
                      <span className="text-[14px] leading-[1.5] text-[#3c3c44]">{y ? "/year" : "/month"}</span>
                      {y && <s className="text-[15px] leading-[1.5] text-[#8a8a92]">${monthlyPerYear}</s>}
                    </div>
                    <p className="mt-2 text-[14px] leading-[1.5] tracking-[-0.07px] text-[#3c3c44]">{y ? `Just $${Math.round(PLAN.yearly / 12)}/month, billed yearly` : `That's $${monthlyPerYear} a year`}</p>
                  </button>
                );
              })}
            </div>

            <div className="px-1">
              <div className="mt-3 flex items-center gap-[12px] rounded-[16px] bg-[#efecff] px-[16px] py-[14px]">
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                  <span aria-hidden className="absolute -inset-1.5 rounded-[16px] bg-[radial-gradient(circle_at_center,rgba(106,90,240,0.5),transparent_70%)] [animation:lv-halo_2.2s_ease-in-out_infinite] motion-reduce:animate-none" />
                  <span className="relative flex h-11 w-11 items-center justify-center rounded-[12px] bg-white text-[#6a5af0] ring-1 ring-[#c4b8ff] shadow-[0_5px_12px_-2px_rgba(106,90,240,0.45),0_0_0_4px_rgba(106,90,240,0.14)] transition-[scale] duration-200 ease-out group-hover:scale-[1.08]"><ShieldCheck size={22} /></span>
                </span>
                <span className="flex min-w-0 flex-col gap-[3px]">
                  <span className="min-w-0 text-[16px] font-semibold leading-[1.3] tracking-[-0.3px] text-[#0a0a0a] max-[400px]:text-[15px]">You approve <span className="text-[19px] font-bold tracking-[-0.4px] text-[#6a5af0]">every</span> action</span>
                  <span className="text-[13px] leading-[1.35] tracking-[-0.1px] text-[#4A5550]">Nothing is published <span className="font-semibold text-[#6a5af0]">without your yes</span></span>
                </span>
              </div>
            </div>

            <div className="p-4 pt-3">
              {INCLUDED.map(([a, b]) => (
                <div key={a} className="border-b border-[#E5E5E5] last:border-b-0">
                  <div className="relative flex min-h-[52px] items-center py-[9px]">
                    <span className="flex min-w-0 items-center gap-2.5 text-[16px] leading-[1.4] text-[#0a0a0a] max-[380px]:text-[15px]">
                      <CircleCheck size={20} strokeWidth={1.8} className="shrink-0 text-[#262626]" />
                      <span className="min-w-0"><span>{a}</span><span className="text-[#737373]">{b}</span></span>
                    </span>
                  </div>
                </div>
              ))}
              <Link href="/signup" className="mt-4 flex h-10 w-full items-center justify-center rounded-full bg-[linear-gradient(180deg,#383840_0%,#0a0a0d_100%)] text-[14px] font-medium tracking-[-0.084px] text-white shadow-[0_4px_12px_-3px_rgba(13,13,26,0.22)] transition hover:-translate-y-px hover:shadow-[0_10px_22px_-8px_rgba(13,13,26,0.28)] active:translate-y-0 active:scale-[0.99]">Get started</Link>
            </div>
          </article>
        </div>

        <div className="mx-auto mt-6 flex w-[1200px] max-w-full items-stretch gap-3 max-lg:mt-4 max-lg:px-4">
          <div className="w-[424px] flex-[0_0_424px] max-lg:hidden" aria-hidden />
          <div className="h-[38px] w-[38px] flex-[0_0_38px] max-lg:hidden" aria-hidden />
          <p className="min-w-0 flex-1 self-center text-center text-[13px] font-normal leading-[1.5] text-[#737373]">Prices shown are placeholders. Costs on the left are typical estimates, not measured data.</p>
        </div>
      </div>
    </section>
  );
}
