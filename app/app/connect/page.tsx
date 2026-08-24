"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

/** /app/connect — the one place where a customer attaches (and detaches) everything the
 *  team publishes to. Before this, the only chance to connect anything was the onboarding
 *  wizard, once, with no way back.
 *
 *  Honesty rule for this page: a card says "Connected" only when the connection was
 *  actually verified against the real service a second ago (see /api/integrations), and a
 *  destination the pipeline can't post to yet says so on the card instead of pretending. */

type Item = { type: string; status: string; updatedAt: string; label: string | null; username: string | null };

type Card = {
  type: string;
  name: string;
  mark: string;
  blurb: string;
  /** true = the pipeline publishes here today. false = you can connect it, but delivery
   *  turns on with the Social agent (Phase 2) — said out loud on the card. */
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

export default function Connect() {
  const { toast } = useStore();
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
    setBusy(card.type);
    await fetch(`/api/integrations?type=${card.type}`, { method: "DELETE" }).catch(() => {});
    setBusy(null);
    toast(`${card.name} disconnected.`);
    load();
  };

  return (
    <>
      <h1 style={{ fontSize: 21, margin: "0 0 6px" }}>Connect</h1>
      <p className="sm mut" style={{ marginBottom: 20, maxWidth: 640 }}>
        Jahan-jahan team ko publish karna hai, wo yahan jodo. Har connection save hone se pehle live test hota hai —
        &ldquo;Connected&rdquo; tabhi likha jaata hai jab sach me connect ho gaya ho.
      </p>

      {secret && (
        <div className="card" style={{ padding: "14px 16px", marginBottom: 18, borderColor: "var(--ac)" }}>
          <b style={{ fontSize: 13 }}>Signing secret — ye sirf ek baar dikhega</b>
          <p className="sm mut" style={{ margin: "6px 0 8px" }}>
            Apni site/automation me ise save karo aur har request ka <code>X-MrLxwa-Signature</code> header verify karo.
            Yahan se close karne ke baad ye dobara nahi milega (naya banana pade to dobara connect karna hoga).
          </p>
          <code style={{ display: "block", padding: "9px 11px", background: "var(--panel2)", borderRadius: 9, fontSize: 12, wordBreak: "break-all" }}>
            {secret.value}
          </code>
          <button className="btn btn-g" style={{ marginTop: 10 }} onClick={() => setSecret(null)}>
            Copy kar liya — close
          </button>
        </div>
      )}

      <div className="conn-grid">
        {CARDS.map((card) => {
          const live = found(card.type);
          const isOpen = open === card.type;
          return (
            <div key={card.type} className="card conn-card">
              <div className="conn-head">
                <span className="conn-mark">{card.mark}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="conn-name">{card.name}</div>
                  <span className={"pill " + (live ? "st-pub" : "st-draft")}>
                    {live ? "Connected" : "Not connected"}
                  </span>
                </div>
              </div>

              <p className="sm mut conn-blurb">{card.blurb}</p>

              {!card.live && (
                <p className="conn-note">
                  Connection abhi save aur test ho jaata hai, lekin auto-posting Social agent ke saath live hoga —
                  ye abhi stub hai. Article publishing (WordPress / custom site) aaj se chalu hai.
                </p>
              )}

              {live?.label && (
                <p className="sm mut" style={{ margin: "0 0 10px", wordBreak: "break-all" }}>
                  {live.label}{live.username ? ` · ${live.username}` : ""}
                </p>
              )}

              {isOpen && (
                <div style={{ marginBottom: 10 }}>
                  {card.fields.map((f) => (
                    <div className="field" key={f.key}>
                      <label>{f.label}</label>
                      <input
                        type={f.type ?? "text"}
                        placeholder={f.placeholder}
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                      />
                      {f.hint && <p className="sm mut" style={{ marginTop: 5, fontSize: 11 }}>{f.hint}</p>}
                    </div>
                  ))}
                  {card.type === "webhook" && (
                    <p className="sm mut" style={{ fontSize: 11, marginBottom: 8 }}>
                      Route banana nahi aata? <Link href="/connect/nextjs" target="_blank" className="acc">Poora setup guide →</Link>
                    </p>
                  )}
                  {err[card.type] && <p className="sm" style={{ color: "#ff6b6b", marginBottom: 8 }}>{err[card.type]}</p>}
                </div>
              )}

              <div className="conn-actions">
                {isOpen ? (
                  <>
                    <button className="btn btn-p" disabled={busy === card.type} onClick={() => connect(card)}>
                      {busy === card.type ? "Testing…" : "Test & save"}
                    </button>
                    <button className="btn btn-g" onClick={() => { setOpen(null); setErr({}); }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-p" onClick={() => { setOpen(card.type); setForm({}); setErr({}); }}>
                      {live ? "Reconnect" : "Connect"}
                    </button>
                    {live && (
                      <button className="btn btn-g" disabled={busy === card.type} onClick={() => disconnect(card)}>
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

      <GoogleSection onToast={toast} />

      <p className="sm mut" style={{ marginTop: 18 }}>
        Kab kya publish ho — wo <Link href="/app/schedule" className="acc">Schedule</Link> me set hota hai.
      </p>

      <style jsx>{`
        .conn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; }
        .conn-card { padding: 15px 16px; display: flex; flex-direction: column; }
        .conn-head { display: flex; gap: 11px; align-items: center; margin-bottom: 10px; }
        .conn-mark { width: 38px; height: 38px; border-radius: 11px; flex: none; display: grid; place-items: center;
                     background: var(--panel2); border: 1px solid var(--line); font-weight: 800; font-size: 15px; }
        .conn-name { font-size: 14.5px; font-weight: 700; margin-bottom: 4px; }
        .conn-blurb { margin: 0 0 10px; line-height: 1.5; }
        .conn-note { font-size: 11px; line-height: 1.5; color: var(--mut2); background: var(--panel2);
                     border-radius: 9px; padding: 8px 10px; margin: 0 0 10px; }
        .conn-actions { display: flex; gap: 8px; margin-top: auto; flex-wrap: wrap; }
        .pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 7px; }
      `}</style>
    </>
  );
}

/** Google — Search Console, Analytics 4 and Business Profile in one OAuth connection.
 *
 *  This card is the reason the agents can stop guessing. Search Console tells us the exact
 *  searches this site is already shown for and where it ranks; that goes into
 *  `site_insights` and from there into topic planning, keyword research and the article
 *  itself. Nothing here invents a number: if Google returns nothing, the card says nothing.
 */
function GoogleSection({ onToast }: { onToast: (m: string) => void }) {
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
    // Read the OAuth outcome off the URL rather than useSearchParams(), which would force
    // this whole page behind a Suspense boundary just to show one line of text.
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
    if (!quiet) onToast(res.ok ? "Google data refresh ho gaya." : "Refresh fail hua.");
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
    // The first sync after choosing a property is the whole point of choosing it.
    void syncNow(true);
  };

  const disconnect = async () => {
    setBusy("disc");
    await fetch("/api/integrations/google", { method: "DELETE" }).catch(() => {});
    setBusy("");
    onToast("Google disconnect ho gaya.");
    setSyncResult(null);
    load();
  };

  if (!g) return <p className="sm mut" style={{ marginTop: 26 }}>Google status check ho raha hai…</p>;

  const sites = listOf(g.sites);
  const properties = listOf(g.properties);
  const locations = listOf(g.locations);
  const hasGbpScope = (g.scopes ?? []).some((s) => s.includes("business.manage"));
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <h2 style={{ fontSize: 15, margin: "26px 0 8px" }}>Google — Search Console, Analytics, Business Profile</h2>

      <div className="card" style={{ padding: "16px 17px" }}>
        {msg && <p className="sm" style={{ color: "#ff6b6b", marginTop: 0 }}>{msg}</p>}

        {!g.configured ? (
          <>
            <p className="sm mut" style={{ margin: "0 0 8px" }}>
              Ye feature ban chuka hai, lekin chalane ke liye ek Google Cloud OAuth client chahiye (ek baar ka setup).
            </p>
            <ol className="sm mut" style={{ margin: "0 0 8px 18px", lineHeight: 1.7 }}>
              <li>console.cloud.google.com → naya project → ye APIs enable karo: <b>Search Console API</b>, <b>Google Analytics Admin API</b>, <b>Google Analytics Data API</b>.</li>
              <li>Credentials → OAuth client ID → Web application. Authorized redirect URI: <code>{origin}/api/integrations/google/callback</code></li>
              <li>Vercel me <code>GOOGLE_CLIENT_ID</code> aur <code>GOOGLE_CLIENT_SECRET</code> daal kar redeploy karo.</li>
            </ol>
            <p className="sm mut" style={{ margin: 0, fontSize: 11 }}>
              OAuth screen &ldquo;Testing&rdquo; mode me apne hi Google account ke liye turant kaam karta hai — Google verification tab chahiye jab dusre customers ko dena ho.
            </p>
          </>
        ) : !g.connected ? (
          <>
            <p className="sm mut" style={{ margin: "0 0 12px", maxWidth: 620 }}>
              Connect karte hi team ko pata chal jayega ki <b>log asal me kya search karke tumhari site pe aate hain</b>,
              kaunse keyword page 2 pe atke hain, aur kaunse page traffic la rahe hain. Mr Lxwa phir wahi topics chunta hai
              jinke liye site pehle se dikh rahi hai — guess ke bajaye evidence.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a className="btn btn-p" href="/api/integrations/google/start">Connect Google</a>
              <a className="btn btn-g" href="/api/integrations/google/start?gbp=1">Business Profile bhi jodo</a>
            </div>
            <p className="sm mut" style={{ marginTop: 10, fontSize: 11 }}>
              Sirf read-only access maanga jaata hai. Kuch post ya change nahi hota.
            </p>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <span className="st-pub" style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 7 }}>Connected</span>
              {g.email && <span className="sm mut">{g.email}</span>}
              {g.lastSync && <span className="sm mut">· last sync {new Date(g.lastSync).toLocaleString()}</span>}
            </div>

            {g.tokenError && (
              <p className="sm" style={{ color: "#ff6b6b" }}>
                {g.tokenError} — <a className="acc" href="/api/integrations/google/start">dobara connect karo</a>
              </p>
            )}

            <div className="field">
              <label>Search Console property (keyword research isi se hoti hai)</label>
              <select value={sel.gscSiteUrl} onChange={(e) => setSel((s) => ({ ...s, gscSiteUrl: e.target.value }))}>
                <option value="">— select —</option>
                {sites.map((s) => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
              </select>
              {errorOf(g.sites) && <p className="sm" style={{ color: "#ff6b6b", fontSize: 11 }}>{errorOf(g.sites)}</p>}
              {!errorOf(g.sites) && !sites.length && (
                <p className="sm mut" style={{ fontSize: 11 }}>Is Google account pe koi verified Search Console property nahi mili.</p>
              )}
            </div>

            <div className="field">
              <label>Analytics 4 property</label>
              <select value={sel.ga4PropertyId} onChange={(e) => setSel((s) => ({ ...s, ga4PropertyId: e.target.value }))}>
                <option value="">— select —</option>
                {properties.map((p) => (
                  <option key={p.property} value={p.property}>{p.displayName} ({p.account})</option>
                ))}
              </select>
              {errorOf(g.properties) && <p className="sm" style={{ color: "#ff6b6b", fontSize: 11 }}>{errorOf(g.properties)}</p>}
            </div>

            {hasGbpScope ? (
              <div className="field">
                <label>Business Profile location</label>
                <select value={sel.gbpLocationName} onChange={(e) => setSel((s) => ({ ...s, gbpLocationName: e.target.value }))}>
                  <option value="">— select —</option>
                  {locations.map((l) => <option key={l.name} value={l.name}>{l.title}{l.address ? ` — ${l.address}` : ""}</option>)}
                </select>
                {errorOf(g.locations) && <p className="sm mut" style={{ fontSize: 11 }}>{errorOf(g.locations)}</p>}
              </div>
            ) : (
              <p className="sm mut" style={{ fontSize: 11, marginBottom: 10 }}>
                Business Profile connected nahi hai. <a className="acc" href="/api/integrations/google/start?gbp=1">Ise bhi jodo →</a>{" "}
                (Google is API ka access alag se approve karta hai — approve na hone tak wo khali rahega.)
              </p>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <button className="btn btn-p" disabled={!!busy} onClick={saveSelection}>
                {busy === "save" ? "Saving…" : "Save & sync"}
              </button>
              <button className="btn btn-g" disabled={!!busy} onClick={() => syncNow()}>
                {busy === "sync" ? "Google se data la rahe hain…" : "Refresh data now"}
              </button>
              <button className="btn btn-g" disabled={!!busy} onClick={disconnect}>Disconnect</button>
            </div>

            {syncResult && (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                {syncResult.ok ? (
                  <>
                    <p className="sm mut" style={{ margin: 0 }}>
                      {syncResult.skipped
                        ? syncResult.reason
                        : `${syncResult.counts?.queries ?? 0} searches · ${syncResult.counts?.gscPages ?? 0} pages (Search Console) · ${syncResult.counts?.ga4Pages ?? 0} pages (GA4) · ${syncResult.period?.start} → ${syncResult.period?.end}`}
                    </p>
                    {syncResult.note && <p className="sm mut" style={{ margin: "4px 0 0" }}>{syncResult.note}</p>}
                    {syncResult.errors && Object.entries(syncResult.errors).map(([k, v]) => (
                      <p key={k} className="sm" style={{ color: "#ff6b6b", margin: "4px 0 0" }}>{k}: {String(v)}</p>
                    ))}
                  </>
                ) : (
                  <p className="sm" style={{ color: "#ff6b6b", margin: 0 }}>{syncResult.error}</p>
                )}
              </div>
            )}

            <p className="sm mut" style={{ marginTop: 12, fontSize: 11 }}>
              Ye data <Link href="/app/memory" className="acc">Memory</Link> me dikhta hai aur har planning run se pehle
              apne aap refresh hota hai. Kuch publish ya change nahi kiya jaata — sirf padha jaata hai.
            </p>
          </>
        )}
      </div>
    </>
  );
}
