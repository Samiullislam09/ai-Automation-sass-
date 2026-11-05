"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { PLANS } from "@/lib/store";
import { usePlan } from "./AuthLink";

/** Mobile-only floating bar at the bottom, like the reference. It slides in once the visitor
 *  scrolls past the hero and tucks away over the footer.
 *
 *  - visitor            -> Pro / Max switch + "Get started"
 *  - signed in, Free    -> Pro / Max switch + "Buy now" (opens the plans on the dashboard)
 *  - signed in, paid    -> a single "Dashboard" button
 *  Plans and prices come from the app's real plan list (lib/store.tsx). */
const CHOICES = ["starter", "growth"] as const;

export function StickyCta() {
  const { signedIn, plan } = usePlan();
  const [pick, setPick] = useState<(typeof CHOICES)[number]>("starter");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const foot = document.querySelector("footer");
      const nearFooter = foot ? foot.getBoundingClientRect().top < window.innerHeight - 40 : false;
      setScrolled(window.scrollY > 360 && !nearFooter);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);

  // Signed in but the plan is still loading: show nothing rather than flash the wrong button.
  const loading = signedIn && plan === undefined;
  const show = scrolled && !loading;
  const paid = signedIn && plan !== undefined && plan !== "free"; // any paid plan (or an unknown one) -> just the dashboard
  const buying = signedIn && plan === "free";

  return (
    <div aria-hidden={!show}
      className={`fixed inset-x-3 bottom-[calc(16px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-[720px] rounded-full border border-[#e5e5e5] bg-white p-[6px] shadow-[0_12px_38px_-10px_rgba(16,24,40,0.28)] transition-[transform,opacity] duration-500 lg:hidden motion-reduce:transition-none ${show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-[140%] opacity-0"}`}>
      {paid ? (
        <Link href="/dashboard" className="flex h-[54px] w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#383840_0%,#0a0a0d_100%)] px-[18px] text-[15px] font-medium text-[#fafafa] shadow-[0_4px_12px_-3px_rgba(13,13,26,0.22)] transition-colors hover:bg-[#3d3d3d] active:scale-[0.98]">
          <LayoutDashboard size={18} />Dashboard
        </Link>
      ) : (
        <div className="flex items-center gap-[10px]">
          <div role="group" aria-label="Choose a plan" className="relative grid min-w-0 flex-1 grid-cols-2 gap-[3px] rounded-full bg-[#eef2f5] p-1">
            <span aria-hidden className="pointer-events-none absolute bottom-1 left-1 top-1 w-[calc(50%-5.5px)] rounded-full border border-[#c4b8ff] bg-white shadow-[0_2px_8px_rgba(16,24,40,0.08)] transition-transform duration-300"
              style={{ transform: pick === "growth" ? "translateX(calc(100% + 3px))" : "none" }} />
            {CHOICES.map(id => (
              <button key={id} type="button" aria-pressed={pick === id} onClick={() => setPick(id)}
                className="relative z-[1] flex min-h-[46px] flex-col items-center justify-center gap-[2px] rounded-full px-2 py-1">
                <span className={`text-[12px] font-medium leading-[14px] ${pick === id ? "text-[#6a5af0]" : "text-[#5d646d]"}`}>{PLANS[id].name}</span>
                <span className={`whitespace-nowrap text-[18px] font-extrabold leading-5 max-[360px]:text-[16px] ${pick === id ? "text-[#0a0a0a]" : "text-[#8d949c]"}`}>${PLANS[id].price}</span>
              </button>
            ))}
          </div>
          <Link href={buying ? "/dashboard/account#plans" : "/signup"} className="inline-flex h-[54px] shrink-0 items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#383840_0%,#0a0a0d_100%)] px-[18px] text-[14px] font-medium tracking-[-0.084px] text-[#fafafa] shadow-[0_4px_12px_-3px_rgba(13,13,26,0.22)] transition-colors hover:bg-[#3d3d3d] active:scale-[0.98] max-[360px]:h-12">
            {buying ? "Buy now" : "Get started"}<ArrowRight size={16} />
          </Link>
        </div>
      )}
    </div>
  );
}
