"use client";
import { useState } from "react";
import { Search, PenLine, Send, MessageSquare, ShieldCheck, Layers, Calendar, Users, Check, type LucideIcon } from "lucide-react";

type Step = { icon: LucideIcon; title: string; lead: string; body: string; mock: { tag: string; rows: string[] } };
const AUDIENCES: { id: string; label: string; steps: Step[] }[] = [
  { id: "blog", label: "Blog owners", steps: [
    { icon: Search, title: "Find what to write", lead: "Topics from real search data.", body: "The keyword agent reads your site and your search data, then proposes what to publish next. Measured numbers are always kept apart from AI suggestions.", mock: { tag: "Keyword research", rows: ["Topic picked from search data", "Measured vs AI-suggested, labelled", "Added to your plan"] } },
    { icon: PenLine, title: "Get articles in your voice", lead: "Drafts that sound like you.", body: "The writer follows your tone, links to your own pages, and passes a quality check before you ever see it. You read it, edit it or reject it.", mock: { tag: "Article writer", rows: ["Outline ready", "Links to your own pages added", "Quality gate passed"] } },
    { icon: Send, title: "Publish on schedule", lead: "Approve once. It goes live.", body: "Send approved articles to WordPress or a webhook, now or at the time you choose, and keep a record of everything that went out.", mock: { tag: "Publish", rows: ["Approved by you", "Scheduled for 9:00", "Published to WordPress"] } },
  ] },
  { id: "local", label: "Local business", steps: [
    { icon: Layers, title: "Show up where customers search", lead: "Pages for what people ask.", body: "Service pages and posts built around the questions your customers really type, written for your town, your services and your tone.", mock: { tag: "Site Brain", rows: ["Services understood", "Audience and tone learned", "Used in every article"] } },
    { icon: MessageSquare, title: "Just chat to get things done", lead: "Say it in plain words.", body: "Ask in English, Hinglish or Roman Urdu. The chat manager starts the right job and tells you what happened, no dashboards to learn.", mock: { tag: "Chat manager", rows: ["“Write about our new service”", "On it, drafting now", "Draft ready for review"] } },
    { icon: Calendar, title: "Stay consistent without effort", lead: "A steady publishing rhythm.", body: "Set the days and times once. The team prepares each piece in advance and waits for your approval, so your site never goes quiet.", mock: { tag: "Schedule", rows: ["Mon · Wed · Fri", "Prepared a day early", "Waiting for your yes"] } },
  ] },
  { id: "agency", label: "Agencies", steps: [
    { icon: Users, title: "Run many sites in one place", lead: "One workspace for every client.", body: "Connect each client's website once and manage every plan, schedule and article from a single place instead of a pile of tabs.", mock: { tag: "Workspace", rows: ["Client A · 3 drafts", "Client B · 1 waiting", "Client C · up to date"] } },
    { icon: ShieldCheck, title: "Keep clients in the loop", lead: "Nothing goes out before a yes.", body: "Every outward action waits for approval, and every decision is logged, so you always know who approved what and when.", mock: { tag: "Approvals", rows: ["Article ready", "Quality gate passed", "Waiting for approval"] } },
    { icon: Layers, title: "Scale output, not headcount", lead: "More articles, same team.", body: "Agents do the research, drafting and publishing work. Your team spends its time on strategy and client conversations.", mock: { tag: "Output", rows: ["Research done", "Drafts written", "Ready to publish"] } },
  ] },
];

function Media({ step, label }: { step: Step; label: string }) {
  return (
    <div className="relative z-[1] aspect-[609.81/394.031] w-full max-w-[609.81px] overflow-hidden rounded-[16.418px] shadow-[0_11.727px_28.145px_rgba(20,31,26,0.1)]">
      <div className="absolute inset-0 flex h-full w-full flex-col border-[1.173px] border-[#e6eae8] bg-[linear-gradient(131.98deg,#ffffff_0%,#ece9fb_73.529%)] p-6 max-md:p-4">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#ff5f57]" /><span className="h-2 w-2 rounded-full bg-[#febc2e]" /><span className="h-2 w-2 rounded-full bg-[#28c840]" />
          <span className="ml-3 rounded-md bg-[#eef3f0] px-3 py-1 text-[11px] text-[#6e726f]">{label} · {step.mock.tag}</span>
        </div>
        <div className="flex flex-1 flex-col justify-center gap-3">
          {step.mock.rows.map((r, k) => (
            <div key={r} className="flex items-center gap-3 rounded-xl border border-[#e6eae8] bg-white px-4 py-3 text-[15px] text-[#17171a] max-md:py-2.5 max-md:text-[13px]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#efecff] text-[#6a5af0]"><Check size={13} /></span>
              <span className="min-w-0 flex-1 truncate">{r}</span>
              <span className="text-[11px] text-[#9da39e]">Step {k + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Workflow() {
  const [a, setA] = useState(AUDIENCES[0].id);
  const [open, setOpen] = useState(0);
  const cur = AUDIENCES.find(x => x.id === a)!;
  const step = cur.steps[open];

  return (
    <section className="sec-workflow w-full lg:px-10">
      <div className="lv-panel mx-auto max-w-[1360px] px-20 py-[calc(100px*var(--mk-scale))] max-lg:flex max-lg:flex-col max-lg:items-center max-lg:gap-[30px] max-lg:px-4">
        <div className="relative mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[calc(40px*var(--mk-scale))] max-xl:w-auto max-xl:max-w-[1200px] max-xl:px-2 max-lg:w-full max-lg:max-w-none max-lg:gap-[30px] max-lg:px-0">
          <div className="flex w-full min-w-0 max-w-full flex-col items-center gap-0">
            <h2 className="lv-h2 text-center lg:whitespace-nowrap max-lg:max-w-[19ch] max-lg:text-balance">Research, write and publish <br className="md:hidden" />from one place.</h2>
            <p className="lv-sub mt-[calc(16px*var(--mk-scale))] max-w-[760px] text-center !text-[#6e736f] max-lg:mt-4">From everyday tasks to bigger goals, <br className="hidden max-md:inline" />here&apos;s what you can get done.</p>
            <div className="lv-noscroll relative mt-[calc(40px*var(--mk-scale))] max-w-full max-lg:w-full max-lg:overflow-x-auto">
              <div role="tablist" aria-label="Choose who you are" className="relative inline-flex gap-[2px] rounded-full border border-[#e4e7e3] bg-white p-[5px] max-lg:mx-auto max-lg:flex max-lg:w-max max-lg:p-1">
                {AUDIENCES.map(x => (
                  <button key={x.id} role="tab" aria-selected={a === x.id} onClick={() => { setA(x.id); setOpen(0); }}
                    className={`relative z-[1] whitespace-nowrap rounded-full px-[22px] py-[11px] text-[16px] font-medium leading-[21px] tracking-[-0.16px] transition-colors duration-300 max-lg:px-4 max-lg:py-[9px] max-lg:text-[14px] max-lg:leading-5 ${a === x.id ? "bg-[#0a0a0a] text-white" : "text-[#5a5e5b] hover:text-[#0a0a0a]"}`}>{x.label}</button>
                ))}
              </div>
            </div>
          </div>

          <div role="tabpanel" className="flex min-h-[465px] w-full items-stretch overflow-hidden rounded-[24px] border border-[#e7e9e6] bg-white max-lg:min-h-0 max-lg:flex-col">
            <div className="flex w-[500px] shrink-0 flex-col max-[1440px]:w-1/2 max-lg:w-full">
              {cur.steps.map((s, k) => {
                const on = open === k;
                return (
                  <div key={s.title}>
                    {k > 0 && <div className="h-px w-full bg-[#e7e9e6]" />}
                    <button type="button" aria-expanded={on} onClick={() => setOpen(k)}
                      className={`relative flex w-full items-start gap-4 px-[34px] py-[30px] text-left transition-[background] duration-300 max-lg:px-5 max-lg:py-5 ${on ? "bg-white lg:min-h-[285px] xl:h-[285px]" : "bg-[#fbfcfb] lg:h-[88px]"}`}>
                      {on && <span aria-hidden className="absolute left-0 top-0 h-full w-[3px] bg-[linear-gradient(-88.8deg,#a78bfa_4%,#6a5af0_50%,#3b82f6_96%)]" />}
                      <span className={`flex h-[28px] w-[22px] shrink-0 items-center justify-center ${on ? "text-[#17171a]" : "text-[#5f6661]"}`}><s.icon size={22} /></span>
                      <span className={`flex min-w-0 flex-1 flex-col transition-[gap] duration-300 ${on ? "gap-2" : "gap-0"}`}>
                        <span className={`text-[20px] leading-[28px] tracking-[-0.3px] max-md:text-[18px] ${on ? "font-semibold text-[#17171a]" : "font-medium text-[#5f6661]"}`}>{s.title}</span>
                        <span className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ${on ? "opacity-100 [grid-template-rows:1fr]" : "opacity-0 [grid-template-rows:0fr]"}`}>
                          <span className="block min-h-0 overflow-hidden text-[16px] font-normal leading-[27px] tracking-[-0.08px] text-[#6e726f] max-md:text-[15px] max-md:leading-[24px]">
                            <strong className="mb-1 mt-[10px] block font-medium text-[#17171a]">{s.lead}</strong>
                            <span className="block">{s.body}</span>
                            <span className="mt-4 flex justify-center lg:hidden"><Media step={s} label={cur.label} /></span>
                          </span>
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#ece9fb] px-7 py-6 max-lg:hidden">
              <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[404px] w-[548.286px] -translate-x-1/2 -translate-y-1/2">
                {[[-58.6, 71.2, 442.5, 236.5, 500.2, 28], [-39.2, 215.5, 500.2, 203.6, 538.7, 22], [115.4, -385.4, 140, 380.3, 404, -70], [317.4, -255.5, 128.2, 260.2, 288.6, -64], [-77.5, 321.3, 555.3, 160.9, 577.1, 16]].map(([l, t, w, h, lw, rot], i) => (
                  <div key={i} className="absolute" style={{ left: l, top: t, width: w, height: h }}>
                    <span className="absolute left-1/2 top-1/2 block h-[1.924px] origin-center bg-white/50" style={{ width: lw, transform: `translate(-50%,-50%) rotate(${rot}deg)` }} />
                  </div>
                ))}
              </div>
              <div key={`${a}-${open}`} className="lv-fade relative z-[1] flex w-full justify-center"><Media step={step} label={cur.label} /></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
