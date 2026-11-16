"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import WhatsAppConnectModal from "./WhatsAppConnectModal";
import { LxInput, LxSelect } from "./ui";
import { Bell, Globe, LayoutGrid, Link2, Megaphone, MessageCircle, MoreHorizontal, Monitor } from "lucide-react";
import TeamAlerts, { TEAM_ALERTS_CAPTION, useAdmins } from "./whatsapp/TeamAlerts";
import type { IconType } from "react-icons";
import { FaFacebookF, FaInstagram, FaLinkedinIn, FaYoutube } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import { SiGoogleanalytics, SiWordpress } from "react-icons/si";

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
  icon: IconType | null;
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
    icon: SiWordpress,
    markBg: "#21759B",
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
    icon: null,
    markBg: "#3f3f52",
    category: "cms",
    blurb: "Connect your custom website and automate data exchange.",
    live: true,
    fields: [{ key: "url", label: "Your endpoint URL", placeholder: "https://yourbusiness.com/api/mrlxwa" }],
  },
  {
    type: "social_x",
    name: "X (Twitter)",
    icon: FaXTwitter,
    markBg: "#000000",
    category: "social",
    blurb: "Post updates, engage, and grow your audience on X automatically.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_linkedin",
    name: "LinkedIn",
    icon: FaLinkedinIn,
    markBg: "#0A66C2",
    category: "social",
    blurb: "Share articles, build your brand, and automate LinkedIn engagement.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_facebook",
    name: "Facebook",
    icon: FaFacebookF,
    markBg: "#1877F2",
    category: "social",
    blurb: "Schedule posts, manage pages, and track performance.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_instagram",
    name: "Instagram",
    icon: FaInstagram,
    markBg: "linear-gradient(45deg,#f9ce34,#ee2a7b 50%,#6228d7)",
    category: "social",
    blurb: "Automate posts, stories, and manage your Instagram presence.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_youtube",
    name: "YouTube",
    icon: FaYoutube,
    markBg: "#FF0000",
    category: "social",
    blurb: "Manage videos, playlists, and automate channel updates.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
];

type TabKey = "all" | Category | "marketing" | "messaging";
const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "All Connections", icon: LayoutGrid },
  { key: "social", label: "Social Media", icon: Link2 },
  { key: "cms", label: "CMS & Website", icon: Monitor },
  { key: "marketing", label: "Marketing", icon: Megaphone },
  { key: "messaging", label: "Messaging", icon: MessageCircle },
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
  const Glyph = card.icon;
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
      style={{ background: card.markBg }}
    >
      {Glyph ? <Glyph size={13} /> : <Globe size={14} />}
    </span>
  );
}

/** The ONE card every integration uses (WhatsApp, each CMS and social tool, Google), so they all
 *  look and behave the same: mark, name, status, one line of what it does, one clear action.
 *  Connected cards are outlined in green and offer "Manage"; the rest offer "Connect". On a phone
 *  the card becomes a compact row so the whole list is scannable without scrolling forever. */
function ConnTile({ mark, name, state, blurb, detail, onAction, label, pill }: {
  mark: React.ReactNode; name: string; state: "connected" | "pairing" | "off"; blurb: string; detail?: string | null;
  onAction: () => void; label: string;
  /** Wording for the status pill when "Connected / Not connected" is not the right words (Team alerts: Active / Not set up). */
  pill?: { on: string; off: string };
}) {
  const on = state === "connected";
  return (
    <div className={`cn-card ${on ? "on" : ""}`}>
      <span className="cn-mark">{mark}</span>
      <div className="cn-body">
        <div className="cn-top">
          <b className="cn-name">{name}</b>
          <span className={`cn-pill ${state}`}>
            <i />{state === "connected" ? (pill?.on ?? "Connected") : state === "pairing" ? "Scanning" : (pill?.off ?? "Not connected")}
          </span>
        </div>
        <p className="cn-blurb">{blurb}</p>
        {detail && <p className="cn-detail">{detail}</p>}
      </div>
      <button className={`cn-act ${on ? "sec" : "pri"}`} onClick={onAction} aria-label={`${label} ${name}`}>{label}</button>
    </div>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span
      className="lx-pill mt-0.5 inline-flex"
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4" style={{ background: "rgba(0,0,0,.6)" }} onClick={onClose}>
      <div className="lx-card w-full max-w-sm p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
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
  const [waModal, setWaModal] = useState(false);
  const [teamModal, setTeamModal] = useState(false);
  const { admins, reload: reloadAdmins } = useAdmins();
  const [waStatus, setWaStatus] = useState<string>("loading");
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

  const totalSlots = CARDS.length + 2; // +1 Google (Search Console, GA4, Business Profile), +1 WhatsApp
  const connectedCount = CARDS.filter((c) => found(c.type)).length + (googleConnected ? 1 : 0) + (waStatus === "connected" ? 1 : 0);

  const filteredCards = CARDS.filter((c) => tab === "all" || tab === c.category);
  const showGoogle = tab === "all" || tab === "marketing";
  // Mr. WhatsApp status for the card below. Its own connection (Baileys), separate from the
  // /api/integrations cards, so it has its own status read and its own pairing modal.
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/whatsapp/status").then((r) => r.json()).then((d) => { if (alive && d.ok) setWaStatus(d.status); }).catch(() => {});
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [waModal]);

  const liveModalItem = modalCard ? found(modalCard.type) : null;

  const teamActive = (admins ?? []).filter((a) => a.notify);
  const teamOn = teamActive.length > 0;

  const waState: "connected" | "pairing" | "off" = waStatus === "connected" || waStatus === "reconnecting" || waStatus === "in_use_elsewhere" ? "connected" : waStatus === "pairing" ? "pairing" : "off";
  const showWa = tab === "all" || tab === "messaging";

  return (
    <div className="cn-page">
      <style dangerouslySetInnerHTML={{ __html: CONNECT_CSS }} />
      <header className="cn-head">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">Connect</h1>
          <p className="lx-11 lx-mut mt-1">Link your accounts once. Mr. Lxwa then publishes, replies and reports for you.</p>
        </div>
        <div className="cn-total" title="Connected out of all available">
          <span className="cn-total-n">{connectedCount}<small> / {totalSlots}</small></span>
          <span className="cn-total-l">connected</span>
          <span className="cn-bar"><i style={{ width: `${Math.round((connectedCount / Math.max(1, totalSlots)) * 100)}%` }} /></span>
        </div>
      </header>

      <WhatsAppConnectModal open={waModal} onClose={() => setWaModal(false)} onConnected={() => setWaStatus("connected")} />

      {teamModal && (
        <Modal onClose={() => { setTeamModal(false); void reloadAdmins(); }}>
          <div className="mb-3 flex items-start gap-2.5">
            <span className="cn-glyph" style={{ background: "#f59e0b" }}><Bell size={18} color="#1f1300" /></span>
            <div className="min-w-0">
              <div className="lx-13 font-bold">Team alerts</div>
              <p className="lx-11 lx-mut mt-0.5 leading-relaxed">{TEAM_ALERTS_CAPTION}</p>
            </div>
          </div>
          <TeamAlerts
            compact
            toast={toast}
            onChange={() => void reloadAdmins()}
            palette={{ rowBg: "rgba(255,255,255,.04)", text: "var(--lx-text)", sub: "var(--lx-mut)", line: "var(--lx-border)", accent: "#128c7e", inputBg: "var(--lx-in)", inputText: "var(--lx-text)", onBg: "rgba(34,197,94,.14)", onText: "#4ade80", danger: "#f87171" }}
          />
          <button className="lx-ghost mt-3" onClick={() => { setTeamModal(false); void reloadAdmins(); }}>Done</button>
        </Modal>
      )}

      <div className="cn-tabs" role="tablist" aria-label="Connection categories">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`cn-tab ${tab === t.key ? "on" : ""}`}>
            <t.icon size={14} />{t.label}
          </button>
        ))}
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

      <div className="cn-grid">
        {showWa && (
          <ConnTile
            name="WhatsApp"
            state={waState}
            blurb="Link your own number to message and reply to leads, one at a time, by you."
            label={waState === "connected" ? "Manage" : waState === "pairing" ? "Continue" : "Connect"}
            onAction={() => setWaModal(true)}
            mark={
              <span className="cn-glyph" style={{ background: "#25D366" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 21a9 9 0 10-8-4.9L3 21l4.9-1A9 9 0 0012 21z" stroke="#04120a" strokeWidth="1.8" strokeLinejoin="round" /></svg>
              </span>
            }
          />
        )}
        {showWa && (
          <ConnTile
            name="Team alerts"
            state={teamOn ? "connected" : "off"}
            pill={{ on: "Active", off: "Not set up" }}
            blurb="Instant WhatsApp updates on your phone when a lead wants a meeting, is ready to buy, or needs you."
            detail={teamOn ? `${teamActive.length} number${teamActive.length === 1 ? "" : "s"} receiving alerts${teamActive[0] ? ` · ${teamActive[0].name || teamActive[0].phone}${teamActive.length > 1 ? ` +${teamActive.length - 1}` : ""}` : ""}` : null}
            label={teamOn ? "Manage" : "Set up"}
            onAction={() => setTeamModal(true)}
            mark={<span className="cn-glyph" style={{ background: "#f59e0b" }}><Bell size={18} color="#1f1300" /></span>}
          />
        )}
        {filteredCards.map((card) => {
          const liveItem = found(card.type);
          return (
            <ConnTile
              key={card.type}
              name={card.name}
              state={liveItem ? "connected" : "off"}
              blurb={card.blurb}
              detail={liveItem?.label ?? null}
              label={liveItem ? "Manage" : "Connect"}
              onAction={() => (liveItem ? openManage(card) : openConnect(card))}
              mark={<span className="cn-glyph" style={{ background: card.markBg }}>{card.icon ? <card.icon size={18} /> : <Globe size={18} />}</span>}
            />
          );
        })}
        {showGoogle && <GoogleCard onToast={toast} confirmAction={confirmAction} onStatusChange={setGoogleConnected} />}
        {!showWa && !showGoogle && filteredCards.length === 0 && (
          <div className="cn-empty"><MoreHorizontal size={20} /><p>No integrations in this category yet.</p></div>
        )}
      </div>

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
              <div className="flex flex-wrap gap-2 pt-1">
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

  const card: Card = { type: "google", name: "Google", icon: SiGoogleanalytics, markBg: "#E37400", category: "cms", blurb: "", live: true, fields: [] };

  if (!g) {
    return (
      <div className="cn-card"><span className="cn-mark"><span className="cn-glyph" style={{ background: "#E37400" }}><SiGoogleanalytics size={18} /></span></span>
        <div className="cn-body"><b className="cn-name">Google</b><p className="cn-blurb">Checking status…</p></div></div>
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
    <>
      <ConnTile
        name="Google"
        state={g.connected ? "connected" : "off"}
        blurb="Connect Google once for Calendar and Meet (auto-booked meetings), Search Console, Analytics and Business Profile."
        detail={g.connected ? g.email ?? null : null}
        label={g.connected ? "Manage" : "Connect"}
        onAction={openModal}
        mark={<span className="cn-glyph" style={{ background: "#E37400" }}><SiGoogleanalytics size={18} /></span>}
      />

      {modalOpen && (
        <Modal onClose={closeModal}>
          <div className="mb-3 flex items-center gap-2.5">
            <Icon card={card} />
            <div>
              <div className="lx-13 font-bold">Google</div>
              <StatusPill connected={!!g.connected} />
            </div>
          </div>

          {msg && <p className="lx-11 mb-2" style={{ color: "#f87171" }}>{msg}</p>}

          {!g.configured ? (
            <p className="lx-11 lx-mut">
              Needs a one-time Google Cloud OAuth client. Enable Search Console API, Google Analytics Admin API and Data
              API, and <strong>Google Calendar API</strong> (for Meet booking), create an OAuth client with redirect URI <code className="lx-10">{origin}/api/integrations/google/callback</code>,
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
              <div className="flex flex-wrap gap-2 pt-1">
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
    </>
  );
}


const CONNECT_CSS = `
.cn-page{display:grid;gap:16px}
.cn-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px}
.cn-total{display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:baseline;min-width:150px;padding:10px 14px;border-radius:12px;
  background:var(--lx-card);border:1px solid var(--lx-border)}
.cn-total-n{font-size:20px;font-weight:800;line-height:1;color:var(--lx-text)}
.cn-total-n small{font-size:12px;font-weight:600;color:var(--lx-mut)}
.cn-total-l{font-size:11px;color:var(--lx-mut)}
.cn-bar{grid-column:1/-1;height:4px;margin-top:8px;border-radius:99px;background:var(--lx-border);overflow:hidden}
.cn-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#22c55e,#22d3ee)}
/* categories: one scrollable strip, never a wall of wrapped pills */
.cn-tabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.cn-tabs::-webkit-scrollbar{display:none}
.cn-tab{display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;height:36px;padding:0 14px;border-radius:999px;font-size:12.5px;font-weight:600;cursor:pointer;
  color:var(--lx-mut);background:var(--lx-in);border:1px solid var(--lx-border);transition:.15s;white-space:nowrap}
.cn-tab:hover{color:var(--lx-text)}
/* the sidebar's selected look, reused so the whole app says "selected" one way */
.cn-tab.on{background:var(--lx-sel-bg);border-color:var(--lx-sel-border);box-shadow:var(--lx-sel-glow);color:var(--lx-sel-text)}
/* a connected card is outline only: the same indigo border as the sidebar, no fill and no glow */
.cn-card.on{border-color:var(--lx-sel-border)}
.cn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
/* connected cards first (WhatsApp, Team alerts, Google, WordPress... in whatever order they were drawn), the rest after; each group keeps its own order */
.cn-grid > .cn-card{order:1}
.cn-grid > .cn-card.on{order:0}
.cn-card{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"m b" "a a";gap:12px 12px;align-content:start;
  padding:14px;border-radius:14px;background:var(--lx-card);border:1px solid var(--lx-border);transition:border-color .15s,transform .15s}
.cn-card:hover{border-color:rgba(139,92,246,.4)}
.cn-mark{grid-area:m}
.cn-glyph{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:11px;color:#fff;flex-shrink:0}
.cn-body{grid-area:b;min-width:0}
.cn-top{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
.cn-name{font-size:14px;font-weight:700;color:var(--lx-text)}
.cn-pill{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:999px;font-size:10.5px;font-weight:600;
  color:var(--lx-mut);background:var(--ap-s1,rgba(255,255,255,.05));border:1px solid var(--lx-border);white-space:nowrap}
.cn-pill i{width:6px;height:6px;border-radius:50%;background:var(--lx-mut)}
.cn-pill.connected{color:#4ade80;background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.4)}
.cn-pill.connected i{background:#22c55e}
.cn-pill.pairing{color:#22d3ee;background:rgba(34,211,238,.1);border-color:rgba(34,211,238,.4)}
.cn-pill.pairing i{background:#22d3ee}
.light .lx-root .cn-pill.connected{color:#15803d}
.light .lx-root .cn-pill.pairing{color:#0e7490}
.cn-blurb{margin:6px 0 0;font-size:12px;line-height:1.5;color:var(--lx-mut);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cn-detail{margin:6px 0 0;font-size:12px;color:var(--lx-cyan);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-act{grid-area:a;justify-self:start;height:32px;padding:0 18px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid transparent;transition:.15s}
.cn-act.pri{color:#fff;background:linear-gradient(135deg,#4f46e5,#7c3aed);box-shadow:0 2px 10px rgba(124,58,237,.3)}
.cn-act.pri:hover{filter:brightness(1.1)}
.cn-act.sec{color:var(--lx-text);background:transparent;border-color:var(--lx-sel-border)}
.cn-act.sec:hover{border-color:rgba(139,92,246,.55)}
.cn-empty{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px;border-radius:14px;
  background:var(--lx-card);border:1px dashed var(--lx-border);color:var(--lx-mut);font-size:12.5px;text-align:center}
.cn-empty p{margin:0}
/* phone: one compact row per integration, the action on the right */
@media (max-width:639px){
  .cn-grid{grid-template-columns:minmax(0,1fr);gap:8px}
  .cn-card{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"m b a";align-items:center;padding:12px;gap:10px}
  .cn-glyph{width:38px;height:38px}
  .cn-act{justify-self:end;height:32px;min-width:0;padding:0 14px}
  .cn-blurb{margin-top:3px;-webkit-line-clamp:1}
  .cn-head{align-items:stretch}
  .cn-total{flex:1 1 100%}
}
`;
