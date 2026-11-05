"use client";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { BRAND } from "@/lib/brand";

/* ============================ DUMMY CONTENT ============================
 * Everything in this file is a PLACEHOLDER to show the design: the headline numbers, the
 * reviewers and their quotes are invented. Replace REVIEWS_HEADLINE and REVIEWS with real,
 * attributable customer feedback before launch (or remove the section). */
const REVIEWS_HEADLINE = ["1M+ downloads.", "15K+ reviews. And counting."];
const REVIEWS: { name: string; initials: string; role: string; quote: string; tint: string; ink: string }[] = [
  { name: "Aisha Khan", initials: "AK", role: "Blog owner", tint: "#efecff", ink: "#5242d8", quote: "Sample review. The approval step is what sold me: nothing goes live until I say yes, and the drafts already sound like my brand. Placeholder text for the design." },
  { name: "Ravi Menon", initials: "RM", role: "Agency founder", tint: "#e4f1fa", ink: "#1d5e8c", quote: "Sample review. Managing several client sites from one queue saves hours every week. This is placeholder text and will be replaced with real feedback." },
  { name: "Sara Ahmed", initials: "SA", role: "Local business owner", tint: "#fdf0e3", ink: "#9a5a12", quote: "Sample review. I just tell the chat what I need, in my own language, and it gets started. Placeholder copy for layout purposes only." },
  { name: "Daniel Brooks", initials: "DB", role: "Marketing lead", tint: "#f1ebfb", ink: "#5b3b9a", quote: "Sample review. Keyword picks come from real search data and the labels make it obvious what is measured and what is a suggestion. Placeholder." },
  { name: "Neha Verma", initials: "NV", role: "Content manager", tint: "#fbe9ee", ink: "#9a2b4d", quote: "Sample review. Publishing to WordPress on a schedule just works. Placeholder text to be replaced before launch." },
  { name: "Omar Siddiqui", initials: "OS", role: "Founder", tint: "#e6f4f4", ink: "#0f6b6b", quote: "Sample review. Setup took minutes and the first drafts were ready the same day. Placeholder text, not a real customer quote." },
  { name: "Priya Nair", initials: "PN", role: "SEO consultant", tint: "#eef1fb", ink: "#3a4a9a", quote: "Sample review. The quality gate catches things I used to fix by hand. Placeholder text for the design only." },
];

// How a card looks at each distance from the centre (same values as the reference carousel).
const SLOTS: Record<number, { x: number; s: number; o: number; b: number; p: number; z: number }> = {
  0: { x: 0, s: 1, o: 1, b: 0, p: 1, z: 5 },
  1: { x: 174, s: 0.962, o: 0.62, b: 3, p: 0.5, z: 4 },
  2: { x: 298, s: 0.928, o: 0.34, b: 4, p: 0.3, z: 3 },
};
const HIDDEN = { x: 0, s: 0.9, o: 0, b: 0, p: 0, z: 1 };

export function Testimonials() {
  const [cur, setCur] = useState(0);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const n = REVIEWS.length;
  const go = (d: number) => setCur(c => (c + d + n) % n);

  const onDown = (e: React.PointerEvent) => { start.current = e.clientX; };
  const onMove = (e: React.PointerEvent) => { if (start.current !== null) setDrag(e.clientX - start.current); };
  const onUp = () => {
    if (start.current === null) return;
    if (drag < -60) go(1); else if (drag > 60) go(-1);
    start.current = null; setDrag(0);
  };

  return (
    <section className="sec-testimonials mx-auto w-full max-w-[1440px] overflow-hidden bg-white pb-8 pt-4 md:pb-12 lg:pb-12 lg:pt-5 max-[601px]:px-4 min-[601px]:max-[901px]:px-6">
      <div className="mx-auto flex w-[760px] flex-col items-center gap-[calc(16px*var(--mk-scale))] text-center max-[901px]:w-full">
        <h2 className="lv-h2 whitespace-nowrap max-[601px]:whitespace-normal">{REVIEWS_HEADLINE[0]} <br className="min-[602px]:hidden" /><span className="max-[601px]:whitespace-nowrap">{REVIEWS_HEADLINE[1]}</span></h2>
        <p className="lv-sub !text-[#7d827e] max-[601px]:pb-4">See what people using {BRAND.name} have to say.</p>
      </div>

      <div role="region" aria-roledescription="carousel" aria-label="Customer testimonials, use arrow keys to navigate" tabIndex={0}
        onKeyDown={e => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        className="relative mt-[calc(102px*var(--mk-scale))] h-[318px] w-[1440px] cursor-grab touch-pan-y select-none outline-none min-[901px]:ml-[calc(50%-720px)] max-[901px]:left-1/2 max-[901px]:mt-8 max-[901px]:h-[386px] max-[901px]:w-full max-[901px]:origin-center max-[901px]:[transform:translateX(-50%)_scale(0.86)] max-[601px]:mt-2 max-[601px]:h-[276px] max-[601px]:[transform:translateX(-50%)_scale(0.58)]">
        {REVIEWS.map((r, i) => {
          let d = i - cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n;
          const slot = SLOTS[Math.abs(d)] ?? HIDDEN;
          const x = Math.sign(d) * slot.x;
          return (
            <article key={r.name} aria-hidden={d !== 0}
              className="absolute left-1/2 top-1/2 flex h-[410px] min-h-[410px] w-[454px] flex-col gap-[22px] overflow-hidden rounded-[24px] border border-transparent px-9 pb-[30px] pt-[34px] [background:linear-gradient(#fff,#fff)_padding-box,linear-gradient(-8.5deg,#a78bfa_4%,#6a5af0_50%,#3b82f6_96%)_border-box] max-[601px]:h-[460px] max-[601px]:min-h-[460px] max-[601px]:w-[508px] max-[601px]:gap-6 max-[601px]:px-10 max-[601px]:pb-[34px] max-[601px]:pt-[38px]"
              style={{
                transform: `translate(-50%,-50%) translateX(${x + drag * slot.p}px) scale(${slot.s})`,
                opacity: slot.o, filter: `blur(${slot.b}px)`, zIndex: slot.z, pointerEvents: slot.o === 0 ? "none" : "auto",
                boxShadow: "-20px 59px 18px rgba(0,0,0,0),-13px 38px 16px rgba(0,0,0,0.01),-7px 21px 14px rgba(0,0,0,0.05),-3px 9px 10px rgba(0,0,0,0.09),-1px 2px 6px rgba(0,0,0,0.1)",
                transition: start.current !== null ? "none" : "transform 640ms cubic-bezier(0.22,0.7,0.28,1),opacity 640ms cubic-bezier(0.22,0.7,0.28,1),filter 640ms cubic-bezier(0.22,0.7,0.28,1)",
              }}>
              <blockquote className="w-[380px] text-[18px] font-normal leading-[27px] tracking-[-0.144px] text-[#626763] max-[601px]:w-[428px] max-[601px]:text-[20px] max-[601px]:leading-[30px] max-[601px]:tracking-[-0.16px]">{r.quote}</blockquote>
              <div className="mt-auto h-px w-full bg-[#eaebea]" />
              <div className="flex items-center gap-[14px]">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[17px] font-semibold" style={{ background: r.tint, color: r.ink }}>{r.initials}</div>
                <div>
                  <strong className="block text-[18px] font-medium leading-[1.4] text-[#0a0a0a]">{r.name}</strong>
                  <div className="mt-[3px] flex items-center gap-[7px]">
                    <span className="flex items-center gap-[1px] text-[#f6b100]" aria-label="Rated 5 out of 5 stars">{[0, 1, 2, 3, 4].map(k => <Star key={k} size={15} fill="currentColor" strokeWidth={0} />)}</span>
                    <small className="text-[14px] font-normal leading-[1.5] text-[#737373]">{r.role}</small>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">Showing testimonial from {REVIEWS[cur].name}</p>
      <div className="mt-[94px] flex justify-center gap-3 max-[901px]:mt-6">
        <button type="button" aria-label="Previous testimonial" onClick={() => go(-1)} className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[#e5e5e5] bg-white text-[#0a0a0a] transition hover:scale-[1.06] active:scale-[0.96]"><ChevronLeft size={22} /></button>
        <button type="button" aria-label="Next testimonial" onClick={() => go(1)} className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[#e5e5e5] bg-white text-[#0a0a0a] transition hover:scale-[1.06] active:scale-[0.96]"><ChevronRight size={22} /></button>
      </div>
    </section>
  );
}
