import { AuthLink } from "./AuthLink";
import { Check, FileText, Search, Send, ShieldCheck } from "lucide-react";
import { BRAND } from "@/lib/brand";

const BG =
  "radial-gradient(1224px 363.6px at 1264.8px 24.24px,rgba(59,130,246,0.16) 0%,rgba(59,130,246,0.05) 50%,rgba(59,130,246,0) 100%),radial-gradient(1088px 323.2px at 625.6px 424.2px,rgba(139,108,255,0.1) 0%,rgba(139,108,255,0) 100%),radial-gradient(1292px 383.8px at 136px 371.68px,rgba(106,90,240,0.2) 0%,rgba(106,90,240,0.06) 55%,rgba(106,90,240,0) 100%),#131619";

const ROWS: [typeof FileText, string, string][] = [
  [Search, "Keyword picked", "From real search data"],
  [FileText, "Draft written", "In your brand's tone"],
  [ShieldCheck, "Quality gate passed", "Ready for your review"],
  [Send, "Published", "To your website"],
];

export function Closing() {
  return (
    <section id="agencies" className="sec-closing mx-auto flex w-full max-w-[1440px] items-center justify-center px-10 max-[601px]:px-2 min-[601px]:max-[901px]:px-6">
      <div className="relative w-[1360px] max-w-full overflow-hidden rounded-[36px] border border-white/[0.06] pb-0 pt-[47px] min-[768px]:pt-[71px] min-[902px]:h-[404px] min-[902px]:pt-0 max-[901px]:flex max-[901px]:h-auto max-[901px]:min-h-0 max-[901px]:flex-col max-[601px]:rounded-[24px]" style={{ background: BG }}>
        <div className="relative h-[352px] w-full overflow-hidden min-[902px]:h-full max-[901px]:h-auto max-[901px]:overflow-visible">
          <div className="absolute left-[59px] top-[calc(50%-26px)] z-[2] flex w-[404px] -translate-y-1/2 flex-col gap-10 min-[902px]:top-1/2 max-[901px]:static max-[901px]:w-full max-[901px]:translate-y-0 max-[901px]:items-center max-[901px]:px-10 max-[901px]:text-center max-[601px]:gap-5 max-[601px]:px-5">
            <div className="flex flex-col gap-[calc(16px*var(--mk-scale))] min-[902px]:gap-[27px] max-[901px]:w-full max-[901px]:items-center">
              <div className="flex items-center gap-[10px] max-[901px]:justify-center max-[601px]:gap-[9px]">
                <span className="grid h-[22px] w-[22px] place-items-center rounded-md bg-[linear-gradient(135deg,#a78bfa,#3b82f6)] text-[12px] font-bold text-white">{BRAND.name.charAt(0)}</span>
                <p className="text-[16px] font-medium leading-[1.2] text-[#8e8e88] max-[601px]:text-[15px]"><span className="text-[#ecece4]">{BRAND.name} </span>for Agencies</p>
              </div>
              <h2 className="flex w-[440px] flex-col text-[46px] font-semibold leading-[1.12] tracking-[-0.92px] text-[#f4f4f0] max-[901px]:w-full max-[901px]:items-center max-[901px]:text-[length:var(--mk-h2)] max-[601px]:text-[25px] max-[601px]:leading-[1.2] max-[601px]:tracking-[0] min-[601px]:max-lg:text-[36px] min-[601px]:max-lg:leading-[1.06] min-[601px]:max-lg:tracking-[-0.72px]">
                <span className="whitespace-nowrap">Run every client&apos;s</span>
                <span className="whitespace-nowrap">content in one place</span>
              </h2>
              <div className="flex items-center gap-[34px] min-[902px]:mt-px max-[901px]:w-full max-[901px]:justify-center max-[601px]:flex-wrap max-[601px]:gap-x-5 max-[601px]:gap-y-2">
                {["One approval queue", "Every action logged"].map(t => (
                  <p key={t} className="flex items-center gap-[10px] whitespace-nowrap text-[15px] font-normal text-[#c9c9c1] max-[601px]:gap-2 max-[601px]:text-[14px]"><Check size={16} className="text-[#a78bfa]" />{t}</p>
                ))}
              </div>
            </div>
            <AuthLink guestHref="/signup" guestLabel="Get started" authedLabel="Go to dashboard" className="inline-flex h-[58px] w-[403px] min-w-[403px] max-w-[403px] items-center justify-center rounded-full bg-[linear-gradient(90deg,#6a5af0_0%,#a78bfa_100%)] text-[20px] font-medium text-white min-[768px]:max-[901px]:w-[min(403px,100%)] max-[901px]:min-w-0 max-[767px]:mx-auto max-[767px]:w-full max-[767px]:max-w-none max-[601px]:h-12 max-[601px]:text-[16px]" />
          </div>

          {/* product preview */}
          <div aria-hidden className="absolute left-[590px] top-[50.78px] flex w-[789px] items-start gap-[12.7px] rounded-[21px] bg-white/10 p-[12.7px] max-[901px]:hidden">
            <div className="h-[445px] w-[237px] shrink-0 rounded-[19px] border border-white/[0.07] bg-[#1f2023] p-5">
              <p className="mb-4 text-[14px] font-medium text-[#ecece4]">{BRAND.short}</p>
              {["Home", "Content", "Approvals", "Schedule", "Reports", "Site Brain"].map((l, i) => (
                <div key={l} className={`mb-1.5 rounded-lg px-3 py-2 text-[13px] ${i === 2 ? "bg-white/10 text-white" : "text-[#8e8e88]"}`}>{l}</div>
              ))}
            </div>
            <div className="flex w-[534px] flex-col gap-[12.7px]">
              <div className="rounded-[19px] border border-white/[0.07] bg-[#151513] p-5">
                <p className="mb-3 text-[14.8px] font-medium text-[#ecece4]">Latest activity</p>
                <div className="grid gap-2.5">
                  {ROWS.map(([Icon, t, d]) => (
                    <div key={t} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-4 py-3">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#2a2552] text-[#a78bfa]"><Icon size={16} /></span>
                      <div className="min-w-0"><p className="text-[14px] font-medium text-white">{t}</p><p className="text-[12px] text-[#8e8e88]">{d}</p></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[19px] border border-white/[0.07] bg-[#151513] p-5">
                <p className="text-[14.8px] font-medium text-[#ecece4]">Waiting for approval</p>
                <p className="mt-1 text-[12.7px] text-[#8e8e88]">Nothing goes live until you say yes.</p>
                <div className="mt-3 flex gap-2"><span className="rounded-full bg-[#a78bfa] px-4 py-1.5 text-[12px] font-semibold text-[#0a0a0a]">Approve</span><span className="rounded-full bg-white/10 px-4 py-1.5 text-[12px] text-[#ecece4]">Edit</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
