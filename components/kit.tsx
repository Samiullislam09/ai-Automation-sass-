"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AGENTS, useStore } from "@/lib/store";
import { agentIdFromText } from "@/components/Office";

/* ================= HELP: ? -> hover tooltip -> click detail ================= */
export const HELP: Record<string, { t: string; s: string; d: string }> = {
  tokens:   { t: "Tokens", s: "Your monthly content credits. Article ⚡10, story ⚡4, post ⚡1 — refills every month.", d: "Tokens are the fuel of your AI team. Each plan includes a monthly allowance that refills on your billing date. Costs: Article = 10 (full SERP research + writing + QC), Web Story = 4, Social post = 1. Unused tokens don't roll over. Nothing is ever generated or charged without your explicit confirmation — every generation shows its cost first. Run out? Upgrade in one tap or wait for the refill." },
  agents:   { t: "AI Team", s: "Six specialists — Mr Lxwa assigns, others execute, you approve.", d: "Mr Lxwa orchestrates and reviews everything; Mr. Keyword finds ranking opportunities; Mr. Writer writes from research blueprints; Mr. Story makes visuals; Miss Social distributes; Mr. SEO audits your site daily. Agents address each other by name — watch their coordination in the live feed. No agent ever publishes without your approval." },
  approval: { t: "Approvals", s: "Nothing goes live without you. Approve / Edit / Reject every item.", d: "The approval queue is your control point. Finished work passes Mr Lxwa's quality checklist, then waits here. One tap approves; the editor lets you change anything; rejecting with a note teaches the team. Until you approve, nothing touches your website or accounts — guaranteed." },
  reports:  { t: "Daily Reports", s: "Mr Lxwa writes a short report of every working day — stored forever.", d: "Each day the team works, Mr Lxwa compiles an end-of-day report: what was produced, published, tokens spent, and what's next. Unread reports are badged; everything is stored and searchable. Your manager's standup, without the meeting." },
  memory:   { t: "AI Memory", s: "What your team knows about you. Auto-built at setup, fully editable.", d: "During the 2-minute setup Mr Lxwa studies your website and builds a memory: business, audience, tone, topics, goals. Every agent writes from this memory. Edit any item, add facts, or delete — all agents adjust instantly. Better memory = better content." },
  pipeline: { t: "Content Pipeline", s: "Research → top-10 analysis → blueprint → writing → quality gate.", d: "Every article follows a 5-stage pipeline: Mr. Keyword validates the topic and pulls related queries; the top 10 ranking pages are analyzed for structure and gaps; a blueprint is generated (titles, outline, target length above the competition); Mr. Writer writes section-by-section in your tone; Mr Lxwa runs the quality gate (originality, keywords, links, length). Then it waits for your approval." },
  billing:  { t: "Billing & Plans", s: "Simple monthly plans. Change anytime, cancel anytime, keep your data.", d: "Free = 10 tokens/month (one full article) forever, no card. Starter $5 = 120 tokens (~10 articles or a mix). Growth $15 = 400 tokens + the premium writing model + lead generation. Upgrades apply instantly; downgrades at next cycle; cancellation keeps all your content and memory." },
  status:   { t: "Agent Status", s: "Green = working now · amber = idle · dark room = offline.", d: "The office shows your team live. A working agent's room is lit and animated with its current task on the name tag. Idle agents wait. Offline agents' rooms go dark (lights out, asleep). In production these states stream in real time from the agent server as jobs run." },
  whoami:   { t: "Who Am I", s: "Mr Lxwa's summary of your business — check it, correct it, done.", d: "After setup Mr Lxwa writes a short brief: what your business does, who it serves, how it should sound, what it will write about. If anything is off, fix it in Memory — every agent adjusts immediately. This brief is the foundation of content quality." },
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
  // "sys" is a job announcement, not a turn in the conversation: green when the team
  // finished something, red when it failed. Never persisted — it reports what the dashboard
  // already knows, and replaying yesterday's completions on reopen would be noise.
  const [msgs, setMsgs] = useState<{ who: "bot" | "me" | "sys"; txt: string; live?: boolean; tone?: "done" | "error" }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOut, setVoiceOut] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const spokenCount = useRef(0);
  const helloFired = useRef(false); // React 18 Strict Mode double-invokes mount effects in dev —
  // without this guard, two concurrent "__hello__" streams both write into the same
  // message slot and every word came out doubled ("Salam! Salam!").

  // Chat used to live only in React state: a refresh, or moving between /app pages, threw the
  // whole conversation away — including the reply that told you which job had just started.
  // It is persisted now (migration 011), so the panel reopens where you left off.
  const [convId, setConvId] = useState<string | null>(null);
  const [convs, setConvs] = useState<{ id: string; title: string | null; updated_at: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const shownNotices = useRef<Set<string>>(new Set());
  // Read inside the notice effect, which must not re-run every time the conversation id
  // changes — re-running it would re-post every notice it had already stored.
  const convIdRef = useRef<string | null>(null);

  // Mr Lxwa confirming the work in the chat itself. LiveAgents fills the queue from the same
  // jobs_log rows the office animates, so the confirmation can't claim work that didn't run.
  const notices = store?.s?.chatNotices ?? [];
  useEffect(() => {
    const fresh = notices.filter((n: any) => !shownNotices.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n: any) => shownNotices.current.add(n.id));
    const lines = fresh.map((n: any) => ({
      who: "sys" as const,
      txt: n.tone === "error" ? `✕ ${n.text}` : `✓ ${n.text}`,
      tone: n.tone,
    }));
    setMsgs((m) => [...m, ...lines]);

    // Into the transcript too (migration 013). These used to be React state only, so the
    // keyword table with its measured volumes — the thing most worth looking back at —
    // disappeared on the next refresh.
    for (const line of lines) {
      fetch("/api/chat/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convIdRef.current, text: line.txt, tone: line.tone }),
      })
        .then((r) => r.json())
        .then((d) => { if (d?.ok && d.conversationId && !convIdRef.current) setConvId(d.conversationId); })
        .catch(() => {});
    }
  }, [notices]);

  useEffect(() => { convIdRef.current = convId; }, [convId]);
  useEffect(() => { box.current?.scrollTo(0, 99999); }, [msgs, open]);

  useEffect(() => {
    if (helloFired.current) return;
    helloFired.current = true;
    (async () => {
      try {
        const r = await fetch("/api/chat/conversations").then((res) => res.json());
        if (r?.ok && r.conversations?.length) {
          setConvs(r.conversations);
          await openConversation(r.conversations[0].id);
          return;
        }
      } catch {
        // Migration 011 not applied, or offline. Chat still works, it just won't remember.
      }
      stream("__hello__");
    })();
  }, []); // eslint-disable-line

  const refreshConvs = () =>
    fetch("/api/chat/conversations")
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setConvs(d.conversations); })
      .catch(() => {});

  async function openConversation(id: string) {
    try {
      const r = await fetch(`/api/chat/conversations/${id}`).then((res) => res.json());
      if (!r?.ok) return;
      setConvId(id);
      setMsgs(
        r.messages.map((m: any) =>
          m.kind === "event"
            ? { who: "sys" as const, txt: m.content, tone: (m.tone === "error" ? "error" : "done") as "done" | "error" }
            : { who: (m.role === "user" ? "me" : "bot") as "me" | "bot", txt: m.content }
        )
      );
      // Already on screen — don't let the live poll append them a second time.
      r.messages.filter((m: any) => m.kind === "event").forEach((m: any) => shownNotices.current.add(`stored-${m.content}`));
      // Reopening a thread must not read every old reply out loud.
      spokenCount.current = r.messages.length;
      setShowHistory(false);
    } catch {}
  }

  function newChat() {
    setConvId(null);
    setMsgs([]);
    spokenCount.current = 0;
    setShowHistory(false);
    // No conversation row is created until you actually say something — same as ChatGPT.
    stream("__hello__");
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" }).catch(() => {});
    setConvs((c) => c.filter((x) => x.id !== id));
    if (id === convId) newChat();
  }

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
    // Markdown is for the eye. Read aloud, "**Mr. Keyword**" becomes "star star Mr Keyword
    // star star" in some voices, and a bare URL is unlistenable.
    const spoken = text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/[*_`#>]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "the link")
      .replace(/\s+/g, " ")
      .trim();
    const utter = new SpeechSynthesisUtterance(spoken);
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
    // The conversation so far. Without this every message was a cold start: ask for an
    // article, then ask "kya update hai?" one message later and Mr Lxwa had no idea he had
    // just been asked for anything. The empty placeholder bubble added a line above is
    // dropped, and old turns are trimmed so a long session can't grow the prompt forever.
    const history = msgs
      .filter((m) => m.txt.trim() && !m.live)
      .slice(-8)
      .map((m) => ({ role: m.who === "me" ? "user" : "assistant", content: m.txt.slice(0, 700) }));
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, ctx, history, conversationId: convId }) });
    // The server opens (or reopens) the thread and names it on a header, so the rest of the
    // session keeps writing into the same one without waiting for the stream to finish.
    const returned = res.headers.get("X-Conversation-Id");
    if (returned && returned !== convId) setConvId(returned);
    const reader = res.body!.getReader(); const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      const chunk = dec.decode(value);
      setMsgs(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], txt: c[c.length - 1].txt + chunk }; return c; });
    }
    setMsgs(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], live: false }; return c; });
    setBusy(false);
    // Titles are set from the first question, so the list only becomes useful after a turn.
    if (q !== "__hello__") void refreshConvs();
  }
  const send = () => {
    const v = input.trim(); if (!v || busy) return;
    setInput(""); setMsgs(m => [...m, { who: "me", txt: v }]); stream(v);
    // Office camera: if the question is about a specific agent, zoom the office there
    // while the reply streams in — makes the dashboard feel like a real, alive office.
    const agentId = agentIdFromText(v);
    if (agentId) store?.focusOn(agentId, 5000);
  };

  return (
    <>
      <button aria-label="Chat with Mr Lxwa" className="bosschat-bubble" onClick={() => setOpen(o => !o)}
        style={{ position: "fixed", bottom: 22, right: 22, zIndex: 150, width: 54, height: 54, borderRadius: "50%", background: "linear-gradient(135deg,var(--ac),var(--ac-d))", color: "#ffffff", fontSize: 22, boxShadow: "0 8px 26px #6a5af044", border: "none", cursor: "pointer" }}>💬</button>

      {/* Size/position live in CSS only — they used to be inline, and inline styles beat the
          desktop media query below, so the "full-height docked column" never applied: the
          panel stayed a 336x440 floating card that covered the office. */}
      <div className={"bosschat-panel" + (open ? " is-open" : "")}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "13px 15px", borderBottom: "1px solid var(--line)", background: "var(--bg2)" }}>
          <div className="corb" /><div><b style={{ fontSize: 13.5 }}>Mr Lxwa</b><div className="xs acc">● online</div></div>
          <div style={{ flex: 1 }} />
          <button aria-label="Chat history" title="Past chats" onClick={() => setShowHistory(h => !h)}
            style={{ background: showHistory ? "var(--ac)" : "none", color: showHistory ? "#ffffff" : "var(--mut)", border: "1px solid " + (showHistory ? "var(--ac)" : "var(--line2)"), borderRadius: 8, width: 26, height: 26, cursor: "pointer", fontSize: 12 }}>🕐</button>
          <button aria-label="New chat" title="New chat" onClick={newChat}
            style={{ background: "none", color: "var(--mut)", border: "1px solid var(--line2)", borderRadius: 8, width: 26, height: 26, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>+</button>
          <button aria-label="Toggle voice replies" title="Read replies aloud" onClick={() => setVoiceOut(v => !v)}
            style={{ background: voiceOut ? "var(--ac)" : "none", color: voiceOut ? "#ffffff" : "var(--mut)", border: "1px solid " + (voiceOut ? "var(--ac)" : "var(--line2)"), borderRadius: 8, width: 26, height: 26, cursor: "pointer", fontSize: 13 }}>🔊</button>
          <button className="bosschat-close" onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--mut)", cursor: "pointer" }}>✕</button>
        </div>
        {/* History replaces the transcript rather than floating over it — the panel is only
            ~300px wide, and an overlay at that width is a worse list than a full-height one. */}
        {showHistory ? (
          <div style={{ flex: 1, overflowY: "auto", padding: 13 }}>
            {!convs.length && <p className="xs mut" style={{ margin: 0 }}>Koi purani chat nahi hai. Ab se har baat yahan save hoti jayegi.</p>}
            {convs.map((c) => (
              <div key={c.id} className={"chist" + (c.id === convId ? " is-on" : "")}>
                <button onClick={() => openConversation(c.id)}>
                  <span className="chist-t">{c.title || "New chat"}</span>
                  <span className="chist-d">{new Date(c.updated_at).toLocaleString()}</span>
                </button>
                <span className="chist-x" title="Delete" onClick={() => deleteConversation(c.id)}>✕</span>
              </div>
            ))}
          </div>
        ) : (
          <div ref={box} style={{ flex: 1, overflowY: "auto", padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
            {/* Mr Lxwa's "I've put the team on it" replies are numbered, multi-line — without the
                \n -> <br> the whole pipeline collapsed into one unreadable paragraph. */}
            {msgs.map((m, i) => (
              <div
                key={i}
                className={"cm " + m.who + (m.live ? " cursor" : "") + (m.tone ? " tone-" + m.tone : "")}
                dangerouslySetInnerHTML={{ __html: m.txt.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br/>") }}
              />
            ))}
          </div>
        )}

        {/* Live work strip — the same jobs the office is animating, spelled out under the
            conversation so you always know who is busy and on what, without switching screens. */}
        <LiveStrip />

        <div style={{ display: "flex", gap: 8, padding: 11, borderTop: "1px solid var(--line)" }}>
          {voiceSupported && (
            <button aria-label="Speak your message" onClick={toggleMic}
              style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, border: "1px solid var(--line2)", background: listening ? "#e05252" : "var(--panel2)", color: listening ? "#fff" : "var(--mut)", cursor: "pointer", fontSize: 14 }}>
              {listening ? "●" : "🎤"}
            </button>
          )}
          <input placeholder={listening ? "Listening…" : "Ask Mr Lxwa anything…"} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
          <button className="btn btn-p btn-sm" onClick={send} disabled={busy}>➤</button>
        </div>
      </div>

      <style jsx global>{`
        /* mobile / narrow: floating card opened by the bubble */
        .bosschat-panel {
          display: none; position: fixed; bottom: 88px; right: 22px; z-index: 150;
          width: 336px; max-width: calc(100vw - 30px); height: 440px; max-height: 64vh;
          background: var(--panel); border: 1px solid var(--line); border-radius: 18px;
          flex-direction: column; overflow: hidden; backdrop-filter: blur(12px);
          box-shadow: 0 24px 60px #1c254033;
        }
        .bosschat-panel.is-open { display: flex; }

        /* desktop: a real full-height column docked to the right edge. The width is the same
           --chatw app/app/layout.tsx reserves for it, so it never covers the office again. */
        @media (min-width: 900px) {
          .bosschat-bubble, .bosschat-close { display: none !important; }
          .bosschat-panel {
            display: flex; top: 0; bottom: 0; right: 0;
            height: 100vh; max-height: 100vh;
            width: var(--chatw, 288px); max-width: var(--chatw, 288px);
            border-radius: 0; border-top: none; border-bottom: none; border-right: none;
          }
        }
      `}</style>
    </>
  );
}

/** Who is working right now, straight from the shared live poll (components/LiveAgents.tsx).
 *  Nothing is inferred: an agent shows here only while jobs_log says its job is running. */
function LiveStrip() {
  const store = useStore();
  const agents = store?.s?.agents ?? {};
  const working = AGENTS.filter((a) => agents[a.id]?.st === "w");
  const failed = AGENTS.filter((a) => agents[a.id]?.st === "e");

  if (!working.length && !failed.length) return null;

  return (
    <div className="livestrip">
      {working.map((a) => (
        <div key={a.id} className="ls-row">
          <span className="ls-spin" />
          <b>{a.name}</b>
          <span className="ls-task">{agents[a.id].task}</span>
        </div>
      ))}
      {failed.map((a) => (
        <div key={a.id} className="ls-row is-err">
          <span className="ls-dot" />
          <b>{a.name}</b>
          <span className="ls-task">{agents[a.id].task}</span>
        </div>
      ))}

      <style jsx>{`
        .livestrip { border-top: 1px solid var(--line); padding: 9px 12px; display: flex;
                     flex-direction: column; gap: 6px; background: var(--bg2); flex: none; }
        .ls-row { display: flex; align-items: center; gap: 8px; font-size: 11px; min-width: 0; }
        .ls-row b { color: var(--ink); font-weight: 700; flex: none; }
        .ls-task { color: var(--mut); min-width: 0; overflow: hidden; text-overflow: ellipsis;
                   white-space: nowrap; }
        .ls-row.is-err b { color: var(--red); }
        .ls-spin { width: 11px; height: 11px; border-radius: 50%; flex: none;
                   border: 2px solid color-mix(in srgb, var(--ac) 35%, transparent);
                   border-top-color: var(--ac); animation: ls-spin .8s linear infinite; }
        @keyframes ls-spin { to { transform: rotate(360deg); } }
        .ls-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--red); flex: none; }
      `}</style>
    </div>
  );
}
