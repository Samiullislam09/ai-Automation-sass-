"use client";
import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { CATS } from "./faq-data";

export function Faq() {
  const keys = Object.keys(CATS);
  const [cat, setCat] = useState(keys[0]);
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="sec-faq mx-auto w-full max-w-[1440px] scroll-mt-[84px] bg-white px-[120px] pt-[60px] max-[601px]:px-4 max-[901px]:px-6 min-[901px]:max-[1440px]:px-10 max-[1279px]:pt-[52px]">
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[348px_minmax(0,780px)] items-start gap-[72px] max-[901px]:grid-cols-1 max-[901px]:gap-[calc(40px*var(--mk-scale))] max-[601px]:min-w-0">
        <div className="flex w-[348px] flex-col gap-[calc(16px*var(--mk-scale))] max-[901px]:w-full max-[901px]:min-w-0 max-[901px]:items-center max-[901px]:text-center">
          <h2 className="lv-h2">Got questions about <span className="lv-grad-text whitespace-nowrap">{BRAND.short}</span>?</h2>
          <p className="lv-sub !text-[#6e736f]">Find answers to commonly asked questions.</p>
          <nav role="tablist" className="lv-noscroll mt-[calc(24px*var(--mk-scale))] flex flex-col gap-1 max-[901px]:-mx-6 max-[901px]:w-[calc(100%+48px)] max-[901px]:flex-row max-[901px]:gap-2 max-[901px]:overflow-x-auto max-[901px]:px-6 max-[601px]:-mx-4 max-[601px]:w-[calc(100%+32px)] max-[601px]:px-4">
            {keys.map(k => (
              <button key={k} role="tab" aria-selected={cat === k} onClick={() => { setCat(k); setOpen(0); }}
                className={`h-[51px] rounded-[12px] py-[13px] pl-[14px] pr-[18px] text-left text-[20px] font-medium leading-[30px] transition-colors hover:bg-[#fafafa] hover:text-[#0a0a0a] max-[901px]:h-[44px] max-[901px]:w-max max-[901px]:min-w-max max-[901px]:flex-none max-[901px]:rounded-[22px] max-[901px]:border max-[901px]:px-4 max-[901px]:py-2.5 max-[901px]:text-[16px] max-[901px]:leading-[22px] max-[901px]:whitespace-nowrap ${cat === k ? "bg-[#f5f5f5] font-semibold text-[#0a0a0a] max-[901px]:border-[#a78bfa]" : "text-[#6e736f] max-[901px]:border-[#e7e8e6]"}`}>{k}</button>
            ))}
          </nav>
        </div>
        <div role="tabpanel" className="lv-fade flex w-full flex-col gap-3" key={cat}>
          {CATS[cat].map((it, k) => {
            const on = open === k;
            return (
              <article key={it.q}
                className={`h-auto overflow-hidden rounded-[16px] px-6 py-5 transition-[border-color,box-shadow] duration-[250ms] max-[601px]:px-[13px] max-[601px]:py-[11px] ${on
                  ? "border-[1.5px] border-transparent shadow-[0_10px_24px_-6px_rgba(15,23,20,0.1)] [background:linear-gradient(#fff,#fff)_padding-box,linear-gradient(-8.5deg,#a78bfa_4%,#6a5af0_50%,#3b82f6_96%)_border-box]"
                  : "border border-[#e7e8e6] bg-white shadow-[0_4px_12px_-3px_rgba(15,23,20,0.06)]"}`}>
                <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : k)} className="flex h-10 w-full items-center justify-between text-left text-[#0a0a0a]">
                  <span className="text-[20px] font-semibold leading-[1.4] tracking-[-0.24px] max-[601px]:text-[16px]">{it.q}</span>
                  <span aria-hidden className="relative flex h-10 w-10 shrink-0 items-center justify-center text-[#5a5e5b]">{on ? <Minus size={20} /> : <Plus size={20} />}</span>
                </button>
                <div role="region" className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-[360ms] ${on ? "opacity-100 [grid-template-rows:1fr]" : "opacity-0 [grid-template-rows:0fr]"}`}>
                  <div className="overflow-hidden"><p className="lv-body pt-[14px]">{it.a}</p></div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
