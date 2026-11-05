import { Search, PenLine, ShieldCheck, MessageSquare, Brain, Check, type LucideIcon } from "lucide-react";

type F = { icon: LucideIcon; title: string; body: string; lines: string[]; tag: string };
const F: F[] = [
  { icon: Search, title: "Keyword research", body: "Topics are chosen from real search data, never guessed. Measured numbers are always kept apart from AI suggestions, so you know exactly what is real.", tag: "Mr. Keyword", lines: ["solar panel cost: measured", "net metering rules: measured", "best inverter: AI-suggested"] },
  { icon: PenLine, title: "Articles in your voice", body: "Drafts follow your brand's tone and link to your own pages, then pass a quality check before they ever reach you for approval.", tag: "Mr. Writer", lines: ["Outline ready", "Links to your pages added", "Draft written"] },
  { icon: ShieldCheck, title: "Approval on every action", body: "Nothing is published until you say yes. Every decision is logged and easy to review.", tag: "Approvals", lines: ["Quality gate passed", "Waiting for your approval"] },
  { icon: MessageSquare, title: "Chat manager", body: "Ask in English, Hinglish or Roman Urdu. It starts the right job and tells you what happened.", tag: "Chat", lines: ["“Write about solar loans”", "On it, drafting now"] },
  { icon: Brain, title: "Site Brain", body: "It crawls your website once and remembers your services, tone and audience for every article.", tag: "Site Brain", lines: ["48 pages read", "Services and tone learned"] },
];

function Visual({ f, narrow }: { f: F; narrow?: boolean }) {
  const Icon = f.icon;
  return (
    <div aria-hidden className={`overflow-hidden border border-[#f8f8f8] max-lg:rounded-[20px] ${narrow ? "rounded-[20px]" : "rounded-[24px]"}`}>
      <div className={`relative flex w-full items-center justify-center bg-[linear-gradient(160deg,#e5f6ea_0%,#d9eef3_100%)] ${narrow ? "aspect-[297/215]" : "aspect-[580/272]"}`}>
        <div className="w-[78%] max-w-[360px] rounded-[18px] bg-white p-4 shadow-[0_18px_40px_-14px_rgba(26,46,77,0.28)]">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#e5f6ea] text-[#2fb574]"><Icon size={16} /></span>
            <span className="text-[13px] font-semibold text-[#0a0a0a]">{f.tag}</span>
          </div>
          <div className="grid gap-2">
            {f.lines.map(l => (
              <div key={l} className="flex items-center gap-2 rounded-lg border border-[#eef0f2] px-3 py-2 text-[12.5px] text-[#404040]">
                <Check size={12} className="shrink-0 text-[#2fb574]" /><span className="truncate">{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ f, narrow }: { f: F; narrow?: boolean }) {
  return (
    <article className="flex min-w-0 flex-[1_1_0] flex-col rounded-[28px] border border-[#e5e5e5] bg-white p-1 shadow-[0_1px_2px_rgba(13,15,13,.04),0_18px_44px_rgba(13,15,13,.05)] max-lg:rounded-[24px]">
      <div className="flex flex-1 flex-col overflow-hidden rounded-[24px] max-lg:rounded-[16px]">
        <Visual f={f} narrow={narrow} />
        <div className="flex flex-col gap-3 px-7 pb-5 pt-4 max-lg:px-5 max-lg:pb-[22px] max-lg:pt-4">
          <h3 className="text-[24px] font-medium leading-7 tracking-[-0.5px] text-[#0a0a0a] max-lg:text-[19px] max-lg:leading-[25px]">{f.title}</h3>
          <p className="text-[16px] font-normal leading-[1.4] text-[#737373] max-lg:text-[14.5px] max-lg:leading-[22px]">{f.body}</p>
        </div>
      </div>
    </article>
  );
}

export function Features() {
  return (
    <section id="features" aria-labelledby="features-heading" className="sec-features relative mx-auto w-full max-w-[1440px] scroll-mt-[84px] text-[#0a0a0a]">
      <div aria-hidden className="absolute inset-y-0 left-10 right-10 max-w-[1360px] overflow-hidden rounded-t-[60px] border border-transparent [background:linear-gradient(180deg,#e5f6ea_-86.7%,#fff_49.1%)_padding-box,linear-gradient(180deg,#e5e5e5_0%,#fff_89.576%)_border-box] max-lg:inset-x-0 max-[901px]:rounded-t-[32px]" />
      <div className="relative z-[2] mx-auto w-[1200px] max-w-[calc(100%-48px)] py-[calc(100px*var(--mk-scale))] max-md:w-full max-md:max-w-none max-md:px-4">
        <div className="mx-auto flex w-[900px] max-w-full flex-col items-center gap-[calc(16px*var(--mk-scale))] text-center max-md:w-full max-md:max-w-[370px]">
          <h2 id="features-heading" className="lv-h2">Everything you need to <span className="max-md:block">grow your site</span></h2>
          <p className="lv-sub mx-auto max-w-[720px]">Features built to save you time and <br className="hidden max-md:inline" />keep every post on-brand.</p>
        </div>
        <div className="mt-[calc(56px*var(--mk-scale))] flex flex-col gap-5 max-lg:gap-4 max-md:mx-auto max-md:mt-7 max-md:w-full max-md:max-w-[440px]">
          <div className="flex items-stretch gap-5 max-lg:gap-4 max-md:flex-col"><Card f={F[0]} /><Card f={F[1]} /></div>
          <div className="flex items-stretch gap-5 max-lg:gap-4 max-md:flex-col"><Card f={F[2]} narrow /><Card f={F[3]} narrow /><Card f={F[4]} narrow /></div>
        </div>
      </div>
    </section>
  );
}
