"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { PLAN } from "./plan";

/** Mobile-only floating bar at the bottom, like the reference: a Monthly / Yearly switch and a
 *  button. It slides in once the visitor scrolls past the hero and tucks away over the footer. */
export function StickyCta() {
  const [yearly, setYearly] = useState(true);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const foot = document.querySelector("footer");
      const nearFooter = foot ? foot.getBoundingClientRect().top < window.innerHeight - 40 : false;
      setShow(window.scrollY > 360 && !nearFooter);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);

  return (
    <div aria-hidden={!show}
      className={`fixed inset-x-3 bottom-[calc(16px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-[720px] rounded-full border border-[#e5e5e5] bg-white p-[6px] shadow-[0_12px_38px_-10px_rgba(16,24,40,0.28)] transition-[transform,opacity] duration-500 lg:hidden motion-reduce:transition-none ${show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-[140%] opacity-0"}`}>
      <div className="flex items-center gap-[10px]">
        <div role="group" aria-label="Choose a plan" className="relative grid min-w-0 flex-1 grid-cols-2 gap-[3px] rounded-full bg-[#eef2f5] p-1">
          <span aria-hidden className="pointer-events-none absolute bottom-1 left-1 top-1 w-[calc(50%-5.5px)] rounded-full border border-[#c4b8ff] bg-white shadow-[0_2px_8px_rgba(16,24,40,0.08)] transition-transform duration-300"
            style={{ transform: yearly ? "translateX(calc(100% + 3px))" : "none" }} />
          {[false, true].map(y => (
            <button key={String(y)} type="button" aria-pressed={yearly === y} onClick={() => setYearly(y)}
              className="relative z-[1] flex min-h-[46px] flex-col items-center justify-center gap-[2px] rounded-full px-2 py-1">
              <span className={`text-[12px] font-medium leading-[14px] ${yearly === y ? "text-[#6a5af0]" : "text-[#5d646d]"}`}>{y ? "Yearly" : "Monthly"}</span>
              <span className={`whitespace-nowrap text-[18px] font-extrabold leading-5 max-[360px]:text-[16px] ${yearly === y ? "text-[#0a0a0a]" : "text-[#8d949c]"}`}>${y ? PLAN.yearly : PLAN.monthly}</span>
            </button>
          ))}
        </div>
        <Link href="/signup" className="inline-flex h-[54px] shrink-0 items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#383840_0%,#0a0a0d_100%)] px-[18px] text-[14px] font-medium tracking-[-0.084px] text-[#fafafa] shadow-[0_4px_12px_-3px_rgba(13,13,26,0.22)] transition-colors hover:bg-[#3d3d3d] active:scale-[0.98] max-[360px]:h-12">
          Get started<ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
