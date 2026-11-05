"use client";
import Link from "next/link";
import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { PLANS } from "@/lib/store";
import { usePlan } from "./AuthLink";

/** The three plans: Free, Pro and Max.
 *
 *  Names, prices and token allowances come from the app's real plan list (lib/store.tsx PLANS,
 *  ids free / starter / growth, the same ids stored in tenants.plan).
 *
 *  - visitor        -> "Pro" is highlighted; buttons go to sign-up
 *  - signed in      -> the plan they are on is selected ("Your plan"); the others offer
 *                      Upgrade / Switch, which opens the plans on the dashboard billing page */
const ORDER = ["free", "starter", "growth"] as const;

export function Plans() {
  const { signedIn, plan } = usePlan();
  const [picked, setPicked] = useState<string>("starter");
  const current = signedIn && plan ? plan : undefined;
  const selected = current ?? picked;

  return (
    <section id="pricing" aria-labelledby="plans-h" className="sec-plans sec-testimonials mx-auto w-full max-w-[1200px] scroll-mt-[84px] px-6 max-[601px]:px-4">
      <div className="mx-auto flex max-w-[760px] flex-col items-center gap-[calc(16px*var(--mk-scale))] text-center">
        <h2 id="plans-h" className="lv-h2">Simple plans. Change anytime.</h2>
        <p className="lv-sub">Start free and upgrade when you need more. Cancel any time and keep your content.</p>
      </div>

      <div role="radiogroup" aria-label="Choose a plan" className="mt-[calc(56px*var(--mk-scale))] grid gap-5 max-lg:mx-auto max-lg:max-w-[460px] max-lg:grid-cols-1 lg:grid-cols-3 max-lg:mt-10">
        {ORDER.map(id => {
          const p = PLANS[id];
          const on = selected === id;
          const isCurrent = current === id;
          const bullets = [`${p.tokens} tokens / month`, p.tagline, "Human approval on every action"];
          const higher = current ? p.price > PLANS[current].price : false;
          return (
            <div key={id} role="radio" aria-checked={on} tabIndex={0}
              onClick={() => { if (!current) setPicked(id); }}
              onKeyDown={e => { if (!current && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setPicked(id); } }}
              className={`relative flex flex-col rounded-[28px] border bg-white p-6 shadow-[0_1px_2px_rgba(13,15,13,.04),0_18px_44px_rgba(13,15,13,.05)] transition-all duration-200 max-md:p-5 ${on ? "border-transparent shadow-[0_10px_30px_-6px_rgba(15,15,26,0.12)]" : "cursor-pointer border-[#e5e5e5] hover:-translate-y-0.5"}`}>
              {on && <span aria-hidden className="lv-ring" />}
              {(isCurrent || (!current && id === "starter")) && (
                <span className="absolute left-1/2 top-0 z-[2] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#0a0a0a] px-3 py-[3px] text-[12px] font-medium text-white shadow-[0_2px_6px_rgba(15,15,26,0.18)]">{isCurrent ? "Your plan" : "Best value"}</span>
              )}
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-[#0a0a0a]">{p.name}</h3>
                <span aria-hidden className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full ${on ? "bg-[#6a5af0]" : "border-[1.5px] border-[#b8b8be] bg-white"}`}>{on && <span className="h-[7px] w-[7px] rounded-full bg-white" />}</span>
              </div>
              <div className="mt-3 flex items-baseline gap-[6px] text-[#0a0a0a]">
                <strong className="text-[48px] font-semibold leading-[1.05] tracking-[-1.5px] max-md:text-[40px]">${p.price}</strong>
                <span className="text-[15px] text-[#737373]">/month</span>
              </div>
              <ul className="mt-5 grid flex-1 content-start gap-3 text-[15px] leading-[1.45] text-[#404040]">
                {bullets.map(b => (
                  <li key={b} className="flex items-start gap-2.5"><CircleCheck size={18} strokeWidth={1.8} className="mt-[1px] shrink-0 text-[#262626]" /><span>{b}</span></li>
                ))}
              </ul>
              {isCurrent ? (
                <span className="mt-6 flex h-11 w-full items-center justify-center rounded-full border border-[#c4b8ff] bg-[#f1eeff] text-[14px] font-medium text-[#5242d8]">Current plan ✓</span>
              ) : (
                <Link href={current ? "/dashboard/account#plans" : "/signup"}
                  className="mt-6 flex h-11 w-full items-center justify-center rounded-full bg-[linear-gradient(180deg,#383840_0%,#0a0a0d_100%)] text-[14px] font-medium tracking-[-0.084px] text-white shadow-[0_4px_12px_-3px_rgba(13,13,26,0.22)] transition hover:-translate-y-px hover:shadow-[0_10px_22px_-8px_rgba(13,13,26,0.28)] active:translate-y-0 active:scale-[0.99]">
                  {!current ? (id === "free" ? "Start free" : "Get started") : `${higher ? "Upgrade" : "Switch"} to ${p.name}`}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
