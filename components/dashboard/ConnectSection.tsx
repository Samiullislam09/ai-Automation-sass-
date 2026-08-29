"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { LxInput, LxSelect } from "./ui";
import { Globe, LayoutGrid, Link2, Megaphone, MoreHorizontal, Monitor, Play } from "lucide-react";

/** /dashboard/connect — same real logic and API calls as the old app/app/connect/page.tsx
 *  (kept verbatim: /api/integrations, /api/integrations/google, the honesty rule that a card
 *  only says "Connected" once it's actually verified). Visual layer matches a reference mockup
 *  the owner supplied — category tabs, brand-coloured icon badges, one-line descriptions taken
 *  from that mockup, and (2026-08-29 revision) "Manage"/"Connect" opens a modal rather than
 *  expanding the card in place, and a connected card's username is masked rather than shown in
 *  the clear. One deliberate departure from the mockup: it shows an amber "Pending" status, but
 *  /api/integrations only ever writes a row after verifying it live (see that route's own
 *  comment), so there is no real "pending" state to show. The mockup also had cards for tools
 *  this product doesn't integrate with (Gmail, Slack, Zapier, Mailchimp) — those aren't here,
 *  since a Connect button with nothing behind it is exactly the fake state this project avoids;
 *  YouTube is here because it's real, the same generic relay mechanism as the other social
 *  cards (agent-server/app/api/integrations's SOCIAL_TYPES), and Google Analytics is here
 *  because it's real too (bundled into the existing Search Console/GA4/Business Profile OAuth
 *  connection). Rendered inside <MrLxwaDashboard> as its `children` — see
 *  app/dashboard/connect/page.tsx. */

type Item = { type: string; status: string; updatedAt: string; label: string | null; username: string | null };

type Category = "cms" | "social";

type Card = {
  type: string;
  name: string;
  mark: string;
  markBg: string;
  category: Category;
  blurb: string;
  live: boolean;
  fields: { key: string; label: string; placeholder: string; type?: string; hint?: string }[];
};

const CARDS: Card[] = [
  {
    type: "wordpress",
    name: "WordPress",
    mark: "W",
    markBg: "#00669B",
    category: "cms",
    blurb: "Publish and manage content directly from your WordPress site.",
    live: true,
    fields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://yourbusiness.com" },
      { key: "username", label: "WordPress username", placeholder: "admin" },
      {
        key: "appPassword",
        label: "Application password",
        placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx",
        type: "password",
        hint: "Find this at WordPress → Users → Profile → Application Passwords. Paste it with the spaces — your normal login password won't work.",
      },
    ],
  },
  {
    type: "webhook",
    name: "Custom Website",
    mark: "",
    markBg: "#3f3f52",
    category: "cms",
    blurb: "Connect your custom website and automate data exchange.",
    live: true,
    fields: [{ key: "url", label: "Your endpoint URL", placeholder: "https://yourbusiness.com/api/mrlxwa" }],
  },
  {
    type: "social_x",
    name: "X (Twitter)",
    mark: "𝕏",
    markBg: "#000000",
    category: "social",
    blurb: "Post updates, engage, and grow your audience on X automatically.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_linkedin",
    name: "LinkedIn",
    mark: "in",
    markBg: "#0A66C2",
    category: "social",
    blurb: "Share articles, build your brand, and automate LinkedIn engagement.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_facebook",
    name: "Facebook",
    mark: "f",
    markBg: "#1877F2",
    category: "social",
    blurb: "Schedule posts, manage pages, and track performance.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_instagram",
    name: "Instagram",
    mark: "◎",
    markBg: "linear-gradient(45deg,#f9ce34,#ee2a7b 50%,#6228d7)",
    category: "social",
    blurb: "Automate posts, stories, and manage your Instagram presence.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_youtube",
    name: "YouTube",
    mark: "",
    markBg: "#FF0000",
    category: "social",
    blurb: "Manage videos, playlists, and automate channel updates.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
];

const TABS: { key: "all" | Category | "marketing" | "others"; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "All Connections", icon: LayoutGrid },
  { key: "social", label: "Social Media", icon: Link2 },
  { key: "cms", label: "CMS & Website", icon: Monitor },
  { key: "marketing", label: "Marketing", icon: Megaphone },
  { key: "others", label: "Others", icon: MoreHorizontal },
];

type GoogleState = {
  ok: boolean;
  configured?: boolean;
  connected?: boolean;
  email?: string | null;
  scopes?: string[];
  selection?: { gscSiteUrl: string | null; ga4PropertyId: string | null; gbpLocationName: string | null };
  sites?: { siteUrl: string; permission: string }[] | { error: string };
  properties?: { property: string; displayName: string; account: string }[] | { error: string };
  locations?: { name: string; title: string; address: string | null }[] | { error: string };
  lastSync?: string | null;
  tokenError?: string;
};

const RETURN_MESSAGE: Record<string, string> = {
  connected: "",
  denied: "Google permission was denied.",
  bad_state: "Security check failed — try again (is a cookie being blocked?).",
  no_refresh_token: "Google didn't return a refresh token. Go to myaccount.google.com/permissions, remove this app's access, then reconnect.",
  not_configured: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET aren't set.",
  error: "Couldn't connect Google.",
};

const listOf = <T,>(v: T[] | { error: string } | undefined): T[] => (Array.isArray(v) ? v : []);
const errorOf = (v: unknown): string | null => (v && !Array.isArray(v) && (v as any).error) || null;

/** "ag2hq" -> "ag•••" — never show a connected account's username in the clear. */
function mask(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.length <= 2) return "•".repeat(v.length);
  return v.slice(0, 2) + "•".repeat(Math.max(3, v.length - 2));
}

function Icon({ card }: { card: Card }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-extrabold text-white"
      style={{ background: card.markBg }}
    >
      {card.mark || (card.type === "social_youtube" ? <Play size={16} fill="currentColor" /> : <Globe size={18} />)}
    </span>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span
      className="lx-pill mt-1 inline-flex"
      style={
        connected
          ? { color: "#4ade80", borderColor: "rgba(34,197,94,.4)", background: "rgba(34,197,94,.1)" }
          : { color: "var(--lx-mut)", borderColor: "var(--lx-border)", background: "rgba(255,255,255,.03)" }
      }
    >
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

/** Shared modal shell every "Manage"/"Connect" click opens into. */
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)" }} onClick={onClose}>
      <div className="lx-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default function ConnectSection() {
  const { toast, confirmAction } = useStore();
  const [items, setItems] = useState<Item[] | null>(null);
  const [modalCard, setModalCard] = useState<Card | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<{ type: string; value: string } | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [googleConnected, setGoogleConnected] = useState(false);

  const load = () =>
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((d) => setItems(d.ok ? d.items : []))
      .catch(() => setItems([]));

  useEffect(() => { load(); }, []);

  const found = (type: string) => items?.find((i) => i.type === type) ?? null;

  const openConnect = (card: Card) => { setModalCard(card); setEditing(true); setForm({}); setErr({}); };
  const openManage = (card: Card) => { setModalCard(card); setEditing(false); };
  const closeModal = () => { if (busy) return; setModalCard(null); setEditing(false); };

  const connect = async (card: Card) => {
    setBusy(card.type);
    setErr((e) => ({ ...e, [card.type]: "" }));
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: card.type, ...form }),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr((e) => ({ ...e, [card.type]: data.error ?? "Couldn't connect." }));
        return;
      }
      if (data.secret) setSecret({ type: card.type, value: data.secret });
      setModalCard(null);
      setEditing(false);
      setForm({});
      toast(`${card.name} connected.`);
      await load();
    } catch (e: any) {
      setErr((er) => ({ ...er, [card.type]: e?.message ?? "Network error." }));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (card: Card) => {
    const ok = await confirmAction({
      title: `Disconnect ${card.name}?`,
      body: card.live ? "The team will stop publishing here until you connect it again." : "You can connect it again any time.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setBusy(card.type);
    try {
      const res = await fetch(`/api/integrations?type=${card.type}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast(`${card.name} disconnected.`);
      setModalCard(null);
      load();
    } catch (e: any) {
      toast(`Couldn't disconnect ${card.name}: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const totalSlots = CARDS.length + 1; // +1 = Google Analytics (Search Console + GA4 + Business Profile)
  const connectedCount = CARDS.filter((c) => found(c.type)).length + (googleConnected ? 1 : 0);

  const filteredCards = CARDS.filter((c) => tab === "all" || tab === c.category);
  const showGoogle = tab === "all" || tab === "marketing";
  const showOthersEmpty = tab === "others";
  const liveModalItem = modalCard ? found(modalCard.type) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Connect</h1>
        <p className="lx-11 lx-mut mt-1">Connect your tools and accounts to automate and streamline your workflow.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="lx-11 flex items-center gap-2 rounded-xl px-3.5 py-2 font-semibold transition"
                style={
                  active
                    ? { background: "rgba(139,92,246,.16)", border: "1px solid rgba(139,92,246,.5)", color: "#c4b5fd" }
                    : { background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-mut)" }
                }
              >
                <t.icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="lx-in flex items-center gap-2 rounded-xl px-3.5 py-2">
          <Link2 size={16} style={{ color: "var(--lx-purple)" }} />
          <div className="leading-tight">
            <div className="lx-10 lx-mut">Total Connections</div>
            <div className="lx-12 font-bold">{connectedCount} / {totalSlots}</div>
          </div>
        </div>
      </div>

      {secret && (
        <div className="lx-card2 p-4" style={{ borderColor: "var(--lx-cyan)" }}>
          <div className="lx-12 font-bold">Signing secret — shown once</div>
          <p className="lx-11 lx-mut mt-1.5">
            Save this in your site or automation and verify the <code>X-MrLxwa-Signature</code> header on every request.
            It won&apos;t be shown again after you close this — reconnect to generate a new one.
          </p>
          <code className="lx-in lx-11 mt-2 block rounded-lg px-3 py-2" style={{ wordBreak: "break-all" }}>
            {secret.value}
          </code>
          <button className="lx-ghost mt-3" onClick={() => setSecret(null)}>
            Copied — close
          </button>
        </div>
      )}

      {showOthersEmpty ? (
        <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
          <MoreHorizontal size={22} className="lx-mut" />
          <p className="lx-11 lx-mut">No integrations in this category yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredCards.map((card) => {
            const liveItem = found(card.type);
            return (
              <div key={card.type} className="lx-card2 flex flex-col p-4">
                <div className="flex items-start gap-2.5">
                  <Icon card={card} />
                  <div className="min-w-0 flex-1">
                    <div className="lx-12 truncate font-bold">{card.name}</div>
                    <StatusPill connected={!!liveItem} />
                  </div>
                  <button
                    className="lx-icobtn shrink-0"
                    aria-label={liveItem ? `Manage ${card.name}` : `Connect ${card.name}`}
                    onClick={() => (liveItem ? openManage(card) : openConnect(card))}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>

                <p className="lx-11 lx-mut mt-2.5">{card.blurb}</p>

                {liveItem?.label && (
                  <p className="lx-11 mt-2 truncate" style={{ color: "var(--lx-cyan)" }}>{liveItem.label}</p>
                )}

                <div className="mt-auto pt-3">
                  {liveItem ? (
                    <button className="lx-grad lx-11 px-3.5 py-2" onClick={() => openManage(card)}>Manage</button>
                  ) : (
                    <button className="lx-grad lx-11 px-3.5 py-2" onClick={() => openConnect(card)}>Connect</button>
                  )}
                </div>
              </div>
            );
          })}

          {showGoogle && <GoogleCard onToast={toast} confirmAction={confirmAction} onStatusChange={setGoogleConnected} />}
        </div>
      )}

      <p className="lx-11 lx-mut">
        When things get published is controlled in{" "}
        <Link href="/dashboard/schedule" className="underline" style={{ color: "var(--lx-cyan)" }}>Schedule</Link>.
      </p>

      {modalCard && (
        <Modal onClose={closeModal}>
          <div className="mb-3 flex items-center gap-2.5">
            <Icon card={modalCard} />
            <div>
              <div className="lx-13 font-bold">{modalCard.name}</div>
              <StatusPill connected={!!liveModalItem} />
            </div>
          </div>

          {editing ? (
            <div className="space-y-2.5">
              {modalCard.fields.map((f) => (
                <div key={f.key}>
                  <label className="lx-10 lx-mut mb-1 block">{f.label}</label>
                  <LxInput
                    type={f.type ?? "text"}
                    placeholder={f.placeholder}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                  {f.hint && <p className="lx-10 lx-mut mt-1">{f.hint}</p>}
                </div>
              ))}
              {!modalCard.live && (
                <p className="lx-10 lx-mut italic">Auto-posting isn&apos;t live yet — this connection still saves and tests.</p>
              )}
              {modalCard.type === "webhook" && (
                <p className="lx-10 lx-mut">
                  Need help building the endpoint?{" "}
                  <Link href="/connect/nextjs" target="_blank" className="underline" style={{ color: "var(--lx-cyan)" }}>
                    Full setup guide →
                  </Link>
                </p>
              )}
              {err[modalCard.type] && <p className="lx-11" style={{ color: "#f87171" }}>{err[modalCard.type]}</p>}
              <div className="flex gap-2 pt-1">
                <button className="lx-grad lx-11 px-3.5 py-2" disabled={busy === modalCard.type} onClick={() => connect(modalCard)}>
                  {busy === modalCard.type ? "Testing…" : "Test & save"}
                </button>
                <button
                  className="lx-ghost"
                  onClick={() => (liveModalItem ? setEditing(false) : closeModal())}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {liveModalItem?.label && (
                <div>
                  <div className="lx-10 lx-mut">Connected to</div>
                  <div className="lx-11 truncate" style={{ color: "var(--lx-cyan)" }}>{liveModalItem.label}</div>
                </div>
              )}
              {liveModalItem?.username && (
                <div>
                  <div className="lx-10 lx-mut">Username</div>
                  <div className="lx-11">{mask(liveModalItem.username)}</div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button className="lx-grad lx-11 px-3.5 py-2" onClick={() => { setForm({}); setErr({}); setEditing(true); }}>
                  Reconnect
                </button>
                <button className="lx-ghost" style={{ color: "#f87171" }} disabled={busy === modalCard.type} onClick={() => disconnect(modalCard)}>
                  Disconnect
                </button>
                <button className="lx-ghost" onClick={closeModal}>Close</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/** Google Analytics — really the one OAuth connection covering Search Console, GA4 and Business
 *  Profile, shown as a single card matching the rest of the grid, with the same "Manage" ->
 *  modal pattern as every other card. Same real API calls as before; only the shell changed. */
function GoogleCard({ onToast, confirmAction, onStatusChange }: {
  onToast: (m: string, tone?: "ok" | "error" | "info") => void;
  confirmAction: (o: { title: string; body?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  onStatusChange: (connected: boolean) => void;
}) {
  const [g, setG] = useState<GoogleState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState({ gscSiteUrl: "", ga4PropertyId: "", gbpLocationName: "" });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [syncResult, setSyncResult] = useState<any>(null);

  const load = () =>
    fetch("/api/integrations/google")
      .then((r) => r.json())
      .then((d: GoogleState) => {
        setG(d);
        onStatusChange(!!d.connected);
        setSel({
          gscSiteUrl: d.selection?.gscSiteUrl ?? "",
          ga4PropertyId: d.selection?.ga4PropertyId ?? "",
          gbpLocationName: d.selection?.gbpLocationName ?? "",
        });
      })
      .catch(() => setG({ ok: false }));

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("google");
    if (status) {
      setMsg(RETURN_MESSAGE[status] ?? RETURN_MESSAGE.error);
      window.history.replaceState({}, "", window.location.pathname);
    }
    load();
  }, []);

  const syncNow = async (quiet = false) => {
    setBusy("sync");
    const res = await fetch("/api/integrations/google/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: e?.message }));
    setBusy("");
    setSyncResult(res);
    if (!quiet) onToast(res.ok ? "Google data refreshed." : "Refresh failed.", res.ok ? "ok" : "error");
    load();
  };

  const saveSelection = async () => {
    setBusy("save");
    const res = await fetch("/api/integrations/google", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sel),
    }).then((r) => r.json()).catch(() => ({ ok: false }));
    setBusy("");
    if (!res.ok) { setMsg(res.error ?? "Couldn't save."); return; }
    onToast("Google selection saved.");
    setSelecting(false);
    void syncNow(true);
  };

  const disconnect = async () => {
    const ok = await confirmAction({
      title: "Disconnect Google?",
      body: "Search Console and Analytics data will stop refreshing. The team goes back to guessing from the site crawl.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setBusy("disc");
    try {
      const res = await fetch("/api/integrations/google", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onToast("Google disconnected.");
      setSyncResult(null);
      setModalOpen(false);
      load();
    } catch (e: any) {
      onToast(`Couldn't disconnect Google: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  const card: Card = { type: "google", name: "Google Analytics", mark: "G", markBg: "#1a1a24", category: "cms", blurb: "", live: true, fields: [] };

  if (!g) {
    return (
      <div className="lx-card2 flex flex-col p-4">
        <p className="lx-11 lx-mut">Checking Google status…</p>
      </div>
    );
  }

  const sites = listOf(g.sites);
  const properties = listOf(g.properties);
  const locations = listOf(g.locations);
  const hasGbpScope = (g.scopes ?? []).some((s) => s.includes("business.manage"));
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const openModal = () => { setModalOpen(true); setSelecting(!g.connected); };
  const closeModal = () => { if (busy) return; setModalOpen(false); setSelecting(false); };

  return (
    <div className="lx-card2 flex flex-col p-4">
      <div className="flex items-start gap-2.5">
        <Icon card={card} />
        <div className="min-w-0 flex-1">
          <div className="lx-12 truncate font-bold">Google Analytics</div>
          <StatusPill connected={!!g.connected} />
        </div>
        <button className="lx-icobtn shrink-0" aria-label="Manage Google Analytics" onClick={openModal}>
          <MoreHorizontal size={14} />
        </button>
      </div>

      <p className="lx-11 lx-mut mt-2.5">Track website performance and get insights automatically.</p>

      <div className="mt-auto pt-3">
        <button className="lx-grad lx-11 px-3.5 py-2" onClick={openModal}>{g.connected ? "Manage" : "Connect"}</button>
      </div>

      {modalOpen && (
        <Modal onClose={closeModal}>
          <div className="mb-3 flex items-center gap-2.5">
            <Icon card={card} />
            <div>
              <div className="lx-13 font-bold">Google Analytics</div>
              <StatusPill connected={!!g.connected} />
            </div>
          </div>

          {msg && <p className="lx-11 mb-2" style={{ color: "#f87171" }}>{msg}</p>}

          {!g.configured ? (
            <p className="lx-11 lx-mut">
              Needs a one-time Google Cloud OAuth client. Enable Search Console API, Google Analytics Admin API and Data
              API, create an OAuth client with redirect URI <code className="lx-10">{origin}/api/integrations/google/callback</code>,
              then set <code className="lx-10">GOOGLE_CLIENT_ID</code>/<code className="lx-10">GOOGLE_CLIENT_SECRET</code> and redeploy.
            </p>
          ) : !g.connected ? (
            <div className="space-y-2.5">
              <p className="lx-11 lx-mut">Read-only access — nothing is posted or changed.</p>
              <div className="flex flex-wrap gap-2">
                <a className="lx-grad lx-11 px-3.5 py-2" href="/api/integrations/google/start">Connect Google</a>
                <a className="lx-ghost" href="/api/integrations/google/start?gbp=1">Also connect Business Profile</a>
              </div>
            </div>
          ) : selecting ? (
            <div className="space-y-2.5">
              {g.tokenError && (
                <p className="lx-11" style={{ color: "#f87171" }}>
                  {g.tokenError} — <a className="underline" style={{ color: "var(--lx-cyan)" }} href="/api/integrations/google/start">reconnect</a>
                </p>
              )}
              <div>
                <label className="lx-10 lx-mut mb-1 block">Search Console property</label>
                <LxSelect value={sel.gscSiteUrl} onChange={(e) => setSel((s) => ({ ...s, gscSiteUrl: e.target.value }))}>
                  <option value="">— select —</option>
                  {sites.map((s) => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
                </LxSelect>
                {errorOf(g.sites) && <p className="lx-10 mt-1" style={{ color: "#f87171" }}>{errorOf(g.sites)}</p>}
                {!errorOf(g.sites) && !sites.length && <p className="lx-10 lx-mut mt-1">No verified Search Console property found.</p>}
              </div>
              <div>
                <label className="lx-10 lx-mut mb-1 block">Analytics 4 property</label>
                <LxSelect value={sel.ga4PropertyId} onChange={(e) => setSel((s) => ({ ...s, ga4PropertyId: e.target.value }))}>
                  <option value="">— select —</option>
                  {properties.map((p) => <option key={p.property} value={p.property}>{p.displayName} ({p.account})</option>)}
                </LxSelect>
                {errorOf(g.properties) && <p className="lx-10 mt-1" style={{ color: "#f87171" }}>{errorOf(g.properties)}</p>}
              </div>
              {hasGbpScope ? (
                <div>
                  <label className="lx-10 lx-mut mb-1 block">Business Profile location</label>
                  <LxSelect value={sel.gbpLocationName} onChange={(e) => setSel((s) => ({ ...s, gbpLocationName: e.target.value }))}>
                    <option value="">— select —</option>
                    {locations.map((l) => <option key={l.name} value={l.name}>{l.title}{l.address ? ` — ${l.address}` : ""}</option>)}
                  </LxSelect>
                </div>
              ) : (
                <p className="lx-10 lx-mut">
                  Business Profile not connected.{" "}
                  <a className="underline" style={{ color: "var(--lx-cyan)" }} href="/api/integrations/google/start?gbp=1">Connect it →</a>
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button className="lx-grad lx-11 px-3.5 py-2" disabled={!!busy} onClick={saveSelection}>{busy === "save" ? "Saving…" : "Save & sync"}</button>
                <button className="lx-ghost" onClick={() => setSelecting(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {g.email && (
                <div>
                  <div className="lx-10 lx-mut">Account</div>
                  <div className="lx-11">{g.email}</div>
                </div>
              )}
              <p className="lx-10 lx-mut">
                {g.lastSync ? `Last sync ${new Date(g.lastSync).toLocaleString()}` : "Not synced yet"}
                {syncResult?.ok && !syncResult.skipped ? ` · ${syncResult.counts?.queries ?? 0} searches · ${syncResult.counts?.gscPages ?? 0} pages` : ""}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button className="lx-grad lx-11 px-3.5 py-2" onClick={() => setSelecting(true)}>Change settings</button>
                <button className="lx-ghost" disabled={!!busy} onClick={() => syncNow()}>{busy === "sync" ? "Syncing…" : "Refresh now"}</button>
                <button className="lx-ghost" style={{ color: "#f87171" }} disabled={!!busy} onClick={disconnect}>Disconnect</button>
                <button className="lx-ghost" onClick={closeModal}>Close</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
