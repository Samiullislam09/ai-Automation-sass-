"use client";
import { useEffect, useRef } from "react";
import { Check, ArrowUp } from "lucide-react";
import { AGENTS_LIST, STATUS_STYLE } from "./agents-list";

/** Every agent, introduced one full-width card at a time.
 *
 *  Same pattern as the reference: each card is `position: sticky`, so as you scroll the next card
 *  slides up over the previous one, and the card underneath eases back (scale 1 -> 0.94) while the
 *  next one arrives. On a mouse, a card tilts a little and catches a soft glare.
 *
 *  Status badges come from agents-list.ts (live / beta / soon), so nothing here claims more than the
 *  product does. The panels on the right are illustrations, not customer data. */

type Mock = React.ReactNode;
type Slide = {
  n: string; badge: "LIVE" | "BETA" | "YOU"; eyebrow: string; title: string; text: string; agents: string[]; glow: string; mock: Mock;
};

const Row = ({ children, tag, ok }: { children: React.ReactNode; tag?: string; ok?: boolean }) => (
  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[13.5px] text-white/85 max-md:text-[12.5px]">
    {ok && <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#6a5af0]/30 text-[#c4b8ff]"><Check size={12} strokeWidth={3} /></span>}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {tag && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${tag === "Measured" ? "bg-emerald-400/15 text-emerald-300" : tag === "Beta" ? "bg-amber-400/15 text-amber-300" : "bg-white/10 text-white/60"}`}>{tag}</span>}
  </div>
);
const Bar = ({ label, w }: { label: string; w: string }) => (
  <div><div className="mb-1 flex justify-between text-[12px] text-white/60"><span>{label}</span><span>{w}</span></div><div className="h-1.5 rounded-full bg-white/10"><i className="block h-full rounded-full bg-gradient-to-r from-[#a78bfa] to-[#3b82f6]" style={{ width: w }} /></div></div>
);

const SLIDES: Slide[] = [
  { n: "01", badge: "LIVE", eyebrow: "MenCra · Manager", title: "Just tell it what you need", text: "Say it in plain words, in English, Hinglish or Roman Urdu. Your manager plans the work and starts the right agent.", agents: ["boss"], glow: "106,90,240",
    mock: (<div className="grid h-full content-center gap-3"><div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-[#6a5af0] px-4 py-2.5 text-[13.5px] text-white">Write an article about solar loans</div><div className="max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.07] px-4 py-2.5 text-[13.5px] text-white/85">On it. Picking a keyword, then drafting. I will ask you before anything goes live.</div><div className="mt-1 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] py-1.5 pl-4 pr-1.5 text-[12.5px] text-white/50"><span className="flex-1">Ask MenCra…</span><span className="grid h-7 w-7 place-items-center rounded-full bg-[#6a5af0] text-white"><ArrowUp size={14} /></span></div></div>) },
  { n: "02", badge: "LIVE", eyebrow: "Site Crawler · Mr. Analyst", title: "It learns your business first", text: "One agent reads your website page by page. The other works out what you do, who you serve and how you sound. Every later step uses it.", agents: ["crawler", "analyst"], glow: "59,130,246",
    mock: (<div className="grid h-full content-center gap-3"><Bar label="Pages read" w="96%" /><Row ok>What you do: Solar panel installation</Row><Row ok>Who it is for: Homeowners</Row><Row ok>Tone: Friendly and practical</Row></div>) },
  { n: "03", badge: "LIVE", eyebrow: "Mr. Keyword", title: "Topics from real search data", text: "It finds what people actually search for. Measured numbers are always kept apart from suggestions, so nothing is invented.", agents: ["keyword"], glow: "139,108,255",
    mock: (<div className="grid h-full content-center gap-2.5"><Row tag="Measured">net metering rules</Row><Row tag="Measured">solar panel cost</Row><Row tag="Suggested">best inverter for home</Row></div>) },
  { n: "04", badge: "LIVE", eyebrow: "Mr. Writer", title: "Articles in your own voice", text: "A full draft in your tone, with links to your own pages already in place. Ready for you to read.", agents: ["writer"], glow: "99,102,241",
    mock: (<div className="grid h-full content-center gap-2.5"><p className="text-[17px] font-semibold text-white max-md:text-[15px]">Net metering, explained</p><Row ok>Outline ready</Row><Row ok>1,800 words written</Row><Row ok>Links to 4 of your pages</Row></div>) },
  { n: "05", badge: "LIVE", eyebrow: "Mr. QA", title: "Checked before you ever see it", text: "Every draft is checked for length, structure and links. If it is not good enough, you are told why.", agents: ["qa"], glow: "168,85,247",
    mock: (<div className="grid h-full content-center gap-2.5"><Row ok>Length</Row><Row ok>Structure</Row><Row ok>Internal links</Row><Row ok>Result: passed</Row></div>) },
  { n: "06", badge: "YOU", eyebrow: "You decide", title: "Nothing goes live without your yes", text: "Read it, edit it, approve it or reject it. Every decision is logged, so you always know who approved what.", agents: [], glow: "106,90,240",
    mock: (<div className="grid h-full content-center gap-3"><p className="text-[12px] font-semibold uppercase tracking-wider text-[#c4b8ff]">Waiting for you</p><p className="text-[17px] font-semibold text-white max-md:text-[15px]">Net metering, explained</p><Row ok>Quality check passed</Row><div className="flex gap-2"><span className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-[#6a5af0] text-[14px] font-semibold text-white">Approve</span><span className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-white/15 text-[14px] text-white/80">Edit</span><span className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-white/15 text-[14px] text-white/80">Reject</span></div></div>) },
  { n: "07", badge: "LIVE", eyebrow: "Mr. Publish", title: "One approval. Live on your site.", text: "Approved articles go to your website through WordPress or a webhook, and you keep a record of everything that went out.", agents: ["publish"], glow: "59,130,246",
    mock: (<div className="grid h-full content-center gap-2.5"><Row ok>Approved by you</Row><Row ok>Sent to your website</Row><Row ok>Published and recorded</Row></div>) },
  { n: "08", badge: "LIVE", eyebrow: "Site Audit", title: "Know what to fix on your site", text: "It checks your pages and their speed and lists what needs attention, so your site stays healthy.", agents: ["audit"], glow: "99,102,241",
    mock: (<div className="grid h-full content-center gap-3"><Bar label="Page speed" w="82%" /><Bar label="Pages checked" w="64%" /><Row tag="3 to fix">Missing page titles</Row></div>) },
  { n: "09", badge: "BETA", eyebrow: "Mr. Lead · Miss Social", title: "Grow beyond articles", text: "Find businesses that match your ideal customer and get a first message drafted. Get social post drafts for each article. Auto-posting is not available yet.", agents: ["leads", "social"], glow: "139,108,255",
    mock: (<div className="grid h-full content-center gap-2.5"><Row tag="Beta">Lead: a local home-improvement firm</Row><Row tag="Beta">Draft message ready for you to edit</Row><Row tag="Beta">Social post drafts: 4 ready</Row></div>) },
];

function Chip({ id }: { id: string }) {
  const a = AGENTS_LIST.find(x => x.id === id)!; const st = STATUS_STYLE[a.status];
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 py-1 pl-2.5 pr-3 text-[13px] font-medium text-white/90"><i className="block h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />{a.name}{a.status === "beta" && <em className="not-italic text-[11px] text-amber-300">Beta</em>}</span>;
}

export function StackAgents() {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const soon = AGENTS_LIST.filter(a => a.status === "soon");
  const count = SLIDES.length + 1;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const apply = (c: HTMLElement) => {
      const s = c.dataset.s || "1", rx = c.dataset.rx || "0", ry = c.dataset.ry || "0";
      c.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`;
    };
    const tick = () => {
      raf = 0;
      const vh = window.innerHeight;
      refs.current.forEach((c, i) => {
        const next = refs.current[i + 1];
        if (!c || !next) return;
        // the card underneath eases back while the next one slides in (next top: bottom of screen -> 25% down)
        const p = Math.min(1, Math.max(0, (vh - next.getBoundingClientRect().top) / (vh - vh * 0.25)));
        c.dataset.s = String(1 - 0.06 * p);
        apply(c);
      });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const canTilt = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (min-width: 1024px)").matches;
  const move = (e: React.MouseEvent<HTMLElement>) => {
    const c = e.currentTarget; if (!canTilt()) return;
    const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    c.dataset.ry = String((px - 0.5) * 8); c.dataset.rx = String((0.5 - py) * 8);
    c.style.setProperty("--gx", px * 100 + "%"); c.style.setProperty("--gy", py * 100 + "%");
    c.style.transform = `perspective(900px) rotateX(${c.dataset.rx}deg) rotateY(${c.dataset.ry}deg) scale(${c.dataset.s || 1})`;
  };
  const leave = (e: React.MouseEvent<HTMLElement>) => {
    const c = e.currentTarget; c.dataset.rx = "0"; c.dataset.ry = "0";
    c.style.transform = `perspective(900px) rotateX(0deg) rotateY(0deg) scale(${c.dataset.s || 1})`;
  };

  const cardCls = "group relative grid w-full origin-top overflow-hidden rounded-[clamp(20px,3vw,28px)] border border-white/[0.08] p-[clamp(18px,3.5vw,48px)] text-white shadow-[0_-20px_60px_-30px_rgba(11,18,32,0.45)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-[clamp(16px,3vw,44px)] items-stretch sticky top-[clamp(72px,11vh,120px)] min-h-[min(62vh,600px)] will-change-transform";

  return (
    <section id="team" aria-labelledby="team-h" className="mx-auto w-full max-w-[1280px] scroll-mt-[84px] px-6 pt-[72px] max-md:px-4 max-md:pt-10">
      <div className="text-center">
        <p className="text-[14px] font-semibold uppercase tracking-[0.08em] text-[#6a5af0]">Your AI team</p>
        <h2 id="team-h" className="lv-h2 mt-3">Meet the agents that work for you</h2>
        <p className="lv-sub mx-auto mt-4 max-w-[700px]">Each agent has one job. Scroll to meet them in the order they work on your site.</p>
      </div>

      <div className="mt-12 flex flex-col gap-[clamp(24px,6vh,64px)] pb-8 max-md:mt-8">
        {SLIDES.map((s, i) => (
          <article key={s.n} ref={el => { refs.current[i] = el; }} onMouseMove={move} onMouseLeave={leave} className={cardCls}
            style={{ background: `radial-gradient(120% 70% at 0% 0%, rgba(${s.glow},.38), transparent 60%), #0B1220`, zIndex: i + 1 }}>
            <span aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: "radial-gradient(300px 300px at var(--gx,50%) var(--gy,50%), rgba(167,139,250,.3), transparent 70%)" }} />
            <div className="relative flex flex-col justify-center gap-[clamp(10px,1.6vw,18px)]">
              <div className="flex items-center justify-between text-[14px]" style={{ fontFamily: "var(--font-jbmono),'JetBrains Mono',monospace" }}>
                <span>{s.n}</span>
                <span className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-[#0B1220]" style={{ background: s.badge === "BETA" ? "linear-gradient(135deg,#fbbf24,#fde68a)" : "linear-gradient(135deg,#3b82f6,#a78bfa)" }}>{s.badge}</span>
              </div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-white/60">{s.eyebrow}</p>
              <h3 className="text-[clamp(28px,4.2vw,60px)] font-extrabold leading-[.98] tracking-[-0.035em]" style={{ fontFamily: "var(--font-bricolage),'Bricolage Grotesque','Google Sans Flex',sans-serif" }}>{s.title}</h3>
              <p className="text-[clamp(15px,1.4vw,17px)] leading-[1.45] text-white/80">{s.text}</p>
              {s.agents.length > 0 && <div className="mt-1 flex flex-wrap gap-2">{s.agents.map(id => <Chip key={id} id={id} />)}</div>}
            </div>
            <div aria-hidden className="relative w-full self-center overflow-hidden rounded-[18px] bg-[#05080f] p-5 ring-1 ring-white/10 md:aspect-[16/9] max-md:min-h-[220px] max-md:p-4">{s.mock}<span className="absolute right-3 top-3 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/60">Example</span></div>
          </article>
        ))}

        <article ref={el => { refs.current[SLIDES.length] = el; }} onMouseMove={move} onMouseLeave={leave} className={cardCls}
          style={{ background: "radial-gradient(120% 70% at 0% 0%, rgba(106,90,240,.38), transparent 60%), #0B1220", zIndex: count, minHeight: "min(46vh,420px)" }}>
          <div className="relative flex flex-col justify-center gap-[clamp(10px,1.6vw,18px)]">
            <div className="flex items-center justify-between text-[14px]" style={{ fontFamily: "var(--font-jbmono),'JetBrains Mono',monospace" }}><span>10</span><span className="rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-semibold text-white/80">SOON</span></div>
            <h3 className="text-[clamp(28px,4.2vw,60px)] font-extrabold leading-[.98] tracking-[-0.035em]" style={{ fontFamily: "var(--font-bricolage),'Bricolage Grotesque','Google Sans Flex',sans-serif" }}>More agents are on the way</h3>
            <p className="text-[clamp(15px,1.4vw,17px)] leading-[1.45] text-white/80">We are building the rest of the team. They will join your plan as they are ready.</p>
          </div>
          <div className="relative flex flex-wrap content-center gap-2.5">
            {soon.map(a => (
              <span key={a.id} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-[14px] text-white/85">
                <a.icon size={16} className="text-[#c4b8ff]" /><span><b className="font-semibold text-white">{a.name}</b><span className="block text-[12px] text-white/55">{a.job}</span></span>
              </span>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
