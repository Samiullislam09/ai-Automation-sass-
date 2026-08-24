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

/** Listed on purpose rather than hidden: people ask where Analytics is, and an empty card
 *  that says "not built yet" is a better answer than a Connect button that does nothing. */
const PLANNED = [
  { name: "Google Analytics", why: "Traffic per published article, inside Reports." },
  { name: "Google Search Console", why: "Real impressions and positions to feed keyword research." },
  { name: "Google Business Profile", why: "Auto-posting local updates." },
];

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

      <h2 style={{ fontSize: 15, margin: "26px 0 8px" }}>Abhi available nahi</h2>
      <div className="card" style={{ padding: "13px 16px" }}>
        {PLANNED.map((p) => (
          <div key={p.name} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0" }}>
            <b style={{ fontSize: 12.5, minWidth: 168 }}>{p.name}</b>
            <span className="sm mut">{p.why}</span>
          </div>
        ))}
        <p className="sm mut" style={{ marginTop: 8, fontSize: 11 }}>
          Ye teeno Google OAuth verification maangte hain — jab tak wo nahi hota, yahan fake Connect button nahi rakha gaya.
        </p>
      </div>

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
