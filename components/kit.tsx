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
/** Index just past the last sentence-ending mark in `s`, or 0 if there isn't one yet.
 *  The Hindi/Urdu danda counts: Mr Lxwa answers in Hinglish and a full stop is not the
 *  only thing that ends a sentence there. */
function lastSentenceEnd(s: string): number {
  const re = /[.!?…।](?=\s|$)|\n/g;
  let end = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) end = m.index + 1;
  return end;
}

/* ─────────────── rendering a message ───────────────
 * The transcript used to be one dangerouslySetInnerHTML per bubble: bold, newline, done. That
 * was fine until Mr. Keyword started reporting its options, which are a table — keyword,
 * monthly searches, competition, what your own site already gets — and a table written out as
 * "solar panel cost · 12,000/mo · low competition", one line per row, is unreadable at chat
 * width. It is sent as a markdown table now (components/LiveAgents.tsx) and drawn as a real
 * one, which also means the stored transcript keeps a table rather than a paragraph.
 *
 * Going through React nodes instead of innerHTML escapes everything on the way as a
 * side-effect. The old path handed raw job text — including article titles the model wrote —
 * to the browser as markup.
 */
const CELL = /^\s*\|(.+)\|\s*$/;
const RULE = /^\s*\|[\s:|-]+\|\s*$/;

function cells(line: string): string[] {
  return (CELL.exec(line)?.[1] ?? "").split("|").map((c) => c.trim());
}

/** **bold** becomes <b>; everything else is text. */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let i = 0, n = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push(text.slice(i, m.index));
    out.push(<b key={`${key}-b${n++}`}>{m[1]}</b>);
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

function renderMessage(txt: string): React.ReactNode {
  const lines = txt.split("\n");
  const out: React.ReactNode[] = [];
  let para: string[] = [];

  const flush = () => {
    if (!para.length) return;
    const block = para;
    const at = out.length;
    para = [];
    out.push(
      <span key={`p${at}`}>
        {block.map((l, i) => (
          <React.Fragment key={i}>
            {i > 0 && <br />}
            {inline(l, `p${at}-${i}`)}
          </React.Fragment>
        ))}
      </span>
    );
  };

  for (let i = 0; i < lines.length; i++) {
    // A table is a header row, a separator row, then its body. Anything short of that is
    // ordinary text that happens to contain a pipe.
    if (CELL.test(lines[i]) && i + 1 < lines.length && RULE.test(lines[i + 1])) {
      flush();
      const head = cells(lines[i]);
      const body: string[][] = [];
      let j = i + 2;
      while (j < lines.length && CELL.test(lines[j]) && !RULE.test(lines[j])) body.push(cells(lines[j++]));
      i = j - 1;
      out.push(
        <div className="cmtable-wrap" key={`t${out.length}`}>
          <table className="cmtable">
            <thead><tr>{head.map((h, k) => <th key={k}>{h}</th>)}</tr></thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>{row.map((c, k) => <td key={k}>{inline(c, `t${r}-${k}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (!lines[i].trim() && !para.length) continue;
    para.push(lines[i]);
  }
  flush();
  return out;
}

export function BossChat() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  // "sys" is a job announcement, not a turn in the conversation: green when the team
  // finished something, red when it failed. Never persisted — it reports what the dashboard
  // already knows, and replaying yesterday's completions on reopen would be noise.
  // `failed` marks a bot bubble whose reply never arrived; `retryOf` is the user text to re-send.
  const [msgs, setMsgs] = useState<{ who: "bot" | "me" | "sys"; txt: string; live?: boolean; tone?: "done" | "error"; failed?: boolean; retryOf?: string }[]>([]);
  // Desktop only: the dock can be closed and stays closed across reloads (localStorage). On
  // narrow screens `open` is the floating card's own state and this flag is ignored.
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOut, setVoiceOut] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  // How much of the reply being streamed right now has already been read aloud.
  const spokenChars = useRef(0);
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
  // Only follow the stream if the reader was already at (or within 80px of) the bottom before
  // this update — scrolling up to re-read an earlier answer must not be yanked back.
  const nearBottom = useRef(true);
  const onBoxScroll = () => {
    const el = box.current; if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
  };
  useEffect(() => { if (nearBottom.current) box.current?.scrollTo(0, 99999); }, [msgs, open]);
  // Reopening the panel starts at the bottom, whatever the previous scroll position was.
  useEffect(() => { if (open) { nearBottom.current = true; box.current?.scrollTo(0, 99999); } }, [open]);

  // Collapsed state is per-browser. A class on <body> lets AppShell's layout reclaim the dock
  // width without the two components sharing state.
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("bosschat:collapsed") === "1"); } catch {}
  }, []);
  useEffect(() => {
    document.body.classList.toggle("chat-collapsed", collapsed);
    try { localStorage.setItem("bosschat:collapsed", collapsed ? "1" : "0"); } catch {}
    return () => { document.body.classList.remove("chat-collapsed"); };
  }, [collapsed]);

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
      setShowHistory(false);
    } catch {}
  }

  function newChat() {
    setConvId(null);
    setMsgs([]);
    spokenChars.current = 0;
    setShowHistory(false);
    // No conversation row is created until you actually say something — same as ChatGPT.
    stream("__hello__");
  }

  async function deleteConversation(id: string) {
    const title = convs.find((c) => c.id === id)?.title || "this chat";
    const ok = await store?.confirmAction?.({
      title: `Delete "${title}"?`,
      body: "The whole conversation is removed. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok === false) return;
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      store?.toast?.(`Couldn't delete chat: ${e?.message ?? "network error"}`, "error");
      return;
    }
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

  /* Speech synthesis (voice replies).
   *
   *  This used to wait for the whole reply, then read it. That put the audio at the END of
   *  every other delay — first token, then the rest of the generation, and only then did
   *  anyone hear anything. Since the answer now arrives as a stream, speech starts on the
   *  first finished SENTENCE and the rest is queued behind it as it lands, so the voice is
   *  talking while the words are still being written. */

  // Markdown is for the eye. Read aloud, "**Mr. Keyword**" becomes "star star Mr Keyword star
  // star" in some voices, and a bare URL is unlistenable.
  const forSpeech = (text: string) =>
    text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "the link")
      .replace(/[*_`#>]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  /** Queues one more piece behind whatever is already being said — no cancel(), because
   *  cancelling is what turns a sentence-by-sentence read into a stutter. */
  const sayNext = (piece: string) => {
    if (!voiceOut || !("speechSynthesis" in window)) return;
    const spoken = forSpeech(piece);
    if (!spoken) return;
    const utter = new SpeechSynthesisUtterance(spoken);
    utter.rate = 1.02;
    window.speechSynthesis.speak(utter);
  };

  /** Speaks every complete sentence that has arrived since the last call. `flush` releases
   *  the tail when the stream ends, sentence-ending punctuation or not. */
  const speakSoFar = (full: string, flush = false) => {
    if (!voiceOut || !("speechSynthesis" in window)) return;
    const pending = full.slice(spokenChars.current);
    if (!pending) return;
    if (flush) {
      sayNext(pending);
      spokenChars.current = full.length;
      return;
    }
    const end = lastSentenceEnd(pending);
    if (end <= 0) return;
    sayNext(pending.slice(0, end));
    spokenChars.current += end;
  };

  /** Streams from /api/chat (real NVIDIA NIM, word-by-word). */
  async function stream(q: string) {
    setBusy(true);
    setMsgs(m => [...m, { who: "bot", txt: "", live: true }]);
    // Which bubble is ours. The index is captured now: a "sys" notice can be appended while
    // this reply streams, and "the last bubble" would then be the wrong one.
    let slot = -1;
    setMsgs(m => { slot = m.length - 1; return m; });
    const patchSlot = (fn: (b: (typeof msgs)[number]) => (typeof msgs)[number]) =>
      setMsgs(m => { const i = slot >= 0 && slot < m.length ? slot : m.length - 1; const c = [...m]; c[i] = fn(c[i]); return c; });
    const ctx = store ? { tokens: store.s.tokens, tokensMax: store.s.tokensMax, plan: store.s.plan, memory: store.s.memory, awaiting: store.s.content.filter((c: any) => c.status === "awaiting").length, report: store.s.reports[0]?.lines?.slice(-1)[0]?.s } : {};
    // The conversation so far. Without this every message was a cold start: ask for an
    // article, then ask "kya update hai?" one message later and Mr Lxwa had no idea he had
    // just been asked for anything. The empty placeholder bubble added a line above is
    // dropped, and old turns are trimmed so a long session can't grow the prompt forever.
    const history = msgs
      .filter((m) => m.txt.trim() && !m.live && !m.failed)
      .slice(-8)
      .map((m) => ({ role: m.who === "me" ? "user" : "assistant", content: m.txt.slice(0, 700) }));
    let full = "";
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, ctx, history, conversationId: convId }) });
      // A 4xx/5xx still has a body (an error page, a JSON error) — reading it as the reply
      // would print the error page into the bubble and never mark the turn as failed.
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      // The server opens (or reopens) the thread and names it on a header, so the rest of the
      // session keeps writing into the same one without waiting for the stream to finish.
      const returned = res.headers.get("X-Conversation-Id");
      if (returned && returned !== convId) setConvId(returned);

      // An order that was actually accepted (the enqueue returned a job id) — see the
      // OrderResult type in app/api/chat/route.ts. Handing it to the store here is what closes
      // the gap the whole complaint was about: it used to take up to four seconds for the
      // office to react to "write me an article", because nothing moved until the next poll
      // found a jobs_log row. Now the room lights the moment the reply does.
      const runAgent = res.headers.get("X-Run-Agent");
      if (runAgent) {
        const label = res.headers.get("X-Run-Label");
        store?.startRun?.(runAgent, label ? decodeURIComponent(label) : "Order accepted", res.headers.get("X-Run-Job"));
      }
      const reader = res.body.getReader(); const dec = new TextDecoder();
      // A fresh reply cancels whatever the previous one was still saying; after this the
      // sentences queue behind each other instead of interrupting.
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      spokenChars.current = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        // stream:true matters now that these are real model chunks rather than whole words —
        // a multi-byte character (an emoji, an accented letter) can straddle two chunks, and
        // decoding each one in isolation turns it into replacement squares.
        const chunk = dec.decode(value, { stream: true });
        full += chunk;
        patchSlot(b => ({ ...b, txt: b.txt + chunk }));
        // Say each sentence the moment it is finished, rather than banking the whole reply and
        // starting the audio after it. This is the difference between hearing an answer at one
        // second and hearing it at four.
        speakSoFar(full);
      }
      speakSoFar(full, true);
      patchSlot(b => ({ ...b, live: false }));
      // Titles are set from the first question, so the list only becomes useful after a turn.
      if (q !== "__hello__") void refreshConvs();
    } catch (e: any) {
      // The bubble stays, but as a failure with a Retry — an empty bubble with a blinking
      // cursor forever was the old behaviour, with the send button stuck disabled behind it.
      const partial = full.trim();
      patchSlot(b => ({
        ...b, live: false, failed: true, retryOf: q,
        txt: partial ? `${partial}\n\n**Reply cut off** (${e?.message ?? "network error"})` : `**Reply failed** (${e?.message ?? "network error"})`,
      }));
    } finally {
      setBusy(false);
    }
  }
  /** Re-sends the message a failed bubble belonged to, replacing that bubble. */
  const retry = (i: number) => {
    if (busy) return;
    const q = msgs[i]?.retryOf; if (!q) return;
    setMsgs(m => m.filter((_, j) => j !== i));
    stream(q);
  };
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
      <button aria-label="Chat with Mr Lxwa" className={"bosschat-bubble" + (collapsed ? " is-collapsed" : "")} onClick={() => { setCollapsed(false); setOpen(o => !o); }}
        style={{ position: "fixed", bottom: 22, right: 22, zIndex: 150, width: 54, height: 54, borderRadius: "50%", background: "linear-gradient(135deg,var(--ac),var(--ac-d))", color: "#ffffff", fontSize: 22, boxShadow: "0 8px 26px #6a5af044", border: "none", cursor: "pointer" }}>💬</button>

      {/* Size/position live in CSS only — they used to be inline, and inline styles beat the
          desktop media query below, so the "full-height docked column" never applied: the
          panel stayed a 336x440 floating card that covered the office. */}
      <div className={"bosschat-panel" + (open ? " is-open" : "") + (collapsed ? " is-collapsed" : "")}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "13px 15px", borderBottom: "1px solid var(--line)", background: "var(--bg2)" }}>
          <div className="corb" /><div><b style={{ fontSize: 13.5 }}>Mr Lxwa</b><div className="xs acc">● online</div></div>
          <div style={{ flex: 1 }} />
          <button aria-label="Chat history" title="Past chats" onClick={() => setShowHistory(h => !h)}
            style={{ background: showHistory ? "var(--ac)" : "none", color: showHistory ? "#ffffff" : "var(--mut)", border: "1px solid " + (showHistory ? "var(--ac)" : "var(--line2)"), borderRadius: 8, width: 26, height: 26, cursor: "pointer", fontSize: 12 }}>🕐</button>
          <button aria-label="New chat" title="New chat" onClick={newChat}
            style={{ background: "none", color: "var(--mut)", border: "1px solid var(--line2)", borderRadius: 8, width: 26, height: 26, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>+</button>
          <button aria-label="Toggle voice replies" title="Read replies aloud" onClick={() => setVoiceOut(v => !v)}
            style={{ background: voiceOut ? "var(--ac)" : "none", color: voiceOut ? "#ffffff" : "var(--mut)", border: "1px solid " + (voiceOut ? "var(--ac)" : "var(--line2)"), borderRadius: 8, width: 26, height: 26, cursor: "pointer", fontSize: 13 }}>🔊</button>
          <button className="bosschat-close" aria-label="Close chat" title="Close chat" onClick={() => { setOpen(false); setCollapsed(true); }} style={{ background: "none", border: "none", color: "var(--mut)", cursor: "pointer" }}>✕</button>
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
                <button type="button" className="chist-x" title="Delete" aria-label="Delete conversation" onClick={() => deleteConversation(c.id)}>✕</button>
              </div>
            ))}
          </div>
        ) : (
          <div ref={box} onScroll={onBoxScroll} style={{ flex: 1, overflowY: "auto", padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
            {/* Mr Lxwa's "I've put the team on it" replies are numbered, multi-line — without the
                \n -> <br> the whole pipeline collapsed into one unreadable paragraph. */}
            {msgs.map((m, i) => (
              <div key={i} className={"cm " + m.who + (m.live ? " cursor" : "") + (m.tone ? " tone-" + m.tone : "") + (m.failed ? " is-failed" : "")}>
                {renderMessage(m.txt)}
                {m.failed && m.retryOf && (
                  <button type="button" className="btn btn-g btn-sm cm-retry" disabled={busy} onClick={() => retry(i)}>Retry</button>
                )}
              </div>
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
        /* Mr. Keyword's options, at chat width. Four columns will not fit in a 288px dock, so
           the table scrolls inside its own box rather than widening the panel — the numbers
           are the point of the table and truncating them would defeat it. */
        .cmtable-wrap { overflow-x: auto; margin: 7px 0 2px; border: 1px solid var(--line);
                        border-radius: 9px; background: var(--panel2); }
        .cmtable { border-collapse: collapse; font-size: 10.5px; width: 100%; min-width: 300px; }
        .cmtable th { text-align: left; font-size: 8.5px; letter-spacing: .4px; text-transform: uppercase;
                      color: var(--mut2); font-weight: 800; padding: 7px 8px 5px; white-space: nowrap;
                      border-bottom: 1px solid var(--line); }
        .cmtable td { padding: 6px 8px; border-top: 1px solid var(--line); color: var(--mut);
                      white-space: nowrap; vertical-align: top; }
        .cmtable td:nth-child(2) { white-space: normal; min-width: 108px; }
        .cmtable td b { color: var(--ink); }
        .cmtable tbody tr:first-child td { border-top: none; }
        .cmtable tbody tr:hover td { background: color-mix(in srgb, var(--ac) 8%, transparent); }

        /* mobile / narrow: floating card opened by the bubble */
        .bosschat-panel {
          display: none; position: fixed; bottom: 88px; right: 22px; z-index: 150;
          width: 336px; max-width: calc(100vw - 30px); height: 440px; max-height: 64vh;
          background: var(--panel); border: 1px solid var(--line); border-radius: 18px;
          flex-direction: column; overflow: hidden; backdrop-filter: blur(12px);
          box-shadow: 0 24px 60px #1c254033;
        }
        .bosschat-panel.is-open { display: flex; }

        /* A reply that never arrived. Red edge, and the Retry button re-sends the same text. */
        .cm.bot.is-failed { border-color: color-mix(in srgb, var(--red) 45%, transparent);
                            background: color-mix(in srgb, var(--red) 8%, transparent); }
        .cm-retry { display: inline-flex; margin-top: 8px; min-height: 30px; padding: 4px 11px; font-size: 12px; }

        /* desktop: a real full-height column docked to the right edge. The width is the same
           --chatw app/app/layout.tsx reserves for it, so it never covers the office again.
           The close button collapses the dock (remembered in localStorage) and the bubble comes
           back so it can be reopened; AppShell reads body.chat-collapsed to reclaim the width. */
        @media (min-width: 900px) {
          .bosschat-bubble { display: none !important; }
          .bosschat-bubble.is-collapsed { display: block !important; }
          .bosschat-panel {
            display: flex; top: 0; bottom: 0; right: 0;
            height: 100vh; max-height: 100vh;
            width: var(--chatw, 288px); max-width: var(--chatw, 288px);
            border-radius: 0; border-top: none; border-bottom: none; border-right: none;
          }
          .bosschat-panel.is-collapsed { display: none; }
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
