"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import WhatsAppConnectModal from "./WhatsAppConnectModal";

/** /dashboard/whatsapp — Mr. WhatsApp, made to look and feel like WhatsApp itself.
 *
 *  WHY THIS ONE PANEL IS WHITE while the rest of the dashboard is dark (owner, 2026-09-30: "ek
 *  dam simple whatsapp jaisa, white bg pe"). A non-technical user has used WhatsApp for years;
 *  the fastest way for them to trust and operate an inbox is for it to BE the inbox they know —
 *  the green header, the conversation list, the wallpaper chat area, the green outgoing bubbles.
 *  So this component renders its own WhatsApp-authentic surface with hard-coded WhatsApp colours,
 *  not the dashboard's theme tokens, on purpose. It is the one screen that should not look like
 *  the product.
 *
 *  THE COMPOSE BOX SENDS ONE MESSAGE WHEN YOU PRESS SEND. No "send all", no schedule, no auto.
 *  Mr. Brain can drop a suggested reply into the box, but it waits there until you send it. A
 *  person always sends.
 *
 *  NO "not connected" FLICKER. Status starts as `checking`, and once we have ever seen
 *  `connected` we do not fall back to the connect screen on a single empty poll — only an
 *  explicit disconnected/logged_out from a successful response flips it. The old code showed the
 *  Connect call-to-action for the 1-2s before the first poll returned, which read as "it
 *  disconnected" every time the page loaded. */

const WA = {
  green: "#008069",       // WhatsApp header green
  greenDark: "#017561",
  panel: "#ffffff",
  listHover: "#f5f6f6",
  chatBg: "#efeae2",      // the classic chat wallpaper tone
  outBubble: "#d9fdd3",   // outgoing green
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
      } else {
        // A failed status read does NOT mean disconnected — keep the last good state, just mark loaded.
        setStatus((s) => ({ ...s, loaded: true }));
      }
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

  // "connected" is sticky: once seen, a single empty poll cannot knock us back to the CTA.
  const connected = status.status === "connected" || (everConnected && status.status === "checking");
  const checking = !status.loaded && !everConnected;

  return (
    <div className="space-y-4">
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
        <div className="lx-card2 flex items-center justify-center p-16"><p className="lx-11 lx-mut">Checking connection…</p></div>
      ) : connected ? (
        <Inbox />
      ) : (
        <ConnectCta status={status.status} onConnect={() => setModal(true)} />
      )}

      <WhatsAppConnectModal open={modal} onClose={() => { setModal(false); poll(); }} onConnected={() => { setEverConnected(true); poll(); }} />
    </div>
  );
}

/* ── pre-connection call to action (opens the modal) ─────────────────────────────────────── */
function ConnectCta({ status, onConnect }: { status: string; onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl p-10 text-center" style={{ background: WA.panel, color: WA.text }}>
      <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: WA.green }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 21a9 9 0 10-8-4.9L3 21l4.9-1A9 9 0 0012 21z" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      </span>
      <div className="max-w-sm">
        <h2 className="text-base font-bold">Apna WhatsApp jodo</h2>
        <p className="text-[13px] mt-1.5" style={{ color: WA.sub }}>
          Ek baar link karo — WhatsApp Web jaisa — aur har approved lead yahin ek chat ban jayega jise tum reply kar sako.
        </p>
      </div>
      <button className="rounded-full px-6 py-2.5 text-[14px] font-semibold text-white" style={{ background: WA.green }} onClick={onConnect}>
        {status === "logged_out" ? "Reconnect WhatsApp" : status === "banned" ? "Try another number" : "Connect WhatsApp"}
      </button>
    </div>
  );
}

/* ── the inbox: WhatsApp-authentic, white ────────────────────────────────────────────────── */
function Inbox() {
  const { toast } = useStore();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [inbox, setInbox] = useState<Record<string, { body: string; direction: string; created_at: string }>>({});
  const [active, setActive] = useState<Lead | null>(null);

  const loadList = useCallback(async () => {
    try {
      const [ls, ib] = await Promise.all([
        fetch("/api/leads?stage=all").then((r) => r.json()),
        fetch("/api/whatsapp/messages").then((r) => r.json()),
      ]);
      if (ls.ok) {
        const inConvo = (ls.items as Lead[]).filter((l) =>
          ["contacted", "delivered", "read", "replied", "in_conversation", "interested", "won", "lost"].includes(l.stage)
        );
        setLeads(inConvo);
        setActive((a) => a ?? inConvo[0] ?? null);
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

  if (leads === null) return <div className="flex items-center justify-center rounded-3xl p-16" style={{ background: WA.panel }}><p className="text-[13px]" style={{ color: WA.sub }}>Loading…</p></div>;

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-3xl md:grid-cols-[320px_1fr]" style={{ height: "min(72vh, 660px)", background: WA.panel, border: `1px solid ${WA.divider}` }}>
      {/* conversation list */}
      <div className="flex flex-col overflow-y-auto" style={{ borderRight: `1px solid ${WA.divider}`, background: WA.panel }}>
        <div className="px-4 py-3.5 text-[15px] font-semibold" style={{ color: WA.text, borderBottom: `1px solid ${WA.divider}` }}>
          Chats
        </div>
        {leads.length === 0 ? (
          <div className="p-5"><p className="text-[13px]" style={{ color: WA.sub }}>Abhi koi chat nahi. Leads page pe kisi ko approve karke pehla message bhejo — wo yahan aa jayega.</p></div>
        ) : leads.map((l) => {
          const last = inbox[l.id];
          const on = active?.id === l.id;
          return (
            <button
              key={l.id}
              onClick={() => setActive(l)}
              className="flex items-center gap-3 px-3.5 py-3 text-left"
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

      {active ? <Chat lead={active} onSent={loadList} toast={toast} /> : (
        <div className="flex items-center justify-center" style={{ background: WA.chatBg }}><p className="text-[13px]" style={{ color: WA.sub }}>Ek chat chuno</p></div>
      )}
    </div>
  );
}

function Chat({ lead, onSent, toast }: { lead: Lead; onSent: () => void; toast: (m: string, t?: "error") => void }) {
  const [thread, setThread] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
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

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    if (!phone) { toast("Is lead ka number nahi hai.", "error"); return; }
    setSending(true);
    try {
      const r = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, phone, text: body }),
      }).then((x) => x.json());
      if (!r.ok) { toast(r.error ?? "Bhej nahi paye.", "error"); return; }
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
    <div className="flex flex-col" style={{ minWidth: 0, background: WA.chatBg }}>
      {/* header — WhatsApp green */}
      <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: WA.green }}>
        <span className="flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-bold" style={{ background: "rgba(255,255,255,.25)", color: "#fff" }}>
          {(lead.company || lead.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <b className="block truncate text-[15px] text-white">{lead.company || lead.name || "Lead"}</b>
          <span className="text-[12px]" style={{ color: "rgba(255,255,255,.8)" }}>{phone ? `+${phone.replace(/[^0-9]/g, "")}` : "no number"}</span>
        </div>
      </div>

      {/* messages */}
      <div className="flex-1 space-y-1.5 overflow-y-auto px-5 py-4" style={{ background: WA.chatBg }}>
        {thread === null ? (
          <p className="text-[13px]" style={{ color: WA.sub }}>Loading…</p>
        ) : thread.length === 0 ? (
          <div className="mx-auto mt-6 max-w-xs rounded-lg px-4 py-3 text-center" style={{ background: "#fff5c4", color: "#54656f" }}>
            <p className="text-[12.5px]">Abhi koi message nahi. Neeche pehla message bhejo — chat yahin se shuru hogi.</p>
          </div>
        ) : thread.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={endRef} />
      </div>

      {/* compose */}
      <div className="flex items-end gap-2 px-3 py-2.5" style={{ background: "#f0f2f5" }}>
        {lead.draft && (
          <button
            className="shrink-0 rounded-full px-3 py-2.5 text-[12px] font-semibold"
            style={{ background: "#fff", color: WA.green, border: `1px solid ${WA.divider}` }}
            onClick={() => setText(lead.draft ?? "")}
            title="Mr. Lead ka likha message box me daalo — bhejne se pehle badal bhi sakte ho"
          >
            Suggest
          </button>
        )}
        <textarea
          className="flex-1 resize-none rounded-2xl px-4 py-2.5 text-[14px] outline-none"
          style={{ background: "#fff", color: WA.text, maxHeight: 120, border: "none" }}
          rows={1}
          placeholder="Message likho…"
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
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === "out";
  const tick = m.status === "read" || m.status === "delivered" ? "✓✓" : m.status === "sent" ? "✓" : "";
  const tickColor = m.status === "read" ? WA.tickBlue : WA.sub;
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[75%] rounded-lg px-2.5 py-1.5"
        style={{ background: out ? WA.outBubble : WA.inBubble, color: WA.text, boxShadow: "0 1px 0.5px rgba(11,20,26,.13)" }}
      >
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
