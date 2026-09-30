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
type Lead = { id: string; company: string | null; name: string | null; whatsapp: string | null; phone: string | null; stage: string; icp_score: number | null; draft?: string | null };
type Msg = { id: string; direction: "in" | "out"; status: string; body: string; answered_by?: string | null; created_at: string };

export default function WhatsAppSection() {
  const { toast } = useStore();
  const [status, setStatus] = useState<Status & { loaded: boolean }>({ status: "checking", qr: null, phone: null, loaded: false });
  const [everConnected, setEverConnected] = useState(false);
  const [modal, setModal] = useState(false);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/status").then((x) => x.json());
      if (r.ok) {
        setStatus({ status: r.status, qr: r.qr ?? null, phone: r.phone ?? null, loaded: true });
        if (r.status === "connected") setEverConnected(true);
      } else setStatus((s) => ({ ...s, loaded: true }));
    } catch {
      setStatus((s) => ({ ...s, loaded: true }));
    }
  }, []);

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
          <div className="flex items-center gap-2">
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
  const [inbox, setInbox] = useState<Record<string, { body: string; direction: string; created_at: string }>>({});
  const [active, setActive] = useState<Lead | null>(null);
  const [newChat, setNewChat] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const [ls, ib] = await Promise.all([
        fetch("/api/leads?stage=all").then((r) => r.json()),
        fetch("/api/whatsapp/messages").then((r) => r.json()),
      ]);
      if (ls.ok) {
        const all = ls.items as Lead[];
        const inConvo = all.filter((l) =>
          ["approved", "contacted", "delivered", "read", "replied", "in_conversation", "interested", "won", "lost"].includes(l.stage)
        );
        setLeads(inConvo);
        // ?lead=<id> deep link (the WhatsApp button on a lead row): open that conversation, even
        // if the lead is only approved and has no messages yet.
        const wanted = new URLSearchParams(window.location.search).get("lead");
        setActive((a) => {
          if (a) return inConvo.find((x) => x.id === a.id) ?? a;
          if (wanted) return inConvo.find((x) => x.id === wanted) ?? all.find((x) => x.id === wanted) ?? inConvo[0] ?? null;
          return inConvo[0] ?? null;
        });
      }
      if (ib.ok) {
        const map: Record<string, any> = {};
        for (const m of ib.inbox ?? []) map[m.lead_id] = { body: m.body, direction: m.direction, created_at: m.created_at };
        setInbox(map);
      }
    } catch { /* transient */ }
  }, []);

  useEffect(() => {
    loadList();
    const id = setInterval(loadList, 6000);
    return () => clearInterval(id);
  }, [loadList]);

  if (leads === null) return <div className="flex flex-1 items-center justify-center rounded-3xl" style={{ background: WA.panel }}><p className="text-[13px]" style={{ color: WA.sub }}>Loading…</p></div>;

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-3xl" style={{ background: WA.panel, border: `1px solid ${WA.divider}` }}>
      <div className="grid h-full grid-cols-1 md:grid-cols-[340px_1fr]">
        {/* conversation list — hidden on mobile once a chat is open */}
        <div className={`${active ? "hidden md:flex" : "flex"} h-full min-h-0 flex-col overflow-hidden`} style={{ borderRight: `1px solid ${WA.divider}` }}>
          <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${WA.divider}` }}>
            <span className="text-[15px] font-semibold" style={{ color: WA.text }}>Chats</span>
            <button
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
              style={{ background: WA.green }}
              onClick={() => setNewChat(true)}
              title="Start a chat with any number"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>
              New chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {leads.length === 0 ? (
              <div className="p-5"><p className="text-[13px]" style={{ color: WA.sub }}>No chats yet. Approve a lead on the Leads page and send the first message, or start a New chat with any number.</p></div>
            ) : leads.map((l) => {
              const last = inbox[l.id];
              const on = active?.id === l.id;
              return (
                <button
                  key={l.id}
                  onClick={() => setActive(l)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                  style={{ background: on ? WA.listHover : WA.panel, borderBottom: `1px solid ${WA.divider}` }}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: WA.green }}>
                    {(l.company || l.name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold" style={{ color: WA.text }}>{l.company || l.name || "Lead"}</span>
                    <span className="block truncate text-[12.5px]" style={{ color: WA.sub }}>
                      {last ? (last.direction === "out" ? "✓ " : "") + last.body : "Tap to open"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* chat pane — full width on mobile when a chat is open */}
        <div className={`${active ? "flex" : "hidden md:flex"} h-full min-h-0 flex-col`} style={{ background: WA.chatBg }}>
          {active ? (
            <Chat lead={active} onSent={loadList} onBack={() => setActive(null)} toast={toast} />
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

function Chat({ lead, onSent, onBack, toast }: { lead: Lead; onSent: () => void; onBack: () => void; toast: (m: string, t?: "error") => void }) {
  const [thread, setThread] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const phone = lead.whatsapp || lead.phone || "";

  const loadThread = useCallback(async () => {
    try {
      const r = await fetch(`/api/whatsapp/messages?leadId=${lead.id}`).then((x) => x.json());
      if (r.ok) setThread(r.thread);
    } catch { /* transient */ }
  }, [lead.id]);

  useEffect(() => {
    setThread(null);
    loadThread();
    const id = setInterval(loadThread, 5000);
    return () => clearInterval(id);
  }, [loadThread]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [thread]);

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

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    if (!phone) { toast("This lead has no phone number.", "error"); return; }
    setSending(true);
    try {
      const r = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, phone, text: body }),
      }).then((x) => x.json());
      if (!r.ok) { toast(r.error ?? "Could not send.", "error"); return; }
      setText("");
      await loadThread();
      onSent();
    } catch (e: any) {
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
        <span className="flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-bold" style={{ background: "rgba(255,255,255,.25)", color: "#fff" }}>
          {(lead.company || lead.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <b className="block truncate text-[15px] text-white">{lead.company || lead.name || "Lead"}</b>
          <span className="text-[12px]" style={{ color: "rgba(255,255,255,.8)" }}>{phone ? `+${phone.replace(/[^0-9]/g, "")}` : "no number"}</span>
        </div>
      </div>

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
          title="Let Mr. Brain draft a message — you can edit it before sending"
        >
          {suggesting ? "…" : "✨ Suggest"}
        </button>
        <textarea
          className="flex-1 resize-none rounded-2xl px-4 py-2.5 text-[14px] outline-none"
          style={{ background: "#fff", color: WA.text, maxHeight: 120, border: "none" }}
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
          disabled={sending || !text.trim()}
          title="Send"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 21l18-9L3 3v7l12 2-12 2v7z" fill="#fff" /></svg>
        </button>
      </div>
    </>
  );
}

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === "out";
  const tick = m.status === "read" || m.status === "delivered" ? "✓✓" : m.status === "sent" ? "✓" : "";
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
