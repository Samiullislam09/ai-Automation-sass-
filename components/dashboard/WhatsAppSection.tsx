"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import WhatsAppConnectModal from "./WhatsAppConnectModal";

/** /dashboard/whatsapp — Mr. WhatsApp, made to look and feel like WhatsApp itself.
 *
 *  WHITE, ON PURPOSE (owner: "ek dam simple WhatsApp jaisa, white bg"). A non-technical user
 *  already knows WhatsApp; the fastest way for them to trust an inbox is for it to BE the inbox
 *  they know. So this renders its own WhatsApp-authentic surface with WhatsApp colours, not the
 *  dark dashboard theme.
 *
 *  FILLS THE HEIGHT. The section is a flex column that fills <main>; the inbox panel is flex-1,
 *  so there is no dead space below it (the old fixed min(72vh,660px) left a gap).
 *
 *  RESPONSIVE. On a wide screen it is the classic two panes (chats | chat). On a phone it shows
 *  ONE pane at a time: the chat list, and when you open a conversation the chat takes over with a
 *  back arrow — exactly how the WhatsApp app behaves.
 *
 *  ONE MESSAGE PER SEND. No "send all", no auto. Suggest fills the box (first-message draft, or a
 *  Mr. Brain reply once a chat is going); you still press Send. */

const WA = {
  green: "#008069",
  panel: "#ffffff",
  listHover: "#f5f6f6",
  chatBg: "#efeae2",
  outBubble: "#d9fdd3",
  inBubble: "#ffffff",
  text: "#111b21",
  sub: "#667781",
  divider: "#e9edef",
  tickBlue: "#53bdeb",
};

type Status = { status: string; qr: string | null; phone: string | null };
type Lead = {
  id: string; company: string | null; name: string | null; whatsapp: string | null; phone: string | null;
  stage: string; icp_score: number | null; draft?: string | null;
  email?: string | null; website?: string | null; country?: string | null; city?: string | null;
  source?: string | null; reason?: string | null; observation?: string | null; created_at?: string | null;
  source_segment?: string | null; source_query?: string | null; classification?: string | null;
  score_breakdown?: { score?: number; band?: string; components?: { id: string; group: string; points: number; max: number; why: string }[] } | null;
  evidence?: any; reject_reason?: string | null;
};
type Msg = { id: string; direction: "in" | "out"; status: string; body: string; answered_by?: string | null; created_at: string };

export default function WhatsAppSection() {
  const { toast } = useStore();
  const [status, setStatus] = useState<Status & { loaded: boolean }>({ status: "checking", qr: null, phone: null, loaded: false });
  const [everConnected, setEverConnected] = useState(false);
  const [modal, setModal] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/status").then((x) => x.json());
      if (r.ok) {
        setStatus({ status: r.status, qr: r.qr ?? null, phone: r.phone ?? null, loaded: true });
        if (typeof r.autoReply === "boolean") setAutoReply(r.autoReply);
        if (r.status === "connected") setEverConnected(true);
      } else setStatus((s) => ({ ...s, loaded: true }));
    } catch {
      setStatus((s) => ({ ...s, loaded: true }));
    }
  }, []);

  const toggleAuto = async () => {
    const next = !autoReply;
    setAutoReply(next); // optimistic
    setTogglingAuto(true);
    try {
      const r = await fetch("/api/whatsapp/auto-reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: next }) }).then((x) => x.json());
      if (!r.ok) { setAutoReply(!next); toast(r.error ?? "Could not update auto-reply.", "error"); }
      else toast(next ? "Auto-reply ON — Mr Lxwa will answer incoming messages." : "Auto-reply OFF.");
    } catch (e: any) { setAutoReply(!next); toast(e?.message ?? "Network error.", "error"); }
    finally { setTogglingAuto(false); }
  };

  useEffect(() => {
    poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, [poll]);

  const doDisconnect = async () => {
    try {
      const r = await fetch("/api/whatsapp/disconnect", { method: "POST" }).then((x) => x.json());
      if (r.ok) { setStatus({ status: "disconnected", qr: null, phone: null, loaded: true }); setEverConnected(false); toast("WhatsApp unlinked."); }
      else toast(r.error ?? "Could not unlink.", "error");
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
  };

  const connected = status.status === "connected" || (everConnected && status.status === "checking");
  const checking = !status.loaded && !everConnected;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: WA.green }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 21a9 9 0 10-8-4.9L3 21l4.9-1A9 9 0 0012 21z" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" /></svg>
          </span>
          <div>
            <h1 className="text-lg font-bold leading-tight">WhatsApp</h1>
            <p className="lx-10 lx-mut">You reply, one message at a time. Nothing is ever sent on its own.</p>
          </div>
        </div>
        {connected && (
          <div className="flex items-center gap-2.5">
            {/* Auto replies toggle — when ON, Mr Lxwa answers incoming messages by itself */}
            <button onClick={toggleAuto} disabled={togglingAuto} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-60"
              style={{ background: autoReply ? "#e7f6ec" : "var(--lx-in)", border: `1px solid ${autoReply ? "#9ae6b4" : "var(--lx-border)"}`, color: autoReply ? "#067647" : "var(--lx-mut)" }}
              title="When on, Mr Lxwa drafts and sends a reply to each incoming message by itself">
              <span className="h-2 w-2 rounded-full" style={{ background: autoReply ? "#17c964" : "#98a2b3" }} />
              Auto replies <b>{autoReply ? "ON" : "OFF"}</b>
            </button>
            <span className="lx-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: "#25D366" }} />
              <span style={{ color: "var(--lx-text)" }}>{status.phone ? `+${status.phone}` : "Connected"}</span>
            </span>
            <button className="lx-10 rounded-full px-2.5 py-1" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-mut)" }} onClick={doDisconnect}>Unlink</button>
          </div>
        )}
      </div>

      {checking ? (
        <div className="lx-card2 flex flex-1 items-center justify-center"><p className="lx-11 lx-mut">Checking connection…</p></div>
      ) : connected ? (
        <Inbox />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <ConnectCta status={status.status} onConnect={() => setModal(true)} />
        </div>
      )}

      <WhatsAppConnectModal open={modal} onClose={() => { setModal(false); poll(); }} onConnected={() => { setEverConnected(true); poll(); }} />
    </div>
  );
}

/* ── pre-connection call to action ───────────────────────────────────────────────────────── */
function ConnectCta({ status, onConnect }: { status: string; onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl p-10 text-center" style={{ background: WA.panel, color: WA.text, maxWidth: 440 }}>
      <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: WA.green }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 21a9 9 0 10-8-4.9L3 21l4.9-1A9 9 0 0012 21z" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      </span>
      <div>
        <h2 className="text-base font-bold">Connect your WhatsApp</h2>
        <p className="text-[13px] mt-1.5" style={{ color: WA.sub }}>
          Link it once — like WhatsApp Web — and every lead you approve becomes a chat you can reply to right here.
        </p>
      </div>
      <button className="rounded-full px-6 py-2.5 text-[14px] font-semibold text-white" style={{ background: WA.green }} onClick={onConnect}>
        {status === "logged_out" ? "Reconnect WhatsApp" : status === "banned" ? "Try another number" : "Connect WhatsApp"}
      </button>
    </div>
  );
}

/* ── the inbox ───────────────────────────────────────────────────────────────────────────── */
function Inbox() {
  const { toast } = useStore();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [inbox, setInbox] = useState<Record<string, { body: string; direction: string; created_at: string; status?: string; unanswered?: number }>>({});
  const [active, setActive] = useState<Lead | null>(null);
  const [newChat, setNewChat] = useState(false);
  const [onWa, setOnWa] = useState<Record<string, boolean | null>>({}); // leadId → on WhatsApp?
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "unread">("all");

  // One batch call checks every chat's number at once, so each row shows a green "On WhatsApp" /
  // red "Not on WhatsApp" badge. Keyed back by lead id.
  const checkOnWhatsApp = useCallback(async (list: Lead[]) => {
    const phones = Array.from(new Set(list.map((l) => (l.whatsapp || l.phone || "").replace(/[^0-9]/g, "")).filter(Boolean)));
    if (!phones.length) return;
    try {
      const r = await fetch("/api/whatsapp/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phones }) }).then((x) => x.json());
      if (!r.ok) return;
      const byLead: Record<string, boolean | null> = {};
      for (const l of list) {
        const d = (l.whatsapp || l.phone || "").replace(/[^0-9]/g, "");
        if (d && d in (r.results ?? {})) byLead[l.id] = r.results[d];
      }
      setOnWa((prev) => ({ ...prev, ...byLead }));
    } catch { /* badges just won't show */ }
  }, []);

  const loadList = useCallback(async () => {
    // Two INDEPENDENT fetches, not Promise.all: the chat list is the leads call, so render it the
    // moment it returns instead of waiting on the heavier last-message query too. The message
    // previews fold in a beat later. This is what made the page sit on "Loading…" for seconds.
    fetch("/api/leads?stage=all")
      .then((r) => r.json())
      .then((ls) => {
        if (!ls.ok) return;
        const all = ls.items as Lead[];
        const inConvo = all.filter((l) =>
          ["approved", "contacted", "delivered", "read", "replied", "in_conversation", "interested", "won", "lost"].includes(l.stage)
        );
        setLeads(inConvo);
        void checkOnWhatsApp(inConvo);
        // ?lead=<id> deep link (the WhatsApp button on a lead row): open that conversation, even
        // if the lead is only approved and has no messages yet.
        const wanted = new URLSearchParams(window.location.search).get("lead");
        setActive((a) => {
          if (a) return inConvo.find((x) => x.id === a.id) ?? a;
          if (wanted) return inConvo.find((x) => x.id === wanted) ?? all.find((x) => x.id === wanted) ?? inConvo[0] ?? null;
          return inConvo[0] ?? null;
        });
      })
      .catch(() => {});

    fetch("/api/whatsapp/messages")
      .then((r) => r.json())
      .then((ib) => {
        if (!ib.ok) return;
        const map: Record<string, any> = {};
        for (const m of ib.inbox ?? []) map[m.lead_id] = { body: m.body, direction: m.direction, created_at: m.created_at, status: m.status, unanswered: m.unanswered };
        setInbox(map);
      })
      .catch(() => {});
  }, [checkOnWhatsApp]);

  useEffect(() => {
    loadList();
    const id = setInterval(loadList, 6000);
    return () => clearInterval(id);
  }, [loadList]);

  if (leads === null) return <div className="flex flex-1 items-center justify-center rounded-3xl" style={{ background: WA.panel }}><p className="text-[13px]" style={{ color: WA.sub }}>Loading…</p></div>;

  // Filtered + sorted (recent-first) list, with the All/Unread tab and the search box applied.
  const unreadCount = leads.filter((l) => (inbox[l.id]?.unanswered ?? 0) > 0).length;
  const needle = q.trim().toLowerCase();
  const visible = leads
    .filter((l) => (tab === "unread" ? (inbox[l.id]?.unanswered ?? 0) > 0 : true))
    .filter((l) => !needle || [l.company, l.name, l.whatsapp, l.phone, inbox[l.id]?.body].some((v) => String(v ?? "").toLowerCase().includes(needle)))
    .sort((a, b) => {
      const ta = inbox[a.id]?.created_at ? new Date(inbox[a.id].created_at).getTime() : 0;
      const tb = inbox[b.id]?.created_at ? new Date(inbox[b.id].created_at).getTime() : 0;
      return tb - ta;
    });

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-3xl" style={{ background: WA.panel, border: `1px solid ${WA.divider}` }}>
      <div className="grid h-full grid-cols-1 md:grid-cols-[340px_1fr]">
        {/* conversation list — hidden on mobile once a chat is open */}
        <div className={`${active ? "hidden md:flex" : "flex"} h-full min-h-0 flex-col overflow-hidden`} style={{ borderRight: `1px solid ${WA.divider}` }}>
          <div className="flex items-center justify-between px-4 pt-3.5" style={{ color: WA.text }}>
            <span className="text-[16px] font-bold">Chats</span>
            <button
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
              style={{ background: WA.green }}
              onClick={() => setNewChat(true)}
              title="Start a chat with any number"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>
              New Chat
            </button>
          </div>
          {/* All / Unread tabs */}
          <div className="flex items-center gap-4 px-4 pt-2 text-[13px] font-semibold">
            {([["all", "All", leads.length], ["unread", "Unread", unreadCount]] as const).map(([k, label, n]) => (
              <button key={k} onClick={() => setTab(k)} className="flex items-center gap-1.5 pb-2" style={{ color: tab === k ? WA.green : WA.sub, borderBottom: `2px solid ${tab === k ? WA.green : "transparent"}` }}>
                {label}
                <span className="rounded-full px-1.5 text-[11px] font-bold" style={{ background: tab === k ? WA.green : WA.divider, color: tab === k ? "#fff" : WA.sub }}>{n}</span>
              </button>
            ))}
          </div>
          {/* search */}
          <div className="px-3 pb-2 pt-1">
            <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: WA.listHover }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={WA.sub} strokeWidth="2" /><path d="M21 21l-4-4" stroke={WA.sub} strokeWidth="2" strokeLinecap="round" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or start new chat" className="w-full bg-transparent text-[13px] outline-none" style={{ color: WA.text }} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ borderTop: `1px solid ${WA.divider}` }}>
            {visible.length === 0 ? (
              <div className="p-5"><p className="text-[13px]" style={{ color: WA.sub }}>{tab === "unread" ? "No unread chats." : q ? "No chats match your search." : "No chats yet. Approve a lead and send the first message, or start a New chat."}</p></div>
            ) : visible.map((l) => {
              const last = inbox[l.id];
              const on = active?.id === l.id;
              const unread = !on && (last?.unanswered ?? 0) > 0 ? last!.unanswered! : 0;
              const tick = last?.direction === "out" ? (last.status === "read" || last.status === "delivered" ? "✓✓" : "✓") : "";
              const tickBlue = last?.status === "read";
              const wa = onWa[l.id]; // true / false / undefined
              return (
                <button
                  key={l.id}
                  onClick={() => setActive(l)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                  style={{ background: on ? WA.listHover : WA.panel, borderBottom: `1px solid ${WA.divider}` }}
                >
                  <WaAvatar size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[14px]" style={{ color: WA.text, fontWeight: unread ? 700 : 600 }}>{l.company || l.name || "Lead"}</span>
                      {wa === true && <span className="flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold" style={{ background: "#e7f6ec", color: "#067647" }}>✓ On WhatsApp</span>}
                      {wa === false && <span className="flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold" style={{ background: "#fdeaea", color: "#b42318" }}>Not on WA</span>}
                    </span>
                    <span className="flex items-center gap-1 truncate text-[12.5px]" style={{ color: unread ? WA.text : WA.sub }}>
                      {tick && <span style={{ color: tickBlue ? WA.tickBlue : WA.sub }}>{tick}</span>}
                      <span className="truncate" style={{ fontWeight: unread ? 600 : 400 }}>{last ? last.body : "Tap to open"}</span>
                    </span>
                  </span>
                  {unread > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white" style={{ background: WA.green }}>{unread}</span>
                  )}
                </button>
              );
            })}
          </div>
          {/* connected status bar, like the reference */}
          <div className="flex items-center gap-2 px-4 py-2.5 text-[11.5px]" style={{ borderTop: `1px solid ${WA.divider}`, color: WA.sub }}>
            <span className="h-2 w-2 rounded-full" style={{ background: "#17c964" }} />
            WhatsApp connected
          </div>
        </div>

        {/* chat pane — full width on mobile when a chat is open */}
        <div className={`${active ? "flex" : "hidden md:flex"} h-full min-h-0 flex-col`} style={{ background: WA.chatBg }}>
          {active ? (
            <Chat lead={active} onSent={loadList} onBack={() => setActive(null)} onDeleted={() => { setActive(null); loadList(); }} toast={toast} />
          ) : (
            <div className="flex h-full items-center justify-center"><p className="text-[13px]" style={{ color: WA.sub }}>Select a chat</p></div>
          )}
        </div>
      </div>

      <NewChatModal
        open={newChat}
        onClose={() => setNewChat(false)}
        onStarted={async (leadId) => {
          setNewChat(false);
          await loadList();
          // open the freshly created chat
          const ls = await fetch("/api/leads?stage=all").then((r) => r.json()).catch(() => null);
          const created = ls?.items?.find((x: Lead) => x.id === leadId);
          if (created) setActive(created);
        }}
        toast={toast}
      />
    </div>
  );
}

function Chat({ lead, onSent, onBack, onDeleted, toast }: { lead: Lead; onSent: () => void; onBack: () => void; onDeleted: () => void; toast: (m: string, t?: "error") => void }) {
  const [thread, setThread] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [dp, setDp] = useState<string | null>(null);
  const [onWa, setOnWa] = useState<boolean | null>(null);
  const [details, setDetails] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const autoFor = useRef<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const phone = lead.whatsapp || lead.phone || "";

  // Grow the compose box with its content, like WhatsApp: it starts one line tall and expands up
  // to ~6 lines (then scrolls), so a long auto-suggested message is fully visible instead of
  // crammed into a single scrolling row.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(140, Math.max(44, ta.scrollHeight))}px`;
  }, [text]);

  const loadThread = useCallback(async () => {
    try {
      const r = await fetch(`/api/whatsapp/messages?leadId=${lead.id}`).then((x) => x.json());
      if (r.ok) setThread(r.thread);
    } catch { /* transient */ }
  }, [lead.id]);

  useEffect(() => {
    setThread(null);
    setText(""); // start each conversation with a clean box (the auto-fill below repopulates it)
    loadThread();
    const id = setInterval(loadThread, 5000);
    return () => clearInterval(id);
  }, [loadThread]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [thread]);

  // Their real WhatsApp profile photo for the chat header. Fetched once per chat (the URL is
  // short-lived); null when there's no visible photo or the number isn't on WhatsApp → silhouette.
  useEffect(() => {
    setDp(null);
    setOnWa(null);
    if (!phone) return;
    let on = true;
    fetch(`/api/whatsapp/avatar?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((d) => { if (!on) return; if (d?.url) setDp(d.url); if (typeof d?.onWhatsapp === "boolean") setOnWa(d.onWhatsapp); })
      .catch(() => {});
    return () => { on = false; };
  }, [phone]);

  const suggest = async () => {
    if (!thread || thread.length === 0) {
      if (lead.draft) setText(lead.draft);
      else toast("No drafted message — write one yourself.", "error");
      return;
    }
    setSuggesting(true);
    try {
      const r = await fetch("/api/whatsapp/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      }).then((x) => x.json());
      if (r.ok && r.reply) setText(r.reply);
      else toast(r.error ?? "Could not draft a reply.", "error");
    } catch (e: any) {
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setSuggesting(false);
    }
  };

  // Auto-suggest, once per conversation opened (not on every 5s poll): the compose box fills
  // itself so the human just reviews and presses Send. An empty chat gets the pre-written draft
  // (free); a chat whose last message is THEIRS gets a Brain-drafted reply (one LLM call).
  useEffect(() => {
    if (thread === null) return; // still loading this lead's thread
    if (autoFor.current === lead.id) return; // already handled this conversation
    autoFor.current = lead.id;
    if (text.trim()) return; // the human is already typing — never overwrite
    if (thread.length === 0) {
      if (lead.draft) setText(lead.draft);
    } else if (thread[thread.length - 1]?.direction === "in") {
      void suggest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, lead.id]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    if (!phone) { toast("This lead has no phone number.", "error"); return; }
    // Optimistic: show the message the instant Send is pressed (like WhatsApp), clock-ticking,
    // and send in the background. The server round-trip no longer blocks the bubble from showing.
    const tmpId = `tmp-${Date.now()}`;
    const optimistic: Msg = { id: tmpId, direction: "out", status: "sending", body, answered_by: "human", created_at: new Date().toISOString() };
    setThread((t) => [...(t ?? []), optimistic]);
    setText("");
    setSending(true);
    try {
      const r = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, phone, text: body }),
      }).then((x) => x.json());
      if (!r.ok) {
        setThread((t) => (t ?? []).filter((m) => m.id !== tmpId)); // pull the optimistic bubble back
        setText(body); // restore the text so they can fix the number or retry
        toast(r.error ?? "Could not send.", "error");
        return;
      }
      await loadThread(); // the real, stored message replaces the optimistic one
      onSent();
    } catch (e: any) {
      setThread((t) => (t ?? []).filter((m) => m.id !== tmpId));
      setText(body);
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* header — WhatsApp green, with a back arrow on mobile */}
      <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ background: WA.green }}>
        <button className="md:hidden" onClick={onBack} aria-label="Back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {/* clicking the contact opens the lead's full details, like the Leads page drawer */}
        <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => setDetails(true)} title="View lead details">
          <WaAvatar size={40} src={dp} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <b className="truncate text-[15px] text-white">{lead.company || lead.name || "Lead"}</b>
              {onWa === false && (
                <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: "#fff", color: "#b42318" }}>
                  <span style={{ fontSize: 10 }}>⛔</span> Not on WhatsApp
                </span>
              )}
              {onWa === true && (
                <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: "rgba(255,255,255,.22)", color: "#fff" }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#9ef0b0" }} /> On WhatsApp
                </span>
              )}
            </div>
            <span className="text-[12px]" style={{ color: "rgba(255,255,255,.8)" }}>
              {phone ? `+${phone.replace(/[^0-9]/g, "")}` : "no number"}
            </span>
          </div>
        </button>
        <button onClick={() => setDetails(true)} className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: "rgba(255,255,255,.18)", color: "#fff" }} title="Lead details">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.2" stroke="#fff" strokeWidth="1.8" /><path d="M5 20a7 7 0 0114 0" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <span className="hidden sm:inline">Contact info</span>
        </button>
      </div>

      {/* a plain "not on WhatsApp" strip when the number has no WhatsApp account (e.g. a landline) */}
      {onWa === false && (
        <div className="px-4 py-2 text-center text-[12.5px]" style={{ background: "#fdeaea", color: "#b42318" }}>
          This number isn’t on WhatsApp — it looks like a landline. Message their mobile/WhatsApp number instead.
        </div>
      )}

      {/* messages */}
      <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-4 sm:px-5" style={{ background: WA.chatBg }}>
        {thread === null ? (
          <p className="text-[13px]" style={{ color: WA.sub }}>Loading…</p>
        ) : thread.length === 0 ? (
          <div className="mx-auto mt-6 max-w-xs rounded-lg px-4 py-3 text-center" style={{ background: "#fff5c4", color: "#54656f" }}>
            <p className="text-[12.5px]">No messages yet. Send the first one below — the conversation starts here.</p>
          </div>
        ) : thread.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={endRef} />
      </div>

      {/* compose */}
      <div className="flex items-end gap-2 px-3 py-2.5" style={{ background: "#f0f2f5" }}>
        <button
          className="shrink-0 rounded-full px-3 py-2.5 text-[12px] font-semibold disabled:opacity-50"
          style={{ background: "#fff", color: WA.green, border: `1px solid ${WA.divider}` }}
          onClick={suggest}
          disabled={suggesting}
          title="Let Mr. Lxwa draft a reply — you can edit it before sending"
        >
          {suggesting ? "…" : "✨ Mr Lxwa"}
        </button>
        <textarea
          ref={taRef}
          className="lx-wa-input flex-1 resize-none rounded-2xl px-4 py-2.5 text-[14px] leading-snug outline-none"
          style={{ background: "#fff", color: WA.text, maxHeight: 140, minHeight: 44, border: "none", overflowY: "auto" }}
          rows={1}
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <button
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
          style={{ background: WA.green }}
          onClick={send}
          disabled={sending || !text.trim() || onWa === false}
          title={onWa === false ? "This number isn't on WhatsApp" : "Send"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 21l18-9L3 3v7l12 2-12 2v7z" fill="#fff" /></svg>
        </button>
      </div>

      {details && <LeadDetailsDrawer lead={lead} onWa={onWa} dp={dp} onClose={() => setDetails(false)} onDeleted={() => { setDetails(false); onDeleted(); }} toast={toast} />}
    </>
  );
}

/** The lead's full story, opened by tapping the contact in the chat header — the same "why this
 *  lead" the Leads page shows, right where you're about to message them: where it came from, which
 *  buyer segment, the score and its breakdown, the evidence, and the contact details. */
function srcLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  return ({ serper: "Google Maps", osm: "OpenStreetMap", places: "Google Places", jobs: "Job board", manual: "Manual", apollo: "Apollo" } as Record<string, string>)[s] ?? s;
}

function LeadDetailsDrawer({ lead, onWa, dp, onClose, onDeleted, toast }: { lead: Lead; onWa: boolean | null; dp: string | null; onClose: () => void; onDeleted: () => void; toast: (m: string, t?: "error") => void }) {
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const del = async () => {
    if (!window.confirm("Delete this contact and its whole conversation permanently? This can't be undone.")) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" }).then((x) => x.json());
      if (!r.ok) { toast(r.error ?? "Could not delete.", "error"); return; }
      toast("Deleted.");
      onDeleted();
    } catch (e: any) {
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const C = { ink: "#111b21", sub: "#667781", line: "#e9edef", soft: "#f0f2f5", brand: "#4f46e5", brandSoft: "#eef2ff", green: "#16a34a", greenSoft: "#e7f6ec" };
  const num = (lead.whatsapp || lead.phone || "").replace(/[^0-9]/g, "");
  const score = lead.icp_score ?? lead.score_breakdown?.score ?? null;
  const groups = lead.score_breakdown?.components
    ? Object.entries(lead.score_breakdown.components.reduce((a: Record<string, { p: number; m: number }>, c) => {
        const g = a[c.group] ?? { p: 0, m: 0 }; a[c.group] = { p: g.p + c.points, m: g.m + c.max }; return a;
      }, {}))
    : [];
  const Row = ({ k, v, href }: { k: string; v?: string | null; href?: string }) =>
    v ? (
      <div className="flex justify-between gap-3 py-1.5 text-[13px]" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span style={{ color: C.sub }}>{k}</span>
        {href ? <a href={href} target="_blank" rel="noreferrer" className="truncate text-right" style={{ color: C.brand }}>{v}</a> : <span className="truncate text-right" style={{ color: C.ink }}>{v}</span>}
      </div>
    ) : null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" style={{ background: "rgba(15,23,42,.35)", colorScheme: "light" }} onClick={onClose}>
      <div className="flex h-full w-full max-w-[420px] flex-col overflow-y-auto" style={{ background: "#fff", color: C.ink }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
          <span className="text-[14px] font-bold">Lead details</span>
          <button onClick={onClose} className="rounded-full p-1.5" style={{ background: C.soft, color: C.sub }} aria-label="Close">✕</button>
        </div>
        <div className="p-4">
          <div className="mb-3 flex items-center gap-3">
            <WaAvatar size={52} src={dp} />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold">{lead.company || lead.name || "Lead"}</div>
              <div className="text-[12.5px]" style={{ color: C.sub }}>{num ? `+${num}` : "no number"}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {score != null && <span className="rounded-md px-1.5 py-0.5 text-[11px] font-bold" style={{ background: C.soft, color: score >= 70 ? C.green : "#d97706" }}>{score}/100</span>}
                {lead.classification && <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: C.greenSoft, color: C.green }}>{lead.classification === "buyer" ? "Buyer ✓" : lead.classification}</span>}
                {onWa === false && <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: "#fdeaea", color: "#b42318" }}>Not on WhatsApp</span>}
                {onWa === true && <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: C.greenSoft, color: C.green }}>On WhatsApp</span>}
              </div>
            </div>
          </div>

          {(lead.observation || lead.reason) && (
            <div className="mb-3 rounded-xl p-3" style={{ background: C.soft }}>
              <div className="mb-1 text-[12px] font-bold" style={{ color: C.ink }}>Why this lead</div>
              <p className="text-[12.5px]" style={{ color: C.sub }}>{lead.observation || lead.reason}</p>
              {lead.evidence?.quote && <p className="mt-1.5 border-l-2 pl-2 text-[12px] italic" style={{ borderColor: C.line, color: C.sub }}>“{lead.evidence.quote}”</p>}
            </div>
          )}

          <div className="mb-1 text-[12px] font-bold" style={{ color: C.ink }}>Details</div>
          <Row k="Segment" v={lead.source_segment} />
          <Row k="Found via" v={lead.source_query} />
          <Row k="Source" v={srcLabel(lead.source)} />
          <Row k="Email" v={lead.email ?? null} href={lead.email ? `mailto:${lead.email}` : undefined} />
          <Row k="Website" v={lead.website ? lead.website.replace(/^https?:\/\//, "") : null} href={lead.website ? (lead.website.startsWith("http") ? lead.website : `https://${lead.website}`) : undefined} />
          <Row k="Country" v={lead.country ?? null} />
          <Row k="City" v={lead.city ?? null} />
          <Row k="Stage" v={lead.stage} />
          <Row k="Added" v={lead.created_at ? new Date(lead.created_at).toLocaleDateString() : null} />
          {lead.reject_reason && <Row k="Rejected as" v={lead.reject_reason} />}

          {groups.length > 0 && (
            <>
              <div className="mb-1 mt-3 text-[12px] font-bold" style={{ color: C.ink }}>Score breakdown</div>
              {groups.map(([g, v]) => (
                <div key={g} className="flex justify-between py-1 text-[12.5px]" style={{ color: C.sub }}>
                  <span className="capitalize">{g === "fit" ? "Buyer fit" : g === "timing" ? "Health & size" : g}</span>
                  <span className="font-semibold" style={{ color: C.ink }}>{(v as any).p}/{(v as any).m}</span>
                </div>
              ))}
            </>
          )}

          {/* permanent delete — for a junk/duplicate contact (e.g. a privacy-LID chat) you never
              want to see again. Hard delete: removes the lead and its whole conversation. */}
          <button onClick={del} disabled={deleting} className="mt-5 w-full rounded-xl py-2.5 text-[13px] font-semibold disabled:opacity-60" style={{ background: "#fdeaea", color: "#b42318" }}>
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** WhatsApp-style default avatar: a muted circle with a white person silhouette, exactly the
 *  placeholder WhatsApp shows for a contact with no photo. */
function WaAvatar({ size = 44, src }: { size?: number; src?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, background: "#d9e0e3" }}
      />
    );
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: "#d9e0e3" }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 212 212" aria-hidden>
        <path fill="#fff" d="M106.251.5C164.653.5 212 47.846 212 106.25S164.653 212 106.25 212 .5 164.654.5 106.25 47.846.5 106.251.5z" opacity="0" />
        <path fill="#aebac1" d="M106.25 0C47.846 0 .5 47.346.5 105.75S47.846 211.5 106.25 211.5 212 164.154 212 105.75 164.654 0 106.25 0zm0 61c17.4 0 31.5 14.1 31.5 31.5S123.65 124 106.25 124s-31.5-14.1-31.5-31.5S88.85 61 106.25 61zm0 123c-26.25 0-49.35-13.35-62.85-33.6 6.6-18.9 44.85-29.25 62.85-29.25s56.25 10.35 62.85 29.25c-13.5 20.25-36.6 33.6-62.85 33.6z" />
      </svg>
    </span>
  );
}

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === "out";
  const tick = m.status === "sending" ? "🕓" : m.status === "read" || m.status === "delivered" ? "✓✓" : m.status === "sent" ? "✓" : "";
  const tickColor = m.status === "read" ? WA.tickBlue : WA.sub;
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%] rounded-lg px-2.5 py-1.5" style={{ background: out ? WA.outBubble : WA.inBubble, color: WA.text, boxShadow: "0 1px 0.5px rgba(11,20,26,.13)" }}>
        <p className="text-[14px]" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</p>
        <div className="mt-0.5 flex items-center justify-end gap-1">
          {m.answered_by === "brain" && out && <span className="text-[10px]" style={{ color: WA.sub }}>AI ·</span>}
          <span className="text-[10px]" style={{ color: WA.sub }}>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {out && tick && <span className="text-[11px]" style={{ color: tickColor }}>{tick}</span>}
        </div>
      </div>
    </div>
  );
}

/* ── New chat: message any number directly (creates an approved lead, then you send) ──────── */
function NewChatModal({ open, onClose, onStarted, toast }: { open: boolean; onClose: () => void; onStarted: (leadId: string) => void; toast: (m: string, t?: "error") => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) { setPhone(""); setName(""); }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const start = async () => {
    const num = phone.replace(/[^0-9+]/g, "");
    if (num.replace(/[^0-9]/g, "").length < 8) { toast("Enter a full number with country code, e.g. +9715...", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: name.trim() || null, name: name.trim() || null, phone: num }),
      }).then((x) => x.json());
      if (!r.ok || !r.id) { toast(r.error ?? "Could not start the chat.", "error"); return; }
      onStarted(r.id);
    } catch (e: any) {
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="lx-card w-full max-w-sm rounded-3xl p-6" style={{ border: "1px solid var(--lx-border)" }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold">New chat</h2>
        <p className="lx-11 lx-mut mt-1 mb-4">Message any number directly. It becomes a lead so you can track the conversation.</p>
        <label className="lx-11 lx-mut mb-1 block">Phone number (with country code)</label>
        <input
          className="lx-12 mb-3 w-full rounded-xl px-3.5 py-2.5 outline-none"
          style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
          placeholder="+971 50 123 4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
        />
        <label className="lx-11 lx-mut mb-1 block">Name (optional)</label>
        <input
          className="lx-12 mb-4 w-full rounded-xl px-3.5 py-2.5 outline-none"
          style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
          placeholder="Company or person"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button className="lx-11 rounded-full px-4 py-2" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-mut)" }} onClick={onClose}>Cancel</button>
          <button className="lx-grad lx-12 rounded-full px-5 py-2 font-semibold disabled:opacity-60" onClick={start} disabled={busy}>{busy ? "Starting…" : "Start chat"}</button>
        </div>
      </div>
    </div>
  );
}
