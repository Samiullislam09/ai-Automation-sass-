"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useStore } from "@/lib/store";

/** /dashboard/whatsapp — Mr. WhatsApp, as a WhatsApp-Web-style inbox.
 *
 *  TWO SCREENS IN ONE. Until this workspace has paired a phone, the whole page is the CONNECT
 *  screen: a QR to scan, exactly like linking a device in the WhatsApp app. Once connected it
 *  becomes the INBOX: the leads who are in a conversation on the left, the chat on the right, a
 *  compose box at the bottom.
 *
 *  THE COMPOSE BOX SENDS ONE MESSAGE WHEN YOU PRESS SEND. That is the whole safety model of this
 *  feature and it is visible right here — there is no "send all", no schedule, no auto. Mr. Brain
 *  can drop a suggested reply into the box (the "suggest" button), but it sits there as editable
 *  text until you send it yourself. A person is always the one who sends.
 *
 *  Status is polled, not socketed: the frontend has no socket.io client, and a 3s poll while this
 *  page is open is plenty for a QR that changes every ~20s and a chat a human is watching. */

type Status = { status: string; qr: string | null; phone: string | null };
type Lead = { id: string; company: string | null; name: string | null; whatsapp: string | null; phone: string | null; stage: string; icp_score: number | null; draft?: string | null };
type Msg = { id: string; direction: "in" | "out"; status: string; body: string; answered_by?: string | null; created_at: string };

const STAGE_TONE: Record<string, string> = {
  replied: "var(--lx-green)", in_conversation: "var(--lx-cyan)", contacted: "var(--lx-blue)",
  delivered: "var(--lx-blue)", read: "var(--lx-violet)", won: "var(--lx-green)", interested: "var(--lx-cyan)",
};

export default function WhatsAppSection() {
  const { toast } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [connecting, setConnecting] = useState(false);

  // ── connection status polling ────────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/status").then((x) => x.json());
      if (r.ok) setStatus({ status: r.status, qr: r.qr ?? null, phone: r.phone ?? null });
    } catch { /* transient; next tick retries */ }
  }, []);

  useEffect(() => {
    poll();
    // Poll faster while pairing (QR rotates), slower once connected.
    const id = setInterval(poll, status?.status === "pairing" ? 3000 : 8000);
    return () => clearInterval(id);
  }, [poll, status?.status]);

  // Render the raw QR string Baileys gave us into a scannable image.
  useEffect(() => {
    if (status?.qr) {
      QRCode.toDataURL(status.qr, { width: 264, margin: 1, color: { dark: "#0b0b12", light: "#ffffff" } })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(""));
    } else {
      setQrDataUrl("");
    }
  }, [status?.qr]);

  const startConnect = async () => {
    setConnecting(true);
    try {
      const r = await fetch("/api/whatsapp/connect", { method: "POST" }).then((x) => x.json());
      if (!r.ok) toast(r.error ?? "Could not start pairing.", "error");
      else setStatus({ status: r.status, qr: r.qr ?? null, phone: r.phone ?? null });
    } catch (e: any) {
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setConnecting(false);
    }
  };

  const doDisconnect = async () => {
    try {
      const r = await fetch("/api/whatsapp/disconnect", { method: "POST" }).then((x) => x.json());
      if (r.ok) { setStatus({ status: "disconnected", qr: null, phone: null }); toast("WhatsApp unlinked."); }
      else toast(r.error ?? "Could not unlink.", "error");
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
  };

  const connected = status?.status === "connected";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Mr. WhatsApp</h1>
          <p className="lx-11 lx-mut mt-1">
            Your own WhatsApp, connected here. Messages you get show up below — you read them and reply, one at a time.
            Nothing is ever sent automatically.
          </p>
        </div>
        <ConnBadge status={status?.status ?? "loading"} phone={status?.phone} onDisconnect={doDisconnect} />
      </div>

      {connected ? (
        <Inbox />
      ) : (
        <ConnectScreen
          status={status?.status ?? "disconnected"}
          qrDataUrl={qrDataUrl}
          connecting={connecting}
          onConnect={startConnect}
        />
      )}
    </div>
  );
}

/* ── the small status pill top-right ─────────────────────────────────────────────────────── */
function ConnBadge({ status, phone, onDisconnect }: { status: string; phone?: string | null; onDisconnect: () => void }) {
  const map: Record<string, { label: string; tone: string }> = {
    connected: { label: phone ? `Connected · ${phone}` : "Connected", tone: "var(--lx-green)" },
    pairing: { label: "Scan the QR", tone: "var(--lx-cyan)" },
    disconnected: { label: "Not connected", tone: "var(--lx-mut)" },
    logged_out: { label: "Logged out — reconnect", tone: "var(--lx-red)" },
    banned: { label: "Blocked by WhatsApp", tone: "var(--lx-red)" },
    loading: { label: "…", tone: "var(--lx-mut)" },
  };
  const s = map[status] ?? map.disconnected;
  return (
    <div className="flex items-center gap-2">
      <span className="lx-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)" }}>
        <span className="h-2 w-2 rounded-full" style={{ background: s.tone }} />
        <span style={{ color: "var(--lx-text)" }}>{s.label}</span>
      </span>
      {status === "connected" && (
        <button className="lx-10 rounded-full px-2.5 py-1" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-mut)" }} onClick={onDisconnect}>
          Unlink
        </button>
      )}
    </div>
  );
}

/* ── the connect / QR screen ─────────────────────────────────────────────────────────────── */
function ConnectScreen({ status, qrDataUrl, connecting, onConnect }: { status: string; qrDataUrl: string; connecting: boolean; onConnect: () => void }) {
  const pairing = status === "pairing";
  return (
    <div className="lx-card2 flex flex-col items-center gap-5 p-8 text-center">
      <div className="max-w-md">
        <h2 className="text-base font-bold">Link your WhatsApp</h2>
        <p className="lx-11 lx-mut mt-1.5">
          On your phone open <b>WhatsApp → Settings → Linked devices → Link a device</b>, then point your camera at the code below.
          This links Mr. WhatsApp as a device on your own account — the same as WhatsApp Web.
        </p>
      </div>

      <div className="flex h-[280px] w-[280px] items-center justify-center rounded-2xl" style={{ background: "#fff", border: "1px solid var(--lx-border)" }}>
        {pairing && qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="WhatsApp pairing QR" width={264} height={264} />
        ) : pairing ? (
          <span className="lx-11" style={{ color: "#0b0b12" }}>Generating code…</span>
        ) : (
          <span className="lx-11" style={{ color: "#0b0b12" }}>Press connect to get a code</span>
        )}
      </div>

      {status === "banned" ? (
        <p className="lx-11" style={{ color: "var(--lx-red)" }}>
          WhatsApp has blocked this number. Use a different number, or contact WhatsApp support — a new QR will not help.
        </p>
      ) : (
        <button
          className="lx-grad lx-12 rounded-full px-5 py-2.5 font-semibold disabled:opacity-60"
          onClick={onConnect}
          disabled={connecting || pairing}
        >
          {connecting ? "Starting…" : pairing ? "Waiting for scan…" : status === "logged_out" ? "Reconnect" : "Connect WhatsApp"}
        </button>
      )}
      <p className="lx-10 lx-mut">The code refreshes every few seconds until you scan it.</p>
    </div>
  );
}

/* ── the inbox: conversation list + chat ─────────────────────────────────────────────────── */
function Inbox() {
  const { toast } = useStore();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [inbox, setInbox] = useState<Record<string, { body: string; direction: string; created_at: string }>>({});
  const [active, setActive] = useState<Lead | null>(null);

  const loadList = useCallback(async () => {
    try {
      // Conversations = anyone contacted or further. The leads list is the CRM read; the inbox
      // read gives the last message per lead for the preview line.
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

  if (leads === null) return <div className="lx-card2 p-6"><p className="lx-11 lx-mut">Loading…</p></div>;

  return (
    <div className="lx-card2 grid grid-cols-1 overflow-hidden md:grid-cols-[300px_1fr]" style={{ height: "min(70vh, 640px)", padding: 0 }}>
      {/* conversation list */}
      <div className="flex flex-col overflow-y-auto" style={{ borderRight: "1px solid var(--lx-border)" }}>
        <div className="lx-11 px-4 py-3 font-semibold" style={{ borderBottom: "1px solid var(--lx-border)" }}>
          Conversations ({leads.length})
        </div>
        {leads.length === 0 ? (
          <div className="p-4"><p className="lx-11 lx-mut">No conversations yet. Approve leads and send the first message from the Leads page.</p></div>
        ) : leads.map((l) => {
          const last = inbox[l.id];
          const on = active?.id === l.id;
          return (
            <button
              key={l.id}
              onClick={() => setActive(l)}
              className="flex items-start gap-2.5 px-4 py-3 text-left transition"
              style={{ background: on ? "var(--lx-in)" : "transparent", borderBottom: "1px solid var(--lx-border)" }}
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold" style={{ background: "var(--lx-in)", color: "var(--lx-mut)" }}>
                {(l.company || l.name || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <b className="lx-12 truncate">{l.company || l.name || "Lead"}</b>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STAGE_TONE[l.stage] ?? "var(--lx-mut)" }} />
                </span>
                <span className="lx-10 lx-mut block truncate">
                  {last ? (last.direction === "out" ? "You: " : "") + last.body : l.stage.replace(/_/g, " ")}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* chat pane */}
      {active ? <Chat lead={active} onSent={loadList} toast={toast} /> : (
        <div className="flex items-center justify-center"><p className="lx-11 lx-mut">Pick a conversation</p></div>
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
    if (!phone) { toast("This lead has no phone number to message.", "error"); return; }
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
    <div className="flex flex-col" style={{ minWidth: 0 }}>
      {/* chat header */}
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: "1px solid var(--lx-border)" }}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full font-bold" style={{ background: "var(--lx-in)", color: "var(--lx-mut)" }}>
          {(lead.company || lead.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <b className="lx-12 block truncate">{lead.company || lead.name || "Lead"}</b>
          <span className="lx-10 lx-mut">{phone || "no number"}</span>
        </div>
      </div>

      {/* messages */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" style={{ background: "var(--lx-bg)" }}>
        {thread === null ? (
          <p className="lx-11 lx-mut">Loading…</p>
        ) : thread.length === 0 ? (
          <div className="mx-auto max-w-sm pt-6 text-center">
            <p className="lx-11 lx-mut">No messages yet. Send the first one below — it opens the conversation.</p>
            {lead.draft && (
              <p className="lx-10 lx-mut mt-3">Mr. Lead drafted a first message; press <b>Suggest</b> to load it.</p>
            )}
          </div>
        ) : thread.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={endRef} />
      </div>

      {/* compose */}
      <div className="flex items-end gap-2 px-3 py-3" style={{ borderTop: "1px solid var(--lx-border)" }}>
        {lead.draft && (
          <button
            className="lx-10 shrink-0 rounded-full px-2.5 py-2"
            style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-mut)" }}
            onClick={() => setText(lead.draft ?? "")}
            title="Load Mr. Lead's suggested message into the box — you can edit it before sending"
          >
            Suggest
          </button>
        )}
        <textarea
          className="lx-12 flex-1 resize-none rounded-2xl px-3.5 py-2.5 outline-none"
          style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)", maxHeight: 120 }}
          rows={1}
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <button
          className="lx-grad lx-12 shrink-0 rounded-full px-4 py-2.5 font-semibold disabled:opacity-50"
          onClick={send}
          disabled={sending || !text.trim()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === "out";
  const tick = m.status === "read" ? "✓✓" : m.status === "delivered" ? "✓✓" : m.status === "sent" ? "✓" : "";
  const tickColor = m.status === "read" ? "var(--lx-cyan)" : "var(--lx-mut)";
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[78%] rounded-2xl px-3 py-2"
        style={{
          background: out ? "var(--lx-green)" : "var(--lx-card2)",
          color: out ? "#04120a" : "var(--lx-text)",
          border: out ? "none" : "1px solid var(--lx-border)",
        }}
      >
        <p className="lx-12" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</p>
        <div className="mt-0.5 flex items-center justify-end gap-1">
          {m.answered_by === "brain" && out && (
            <span className="lx-10" style={{ opacity: 0.7 }}>Mr. Brain draft ·</span>
          )}
          <span className="lx-10" style={{ opacity: 0.7 }}>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {out && tick && <span className="lx-10" style={{ color: tickColor }}>{tick}</span>}
        </div>
      </div>
    </div>
  );
}
