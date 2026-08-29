"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

/** /dashboard/connect — same real logic and API calls as the old app/app/connect/page.tsx
 *  (kept verbatim: /api/integrations, /api/integrations/google, the honesty rule that a card
 *  only says "Connected" once it's actually verified), restyled to the new dashboard's own
 *  theme (components/MrLxwaDashboard.tsx's .lx-root classes) instead of the old AppShell
 *  look, per the owner's standing instruction (2026-08-29): every page from now on uses this
 *  theme, responsive, so navigating from the dashboard never jumps to a different-looking
 *  app. Rendered inside <MrLxwaDashboard> as its `children` — see app/dashboard/connect/
 *  page.tsx — so the sidebar/topbar/chat around it are the real, shared shell. */

type Item = { type: string; status: string; updatedAt: string; label: string | null; username: string | null };

type Card = {
  type: string;
  name: string;
  mark: string;
  blurb: string;
  live: boolean;
  fields: { key: string; label: string; placeholder: string; type?: string; hint?: string }[];
};

const CARDS: Card[] = [
  {
    type: "wordpress",
    name: "WordPress",
    mark: "W",
    blurb: "Approved articles get posted straight to your blog through the WordPress REST API.",
    live: true,
    fields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://yourbusiness.com" },
      { key: "username", label: "WordPress username", placeholder: "admin" },
      {
        key: "appPassword",
        label: "Application password",
        placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx",
        type: "password",
        hint: "WordPress → Users → Profile → Application Passwords. Spaces ke saath paste karo — normal login password kaam nahi karega.",
      },
    ],
  },
  {
    type: "webhook",
    name: "Custom website",
    mark: "{ }",
    blurb: "Next.js, Astro, Shopify, anything with an endpoint. We POST the article, signed, and your site renders it.",
    live: true,
    fields: [{ key: "url", label: "Your endpoint URL", placeholder: "https://yourbusiness.com/api/mrlxwa" }],
  },
  {
    type: "social_x",
    name: "X (Twitter)",
    mark: "𝕏",
    blurb: "Posts go out through your own Zapier / Make / n8n webhook — no app review, no waiting on API access.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_linkedin",
    name: "LinkedIn",
    mark: "in",
    blurb: "Same relay: we send the post, your automation drops it on your company page.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_facebook",
    name: "Facebook",
    mark: "f",
    blurb: "Page posts via your relay endpoint.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
  {
    type: "social_instagram",
    name: "Instagram",
    mark: "◎",
    blurb: "Caption + image handed to your relay endpoint.",
    live: false,
    fields: [{ key: "relayUrl", label: "Zapier / Make / n8n webhook URL", placeholder: "https://hooks.zapier.com/..." }],
  },
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
  denied: "Google pe permission deny kar di gayi.",
  bad_state: "Security check fail — dobara try karo (cookie block to nahi hai?).",
  no_refresh_token: "Google ne refresh token nahi diya. myaccount.google.com/permissions pe ja kar is app ka access hatao, phir dobara connect karo.",
  not_configured: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET set nahi hain.",
  error: "Google connect nahi ho paya.",
};

const listOf = <T,>(v: T[] | { error: string } | undefined): T[] => (Array.isArray(v) ? v : []);
const errorOf = (v: unknown): string | null => (v && !Array.isArray(v) && (v as any).error) || null;

/** A themed text/password input matching the dashboard's chat-input look. */
const LxInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="lx-12 w-full rounded-lg px-3 py-2"
    style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
  />
);

const LxSelect = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...props}
    className="lx-12 w-full rounded-lg px-3 py-2"
    style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
  />
);

export default function ConnectSection() {
  const { toast, confirmAction } = useStore();
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<{ type: string; value: string } | null>(null);

  const load = () =>
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((d) => setItems(d.ok ? d.items : []))
      .catch(() => setItems([]));

  useEffect(() => { load(); }, []);

  const found = (type: string) => items?.find((i) => i.type === type) ?? null;

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
        setErr((e) => ({ ...e, [card.type]: data.error ?? "Connect nahi ho paya." }));
        return;
      }
      if (data.secret) setSecret({ type: card.type, value: data.secret });
      setOpen(null);
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
      load();
    } catch (e: any) {
      toast(`Couldn't disconnect ${card.name}: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Connect</h1>
        <p className="lx-11 lx-mut mt-1">
          Jahan-jahan team ko publish karna hai, wo yahan jodo. Har connection save hone se pehle live test hota hai —
          &ldquo;Connected&rdquo; tabhi likha jaata hai jab sach me connect ho gaya ho.
        </p>
      </div>

      {secret && (
        <div className="lx-card2 p-4" style={{ borderColor: "var(--lx-cyan)" }}>
          <div className="lx-12 font-bold">Signing secret — ye sirf ek baar dikhega</div>
          <p className="lx-11 lx-mut mt-1.5">
            Apni site/automation me ise save karo aur har request ka <code>X-MrLxwa-Signature</code> header verify karo.
            Yahan se close karne ke baad ye dobara nahi milega (naya banana pade to dobara connect karna hoga).
          </p>
          <code className="lx-in lx-11 mt-2 block rounded-lg px-3 py-2" style={{ wordBreak: "break-all" }}>
            {secret.value}
          </code>
          <button className="lx-ghost mt-3" onClick={() => setSecret(null)}>
            Copy kar liya — close
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => {
          const liveItem = found(card.type);
          const isOpen = open === card.type;
          return (
            <div key={card.type} className="lx-card2 flex flex-col p-4">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg lx-12 font-extrabold"
                  style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)" }}
                >
                  {card.mark}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="lx-12 truncate font-bold">{card.name}</div>
                  <span
                    className="lx-pill mt-1 inline-flex"
                    style={
                      liveItem
                        ? { color: "#4ade80", borderColor: "rgba(34,197,94,.4)", background: "rgba(34,197,94,.1)" }
                        : { color: "var(--lx-mut)", borderColor: "var(--lx-border)", background: "rgba(255,255,255,.03)" }
                    }
                  >
                    {liveItem ? "Connected" : "Not connected"}
                  </span>
                </div>
              </div>

              <p className="lx-11 lx-mut mt-2.5">{card.blurb}</p>

              {!card.live && (
                <p className="lx-in lx-10 lx-mut mt-2.5 rounded-lg p-2.5">
                  Connection abhi save aur test ho jaata hai, lekin auto-posting Social agent ke saath live hoga —
                  ye abhi stub hai. Article publishing (WordPress / custom site) aaj se chalu hai.
                </p>
              )}

              {liveItem?.label && (
                <p className="lx-11 lx-mut mt-2 truncate">
                  {liveItem.label}{liveItem.username ? ` · ${liveItem.username}` : ""}
                </p>
              )}

              {isOpen && (
                <div className="mt-3 space-y-2.5">
                  {card.fields.map((f) => (
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
                  {card.type === "webhook" && (
                    <p className="lx-10 lx-mut">
                      Route banana nahi aata?{" "}
                      <Link href="/connect/nextjs" target="_blank" className="underline" style={{ color: "var(--lx-cyan)" }}>
                        Poora setup guide →
                      </Link>
                    </p>
                  )}
                  {err[card.type] && <p className="lx-11" style={{ color: "#f87171" }}>{err[card.type]}</p>}
                </div>
              )}

              <div className="mt-auto flex gap-2 pt-3">
                {isOpen ? (
                  <>
                    <button className="lx-grad lx-11 px-3.5 py-2" disabled={busy === card.type} onClick={() => connect(card)}>
                      {busy === card.type ? "Testing…" : "Test & save"}
                    </button>
                    <button className="lx-ghost" onClick={() => { setOpen(null); setErr({}); }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="lx-grad lx-11 px-3.5 py-2" onClick={() => { setOpen(card.type); setForm({}); setErr({}); }}>
                      {liveItem ? "Reconnect" : "Connect"}
                    </button>
                    {liveItem && (
                      <button className="lx-ghost" disabled={busy === card.type} onClick={() => disconnect(card)}>
                        Disconnect
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <GoogleSection onToast={toast} confirmAction={confirmAction} />

      <p className="lx-11 lx-mut">
        Kab kya publish ho — wo{" "}
        <Link href="/app/schedule" className="underline" style={{ color: "var(--lx-cyan)" }}>Schedule</Link> me set hota hai.
      </p>
    </div>
  );
}

/** Google — Search Console, Analytics 4 and Business Profile in one OAuth connection. Same
 *  real API calls as the old page; only the markup/classNames changed. */
function GoogleSection({ onToast, confirmAction }: {
  onToast: (m: string, tone?: "ok" | "error" | "info") => void;
  confirmAction: (o: { title: string; body?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}) {
  const [g, setG] = useState<GoogleState | null>(null);
  const [sel, setSel] = useState({ gscSiteUrl: "", ga4PropertyId: "", gbpLocationName: "" });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [syncResult, setSyncResult] = useState<any>(null);

  const load = () =>
    fetch("/api/integrations/google")
      .then((r) => r.json())
      .then((d: GoogleState) => {
        setG(d);
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
    if (!quiet) onToast(res.ok ? "Google data refresh ho gaya." : "Refresh fail hua.", res.ok ? "ok" : "error");
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
    if (!res.ok) { setMsg(res.error ?? "Save nahi hua."); return; }
    onToast("Google selection saved.");
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
      onToast("Google disconnect ho gaya.");
      setSyncResult(null);
      load();
    } catch (e: any) {
      onToast(`Google disconnect nahi hua: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  if (!g) return <p className="lx-11 lx-mut">Google status check ho raha hai…</p>;

  const sites = listOf(g.sites);
  const properties = listOf(g.properties);
  const locations = listOf(g.locations);
  const hasGbpScope = (g.scopes ?? []).some((s) => s.includes("business.manage"));
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div>
      <h2 className="lx-13 font-bold">Google — Search Console, Analytics, Business Profile</h2>

      <div className="lx-card2 mt-2.5 p-4">
        {msg && <p className="lx-11 mb-2" style={{ color: "#f87171" }}>{msg}</p>}

        {!g.configured ? (
          <>
            <p className="lx-11 lx-mut">
              Ye feature ban chuka hai, lekin chalane ke liye ek Google Cloud OAuth client chahiye (ek baar ka setup).
            </p>
            <ol className="lx-11 lx-mut mt-2 space-y-1.5 pl-4" style={{ listStyle: "decimal" }}>
              <li>console.cloud.google.com → naya project → ye APIs enable karo: <b>Search Console API</b>, <b>Google Analytics Admin API</b>, <b>Google Analytics Data API</b>.</li>
              <li>Credentials → OAuth client ID → Web application. Authorized redirect URI: <code>{origin}/api/integrations/google/callback</code></li>
              <li>Vercel me <code>GOOGLE_CLIENT_ID</code> aur <code>GOOGLE_CLIENT_SECRET</code> daal kar redeploy karo.</li>
            </ol>
            <p className="lx-10 lx-mut mt-2">
              OAuth screen &ldquo;Testing&rdquo; mode me apne hi Google account ke liye turant kaam karta hai — Google verification tab chahiye jab dusre customers ko dena ho.
            </p>
          </>
        ) : !g.connected ? (
          <>
            <p className="lx-11 lx-mut mb-3" style={{ maxWidth: 620 }}>
              Connect karte hi team ko pata chal jayega ki <b>log asal me kya search karke tumhari site pe aate hain</b>,
              kaunse keyword page 2 pe atke hain, aur kaunse page traffic la rahe hain. Mr Lxwa phir wahi topics chunta hai
              jinke liye site pehle se dikh rahi hai — guess ke bajaye evidence.
            </p>
            <div className="flex flex-wrap gap-2">
              <a className="lx-grad lx-11 px-3.5 py-2" href="/api/integrations/google/start">Connect Google</a>
              <a className="lx-ghost" href="/api/integrations/google/start?gbp=1">Business Profile bhi jodo</a>
            </div>
            <p className="lx-10 lx-mut mt-2.5">
              Sirf read-only access maanga jaata hai. Kuch post ya change nahi hota.
            </p>
          </>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <span className="lx-pill" style={{ color: "#4ade80", borderColor: "rgba(34,197,94,.4)", background: "rgba(34,197,94,.1)" }}>Connected</span>
              {g.email && <span className="lx-11 lx-mut">{g.email}</span>}
              {g.lastSync && <span className="lx-11 lx-mut">· last sync {new Date(g.lastSync).toLocaleString()}</span>}
            </div>

            {g.tokenError && (
              <p className="lx-11 mb-2" style={{ color: "#f87171" }}>
                {g.tokenError} —{" "}
                <a className="underline" style={{ color: "var(--lx-cyan)" }} href="/api/integrations/google/start">dobara connect karo</a>
              </p>
            )}

            <div className="mb-2.5">
              <label className="lx-10 lx-mut mb-1 block">Search Console property (keyword research isi se hoti hai)</label>
              <LxSelect value={sel.gscSiteUrl} onChange={(e) => setSel((s) => ({ ...s, gscSiteUrl: e.target.value }))}>
                <option value="">— select —</option>
                {sites.map((s) => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
              </LxSelect>
              {errorOf(g.sites) && <p className="lx-10 mt-1" style={{ color: "#f87171" }}>{errorOf(g.sites)}</p>}
              {!errorOf(g.sites) && !sites.length && (
                <p className="lx-10 lx-mut mt-1">Is Google account pe koi verified Search Console property nahi mili.</p>
              )}
            </div>

            <div className="mb-2.5">
              <label className="lx-10 lx-mut mb-1 block">Analytics 4 property</label>
              <LxSelect value={sel.ga4PropertyId} onChange={(e) => setSel((s) => ({ ...s, ga4PropertyId: e.target.value }))}>
                <option value="">— select —</option>
                {properties.map((p) => (
                  <option key={p.property} value={p.property}>{p.displayName} ({p.account})</option>
                ))}
              </LxSelect>
              {errorOf(g.properties) && <p className="lx-10 mt-1" style={{ color: "#f87171" }}>{errorOf(g.properties)}</p>}
            </div>

            {hasGbpScope ? (
              <div className="mb-2.5">
                <label className="lx-10 lx-mut mb-1 block">Business Profile location</label>
                <LxSelect value={sel.gbpLocationName} onChange={(e) => setSel((s) => ({ ...s, gbpLocationName: e.target.value }))}>
                  <option value="">— select —</option>
                  {locations.map((l) => <option key={l.name} value={l.name}>{l.title}{l.address ? ` — ${l.address}` : ""}</option>)}
                </LxSelect>
                {errorOf(g.locations) && <p className="lx-10 lx-mut mt-1">{errorOf(g.locations)}</p>}
              </div>
            ) : (
              <p className="lx-10 lx-mut mb-2.5">
                Business Profile connected nahi hai.{" "}
                <a className="underline" style={{ color: "var(--lx-cyan)" }} href="/api/integrations/google/start?gbp=1">Ise bhi jodo →</a>{" "}
                (Google is API ka access alag se approve karta hai — approve na hone tak wo khali rahega.)
              </p>
            )}

            <div className="mt-1 flex flex-wrap gap-2">
              <button className="lx-grad lx-11 px-3.5 py-2" disabled={!!busy} onClick={saveSelection}>
                {busy === "save" ? "Saving…" : "Save & sync"}
              </button>
              <button className="lx-ghost" disabled={!!busy} onClick={() => syncNow()}>
                {busy === "sync" ? "Google se data la rahe hain…" : "Refresh data now"}
              </button>
              <button className="lx-ghost" disabled={!!busy} onClick={disconnect}>Disconnect</button>
            </div>

            {syncResult && (
              <div className="mt-3 lx-11">
                {syncResult.ok ? (
                  <>
                    <p className="lx-mut">
                      {syncResult.skipped
                        ? syncResult.reason
                        : `${syncResult.counts?.queries ?? 0} searches · ${syncResult.counts?.gscPages ?? 0} pages (Search Console) · ${syncResult.counts?.ga4Pages ?? 0} pages (GA4) · ${syncResult.period?.start} → ${syncResult.period?.end}`}
                    </p>
                    {syncResult.note && <p className="lx-mut mt-1">{syncResult.note}</p>}
                    {syncResult.errors && Object.entries(syncResult.errors).map(([k, v]) => (
                      <p key={k} className="mt-1" style={{ color: "#f87171" }}>{k}: {String(v)}</p>
                    ))}
                  </>
                ) : (
                  <p style={{ color: "#f87171" }}>{syncResult.error}</p>
                )}
              </div>
            )}

            <p className="lx-10 lx-mut mt-3">
              Ye data{" "}
              <Link href="/app/memory" className="underline" style={{ color: "var(--lx-cyan)" }}>Memory</Link> me dikhta hai aur har planning run se pehle
              apne aap refresh hota hai. Kuch publish ya change nahi kiya jaata — sirf padha jaata hai.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
