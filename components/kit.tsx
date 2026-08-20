"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, useStore } from "@/lib/store";

/* ================= HELP: ? -> hover tooltip -> click detail ================= */
export const HELP: Record<string, { t: string; s: string; d: string }> = {
  tokens:   { t: "Tokens", s: "Your monthly content credits. Article ⚡10, story ⚡4, post ⚡1 — refills every month.", d: "Tokens are the fuel of your AI team. Each plan includes a monthly allowance that refills on your billing date. Costs: Article = 10 (full SERP research + writing + QC), Web Story = 4, Social post = 1. Unused tokens don't roll over. Nothing is ever generated or charged without your explicit confirmation — every generation shows its cost first. Run out? Upgrade in one tap or wait for the refill." },
  agents:   { t: "AI Team", s: "Six specialists — Boss AI assigns, others execute, you approve.", d: "Boss AI orchestrates and reviews everything; Mr. Keyword finds ranking opportunities; Mr. Writer writes from research blueprints; Mr. Story makes visuals; Miss Social distributes; Mr. SEO audits your site daily. Agents address each other by name — watch their coordination in the live feed. No agent ever publishes without your approval." },
  approval: { t: "Approvals", s: "Nothing goes live without you. Approve / Edit / Reject every item.", d: "The approval queue is your control point. Finished work passes Boss AI's quality checklist, then waits here. One tap approves; the editor lets you change anything; rejecting with a note teaches the team. Until you approve, nothing touches your website or accounts — guaranteed." },
  reports:  { t: "Daily Reports", s: "Boss AI writes a short report of every working day — stored forever.", d: "Each day the team works, Boss AI compiles an end-of-day report: what was produced, published, tokens spent, and what's next. Unread reports are badged; everything is stored and searchable. Your manager's standup, without the meeting." },
  memory:   { t: "AI Memory", s: "What your team knows about you. Auto-built at setup, fully editable.", d: "During the 2-minute setup Boss AI studies your website and builds a memory: business, audience, tone, topics, goals. Every agent writes from this memory. Edit any item, add facts, or delete — all agents adjust instantly. Better memory = better content." },
  pipeline: { t: "Content Pipeline", s: "Research → top-10 analysis → blueprint → writing → quality gate.", d: "Every article follows a 5-stage pipeline: Mr. Keyword validates the topic and pulls related queries; the top 10 ranking pages are analyzed for structure and gaps; a blueprint is generated (titles, outline, target length above the competition); Mr. Writer writes section-by-section in your tone; Boss AI runs the quality gate (originality, keywords, links, length). Then it waits for your approval." },
  billing:  { t: "Billing & Plans", s: "Simple monthly plans. Change anytime, cancel anytime, keep your data.", d: "Free = 10 tokens/month (one full article) forever, no card. Starter $5 = 120 tokens (~10 articles or a mix). Growth $15 = 400 tokens + the premium writing model + lead generation. Upgrades apply instantly; downgrades at next cycle; cancellation keeps all your content and memory." },
  status:   { t: "Agent Status", s: "Green = working now · amber = idle · dark room = offline.", d: "The office shows your team live. A working agent's room is lit and animated with its current task on the name tag. Idle agents wait. Offline agents' rooms go dark (lights out, asleep). In production these states stream in real time from the agent server as jobs run." },
  whoami:   { t: "Who Am I", s: "Boss AI's summary of your business — check it, correct it, done.", d: "After setup Boss AI writes a short brief: what your business does, who it serves, how it should sound, what it will write about. If anything is off, fix it in Memory — every agent adjusts immediately. This brief is the foundation of content quality." },
};

export function Help({ k }: { k: string }) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const router = useRouter();
  const H = HELP[k]; if (!H) return null;
  return (
    <>
      <span className="help" onMouseEnter={e => { const r = (e.target as HTMLElement).getBoundingClientRect(); setTip({ x: Math.min(window.innerWidth - 275, Math.max(8, r.left - 10)), y: r.bottom + 9 }); }}
        onMouseLeave={() => setTip(null)} onClick={e => { e.stopPropagation(); setTip(null); router.push("/help/" + k); }}>?</span>
      {tip && <span className="tipbox" style={{ left: tip.x, top: tip.y }}><b>{H.t}</b><br />{H.s}<span className="acc xs" style={{ display: "block", marginTop: 6, fontWeight: 600 }}>Click for full details →</span></span>}
    </>
  );
}

/* ================= BOSS AI CHAT — real streaming + voice, fixed dock on desktop ================= */
export function BossChat() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<{ who: "bot" | "me"; txt: string; live?: boolean }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOut, setVoiceOut] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const spokenCount = useRef(0);

  useEffect(() => { box.current?.scrollTo(0, 99999); }, [msgs, open]);
  useEffect(() => { if (!msgs.length) stream("__hello__"); }, []); // eslint-disable-line

  // Speech recognition (mic input) — Chrome/Edge only (webkitSpeechRecognition); silently
  // hide the mic button elsewhere rather than showing something that won't work.
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    setVoiceSupported(true);
    const rec = new SR();
    rec.continuous = false; rec.interimResults = false; rec.lang = "en-IN";
    rec.onresult = (e: any) => { setInput(e.results[0][0].transcript); setListening(false); };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
  }, []);

  const toggleMic = () => {
    if (!recognitionRef.current) return;
    if (listening) { recognitionRef.current.stop(); setListening(false); }
    else { setListening(true); recognitionRef.current.start(); }
  };

  // Speech synthesis (voice replies) — reads out each finished bot message once, if enabled.
  const speak = (text: string) => {
    if (!voiceOut || !("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(text.replace(/\*\*(.+?)\*\*/g, "$1"));
    utter.rate = 1.02;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (last && last.who === "bot" && !last.live && msgs.length > spokenCount.current) {
      spokenCount.current = msgs.length;
      speak(last.txt);
    }
  }, [msgs]); // eslint-disable-line

  /** Streams from /api/chat (real NVIDIA NIM, word-by-word). */
  async function stream(q: string) {
    setBusy(true);
    setMsgs(m => [...m, { who: "bot", txt: "", live: true }]);
    const ctx = store ? { tokens: store.s.tokens, tokensMax: store.s.tokensMax, plan: store.s.plan, memory: store.s.memory, awaiting: store.s.content.filter((c: any) => c.status === "awaiting").length, report: store.s.reports[0]?.lines?.slice(-1)[0]?.s } : {};
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, ctx }) });
    const reader = res.body!.getReader(); const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      const chunk = dec.decode(value);
      setMsgs(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], txt: c[c.length - 1].txt + chunk }; return c; });
    }
    setMsgs(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], live: false }; return c; });
    setBusy(false);
  }
  const send = () => { const v = input.trim(); if (!v || busy) return; setInput(""); setMsgs(m => [...m, { who: "me", txt: v }]); stream(v); };

  return (
    <>
      <button aria-label="Chat with Boss AI" className="bosschat-bubble" onClick={() => setOpen(o => !o)}
        style={{ position: "fixed", bottom: 22, right: 22, zIndex: 150, width: 54, height: 54, borderRadius: "50%", background: "linear-gradient(135deg,var(--ac),var(--ac-d))", color: "#04120d", fontSize: 22, boxShadow: "0 8px 26px #4fe3c144", border: "none", cursor: "pointer" }}>💬</button>

      <div className={"bosschat-panel" + (open ? " is-open" : "")}
        style={{ position: "fixed", bottom: 88, right: 22, zIndex: 150, width: 336, maxWidth: "calc(100vw - 30px)", height: 440, maxHeight: "64vh", background: "#0f1730f5", border: "1px solid var(--line2)", borderRadius: 18, flexDirection: "column", overflow: "hidden", backdropFilter: "blur(12px)", boxShadow: "0 24px 60px #000c" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "13px 15px", borderBottom: "1px solid var(--line)", background: "#121c38" }}>
          <div className="corb" /><div><b style={{ fontSize: 13.5 }}>Boss AI</b><div className="xs acc">● online</div></div>
          <div style={{ flex: 1 }} />
          <button aria-label="Toggle voice replies" title="Read replies aloud" onClick={() => setVoiceOut(v => !v)}
            style={{ background: voiceOut ? "var(--ac)" : "none", color: voiceOut ? "#04120d" : "var(--mut)", border: "1px solid " + (voiceOut ? "var(--ac)" : "var(--line2)"), borderRadius: 8, width: 26, height: 26, cursor: "pointer", fontSize: 13 }}>🔊</button>
          <button className="bosschat-close" onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--mut)", cursor: "pointer" }}>✕</button>
        </div>
        <div ref={box} style={{ flex: 1, overflowY: "auto", padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
          {msgs.map((m, i) => <div key={i} className={"cm " + m.who + (m.live ? " cursor" : "")} dangerouslySetInnerHTML={{ __html: m.txt.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>") }} />)}
        </div>
        <div style={{ display: "flex", gap: 8, padding: 11, borderTop: "1px solid var(--line)" }}>
          {voiceSupported && (
            <button aria-label="Speak your message" onClick={toggleMic}
              style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, border: "1px solid var(--line2)", background: listening ? "#e05252" : "var(--panel2)", color: listening ? "#fff" : "var(--mut)", cursor: "pointer", fontSize: 14 }}>
              {listening ? "●" : "🎤"}
            </button>
          )}
          <input placeholder={listening ? "Listening…" : "Ask Boss AI anything…"} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
          <button className="btn btn-p btn-sm" onClick={send} disabled={busy}>➤</button>
        </div>
      </div>

      <style jsx global>{`
        .bosschat-panel { display: none; }
        .bosschat-panel.is-open { display: flex; }
        @media (min-width: 1180px) {
          .bosschat-bubble, .bosschat-close { display: none !important; }
          .bosschat-panel {
            display: flex !important;
            top: 0; bottom: 0 !important; right: 0;
            height: 100vh; max-height: 100vh; width: 360px; max-width: 360px;
            border-radius: 0 !important; border-top: none; border-bottom: none; border-right: none;
          }
        }
      `}</style>
    </>
  );
}

/* small shared bits */
export function TokenBox() {
  const { s } = useStore();
  return (
    <div className="card" style={{ padding: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--mut)" }}>
        <span>Tokens <Help k="tokens" /></span><b className="acc">{s.tokens}/{s.tokensMax}</b>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "#1a2440", margin: "9px 0", overflow: "hidden" }}>
        <i style={{ display: "block", height: "100%", borderRadius: 3, background: "linear-gradient(90deg,var(--ac),var(--blu))", width: (s.tokens / s.tokensMax * 100) + "%", transition: "width .6s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }} className="xs">
        <span className="mut">{PLANS[s.plan].name} plan</span><a href="/app/billing" className="acc">Upgrade →</a>
      </div>
    </div>
  );
}
