"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Brain, Check, ChevronDown, Globe, Link2, Loader2, MapPin, Pencil, Plus, RotateCw, Search,
  Sparkles, Target, Trash2, TrendingUp, X,
} from "lucide-react";
import { useStore } from "@/lib/store";

/** /dashboard/memory — rebuilt 2026-09-05 on the same look as Approvals / Content / Schedule /
 *  Reports (owner: "memory page ka ui bhi theme se match"): one panel, a header, a stat strip
 *  and four tabs — Business facts, Connections, Google, Your site.
 *
 *  Logic and API calls are unchanged: /api/dashboard/status, /api/insights, and saveMemory()
 *  from lib/store.tsx (which writes to the database, not localStorage). Nothing here invents a
 *  number: an unconnected Google says so, and an un-crawled site says so. */

type Status = {
  tenant: { websiteUrl: string | null; niche: string | null; topics: string[]; onboarded: boolean };
  integrations: { type: string; status: string; connectedAt: string }[];
  crawl: { pagesIndexed: number; samplePages: { title: string; url: string }[] };
};

const INTEGRATION_LABEL: Record<string, string> = {
  wordpress: "WordPress",
  webhook: "Webhook (Next.js / custom)",
  google: "Google (Search Console + Analytics)",
  social_x: "X (Twitter) relay",
  social_linkedin: "LinkedIn relay",
  social_facebook: "Facebook relay",
  social_instagram: "Instagram relay",
};

const pillTone = (status: string) => (status === "connected" ? "green" : status === "error" ? "red" : "blue");

type Tab = "facts" | "connections" | "google" | "site";

export default function MemorySection() {
  const { s, toast, act, saveMemory, confirmAction } = useStore();
  const [tab, setTab] = useState<Tab>("facts");
  const [edit, setEdit] = useState<number | null>(null);
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [nk, setNk] = useState("");
  const [nv, setNv] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [insights, setInsights] = useState<any>(null);
  const [statusError, setStatusError] = useState(false);
  const [insightsError, setInsightsError] = useState(false);

  const loadStatus = () => {
    setLoadingStatus(true);
    setStatusError(false);
    fetch("/api/dashboard/status")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setStatus(data); else setStatusError(true); })
      .catch(() => setStatusError(true))
      .finally(() => setLoadingStatus(false));
  };
  const loadInsights = () => {
    setInsights(null);
    setInsightsError(false);
    fetch("/api/insights")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(setInsights)
      .catch(() => setInsightsError(true));
  };
  useEffect(() => { loadStatus(); loadInsights(); }, []);

  const retry = (fn: () => void) => (
    <p className="lx-11" style={{ color: "#f87171" }}>
      Couldn&apos;t load — <button type="button" className="mm-retry" onClick={fn}>Retry</button>
    </p>
  );

  const save = (i: number) => {
    saveMemory(s.memory.map((m: any, j: number) => (j === i ? { ...m, v: val } : m)));
    act(`"Noted. All agents realigned."`, "Mr Lxwa");
    toast("Memory updated — team adjusted.");
    setEdit(null);
  };
  const del = async (i: number) => {
    const m = s.memory[i];
    const ok = await confirmAction({
      title: `Delete "${m?.k ?? "this fact"}"?`,
      body: "Every agent stops using it immediately. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    act(`"Forgotten."`, "Mr Lxwa");
    saveMemory(s.memory.filter((_: any, j: number) => j !== i));
    toast("Removed.");
  };
  const add = () => {
    if (!nk.trim() || !nv.trim()) return toast("Both fields needed", "info");
    saveMemory([...s.memory, { k: nk.trim(), v: nv.trim() }]);
    act(`learned something new from you: <b>${nk.trim()}</b>.`, "Mr Lxwa");
    toast("Team memory updated.");
    setAdding(false);
    setNk("");
    setNv("");
  };

  const connected = (status?.integrations ?? []).filter((i) => i.status === "connected").length;
  const googleOn = !!insights?.connected;

  return (
    <div className="mm-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <section className="mm-panel flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--lx-border)" }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="mm-h1">AI Memory</h1>
              <Brain size={18} style={{ color: "#a78bfa" }} />
            </div>
            <p className="lx-mut mt-0.5" style={{ fontSize: 12 }}>Everything your team knows about your business — read live from your account.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="mm-icobtn" onClick={() => { loadStatus(); loadInsights(); }} title="Refresh" disabled={loadingStatus}>
              {loadingStatus ? <Loader2 size={15} className="mm-spin" /> : <RotateCw size={15} />}
            </button>
            <button className="lx-grad mm-add" onClick={() => setAdding(true)}><Plus size={15} /> <span className="mm-add-t">Add fact</span></button>
          </div>
        </header>

        <div className="lx-scroll flex-1 overflow-y-auto px-4 pb-4">
          {/* stat strip — all real */}
          <div className="mm-stats mt-3">
            <Stat color="#8b5cf6" Icon={Sparkles} value={String(s.memory.length)} label="Business facts" sub="taught by you" />
            <Stat color={connected ? "#22c55e" : "#8b8ba0"} Icon={Link2} value={String(connected)} label="Connections" sub={connected ? "live" : "nothing connected"} />
            <Stat
              color="#3b82f6" Icon={Globe}
              value={loadingStatus ? "…" : String(status?.crawl.pagesIndexed ?? 0)}
              label="Pages read" sub={status?.tenant.websiteUrl ? status.tenant.websiteUrl.replace(/^https?:\/\//, "") : "no site yet"}
            />
            <Stat
              color={googleOn ? "#f59e0b" : "#8b8ba0"} Icon={Search}
              value={googleOn ? String(insights.totals?.queries ?? 0) : "—"}
              label="Search queries" sub={googleOn ? "from Search Console" : "Google not connected"}
            />
          </div>

          {/* tabs */}
          <div className="mm-tabs mt-3">
            <Tabb on={tab === "facts"} onClick={() => setTab("facts")} icon={Sparkles}>Business facts{s.memory.length ? ` (${s.memory.length})` : ""}</Tabb>
            <Tabb on={tab === "connections"} onClick={() => setTab("connections")} icon={Link2}>Connections{connected ? ` (${connected})` : ""}</Tabb>
            <Tabb on={tab === "google"} onClick={() => setTab("google")} icon={Search}>Google</Tabb>
            <Tabb on={tab === "site"} onClick={() => setTab("site")} icon={Globe}>Your site</Tabb>
          </div>

          {/* ---------------- FACTS ---------------- */}
          {tab === "facts" && (
            <div className="mt-3 space-y-2">
              <p className="lx-11 lx-mut">
                These come from your onboarding answers and from anything you add here. Every agent reads them before it writes.
              </p>

              {!s.memory.length ? (
                <div className="mm-empty">
                  <Brain size={20} className="lx-mut" />
                  <b className="lx-12 mt-2">No facts yet</b>
                  <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 360 }}>
                    Add one — your products, who you sell to, what you never want mentioned — and the whole team writes to it.
                  </p>
                  <button className="lx-grad mm-add mt-3" onClick={() => setAdding(true)}><Plus size={15} /> Add fact</button>
                </div>
              ) : (
                s.memory.map((m: any, i: number) => (
                  <div key={i} className="mm-fact">
                    <span className="mm-key" title={m.k}>{m.k}</span>
                    {edit === i ? (
                      <input
                        autoFocus className="mm-in flex-1" value={val}
                        onChange={(e) => setVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") save(i); if (e.key === "Escape") setEdit(null); }}
                      />
                    ) : (
                      <span className="mm-val">{m.v}</span>
                    )}
                    <span className="mm-acts">
                      {edit === i ? (
                        <>
                          <button className="mm-ico ok" onClick={() => save(i)} title="Save"><Check size={14} /></button>
                          <button className="mm-ico" onClick={() => setEdit(null)} title="Cancel"><X size={14} /></button>
                        </>
                      ) : (
                        <>
                          <button className="mm-ico" onClick={() => { setEdit(i); setVal(m.v); }} title="Edit" aria-label={`Edit ${m.k}`}><Pencil size={13} /></button>
                          <button className="mm-ico danger" onClick={() => del(i)} title="Delete" aria-label={`Delete ${m.k}`}><Trash2 size={13} /></button>
                        </>
                      )}
                    </span>
                  </div>
                ))
              )}

              <Link href="/whoami" className="mm-note">
                <Brain size={15} style={{ color: "#a78bfa", flexShrink: 0 }} />
                <span><b>Who am I?</b> — read Mr Lxwa&apos;s current understanding of your business</span>
              </Link>
            </div>
          )}

          {/* ---------------- CONNECTIONS ---------------- */}
          {tab === "connections" && (
            <div className="mt-3 space-y-2">
              {loadingStatus ? (
                <div className="mm-loading"><Loader2 size={16} className="mm-spin lx-mut" /><span className="lx-11 lx-mut ml-2">Checking…</span></div>
              ) : statusError ? retry(loadStatus) : !status?.integrations.length ? (
                <div className="mm-empty">
                  <Link2 size={20} className="lx-mut" />
                  <b className="lx-12 mt-2">Nothing connected yet</b>
                  <p className="lx-11 lx-mut mt-1">Your team can write, but it has nowhere to publish and no numbers to learn from.</p>
                  <Link href="/dashboard/connect" className="lx-grad mm-add mt-3">Open Connect</Link>
                </div>
              ) : (
                <>
                  {status.integrations.map((i, idx) => (
                    <div key={idx} className="mm-row">
                      <span className="mm-row-t">{INTEGRATION_LABEL[i.type] ?? i.type}</span>
                      <span className="lx-10 lx-mut">{i.connectedAt ? new Date(i.connectedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}</span>
                      <span className={"lx-pill ml-auto " + pillTone(i.status)}>{i.status.toUpperCase()}</span>
                    </div>
                  ))}
                  <Link href="/dashboard/connect" className="mm-note">
                    <Link2 size={15} style={{ color: "#818cf8", flexShrink: 0 }} />
                    <span>Add or fix a connection in <b>Connect</b></span>
                  </Link>
                </>
              )}
            </div>
          )}

          {/* ---------------- GOOGLE ---------------- */}
          {tab === "google" && (
            <div className="mt-3 space-y-3">
              <p className="lx-11 lx-mut">
                Real Search Console + Analytics numbers. Mr Lxwa picks topics from this, Mr. Keyword falls back to it, and
                Mr. Writer links to the pages that already work.
              </p>

              {insightsError ? retry(loadInsights) : !insights ? (
                <div className="mm-loading"><Loader2 size={16} className="mm-spin lx-mut" /><span className="lx-11 lx-mut ml-2">Checking…</span></div>
              ) : !insights.connected ? (
                <div className="mm-empty">
                  <Search size={20} className="lx-mut" />
                  <b className="lx-12 mt-2">Google isn&apos;t connected</b>
                  <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 420 }}>
                    {insights.needsMigration
                      ? <>Database migration baaki hai — <code className="lx-mono">supabase/migrations/007_site_insights.sql</code> chalao.</>
                      : "Until then the team only has your site crawl to go on — it can't see what people actually search for."}
                  </p>
                  {!insights.needsMigration && <Link href="/dashboard/connect" className="lx-grad mm-add mt-3">Connect Search Console</Link>}
                </div>
              ) : (
                <>
                  <div className="mm-meta">
                    {insights.period?.start} → {insights.period?.end} · {insights.totals?.queries} searches · {insights.totals?.pages} pages
                    {insights.traffic ? ` · ${insights.traffic.sessions} sessions, ${insights.traffic.users} users (GA4)` : ""}
                  </div>

                  {insights.strikingDistance?.length > 0 && (
                    <Card title="Almost on page 1" icon={Target} tone="#fbbf24" note="The next article should be about these.">
                      {insights.strikingDistance.map((q: any) => (
                        <InsightRow key={q.query} label={q.query} meta={`pos ${q.position.toFixed(1)} · ${q.impressions} impressions · ${q.clicks} clicks`} />
                      ))}
                    </Card>
                  )}

                  {insights.missed?.length > 0 && (
                    <Card title="Seen but not clicked" icon={TrendingUp} tone="#f87171" note="People find these and skip them — the page isn't answering.">
                      {insights.missed.map((q: any) => <InsightRow key={q.query} label={q.query} meta={`${q.impressions} impressions · ${q.clicks} clicks`} />)}
                    </Card>
                  )}

                  {insights.winning?.length > 0 && (
                    <Fold title={`Already working (${insights.winning.length})`}>
                      {insights.winning.map((q: any) => <InsightRow key={q.query} label={q.query} meta={`${q.clicks} clicks · pos ${q.position.toFixed(1)}`} />)}
                    </Fold>
                  )}

                  {insights.topPages?.length > 0 && (
                    <Fold title={`Most visited pages (${insights.topPages.length})`}>
                      {insights.topPages.map((p: any) => <InsightRow key={p.url} label={p.url} meta={`${p.clicks} clicks`} />)}
                    </Fold>
                  )}

                  {insights.location && (
                    <div className="mm-row">
                      <MapPin size={14} style={{ color: "#4ade80", flexShrink: 0 }} />
                      <span className="mm-row-t">{insights.location.title}</span>
                      {insights.location.address && <span className="lx-10 lx-mut">{insights.location.address}</span>}
                    </div>
                  )}

                  <p className="lx-10 lx-mut">
                    Last refresh: {insights.capturedAt ? new Date(insights.capturedAt).toLocaleString() : "—"} ·{" "}
                    <Link href="/dashboard/connect" className="mm-link">refresh in Connect</Link>
                  </p>
                </>
              )}
            </div>
          )}

          {/* ---------------- YOUR SITE ---------------- */}
          {tab === "site" && (
            <div className="mt-3 space-y-3">
              {loadingStatus ? (
                <div className="mm-loading"><Loader2 size={16} className="mm-spin lx-mut" /><span className="lx-11 lx-mut ml-2">Checking…</span></div>
              ) : statusError ? retry(loadStatus) : !status?.crawl.pagesIndexed ? (
                <div className="mm-empty">
                  <Globe size={20} className="lx-mut" />
                  <b className="lx-12 mt-2">Your site hasn&apos;t been read yet</b>
                  <p className="lx-11 lx-mut mt-1">This happens automatically during onboarding, or when you connect your site.</p>
                  <Link href="/dashboard/connect" className="lx-grad mm-add mt-3">Open Connect</Link>
                </div>
              ) : (
                <>
                  <Card title="What your business is about" icon={Brain} tone="#a78bfa">
                    <p className="lx-12" style={{ lineHeight: 1.6 }}>{status.tenant.niche || "Not summarised yet."}</p>
                    <p className="lx-10 lx-mut mt-2" style={{ overflowWrap: "anywhere" }}>
                      Read from <b style={{ color: "#e8e8f2" }}>{status.crawl.pagesIndexed}</b> page
                      {status.crawl.pagesIndexed === 1 ? "" : "s"} on <span style={{ color: "#e8e8f2" }}>{status.tenant.websiteUrl}</span>
                    </p>
                  </Card>

                  {status.tenant.topics.length > 0 && (
                    <Card title="Topics it writes about" icon={Sparkles} tone="#60a5fa">
                      <div className="flex flex-wrap gap-1.5">
                        {status.tenant.topics.map((t, i) => <span key={i} className="mm-chip">{t}</span>)}
                      </div>
                    </Card>
                  )}

                  {status.crawl.samplePages.length > 0 && (
                    <Fold title={`Pages read (${status.crawl.samplePages.length})`}>
                      {status.crawl.samplePages.map((p, i) => <InsightRow key={i} label={p.title} meta="" />)}
                    </Fold>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* add-fact dialog */}
      {adding && (
        <div className="mm-modal" role="dialog" aria-modal="true" onClick={() => setAdding(false)}>
          <div className="mm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mm-sheet-h">
              <b className="lx-13">Teach the team something</b>
              <button className="mm-ico ml-auto" onClick={() => setAdding(false)} aria-label="Close"><X size={15} /></button>
            </div>
            <div className="p-4">
              <label className="mm-label">Label</label>
              <input className="mm-in w-full" placeholder="e.g. Products, USP, Never mention…" value={nk} onChange={(e) => setNk(e.target.value)} />
              <label className="mm-label mt-3">Fact</label>
              <textarea
                rows={4} className="mm-in w-full" style={{ height: "auto", padding: "9px 11px", lineHeight: 1.6 }}
                placeholder="What should your team know?" value={nv} onChange={(e) => setNv(e.target.value)}
              />
              <div className="mt-4 flex gap-2">
                <button className="mm-btn flex-1" onClick={() => setAdding(false)}>Cancel</button>
                <button className="lx-grad mm-add flex-1" style={{ justifyContent: "center" }} onClick={add}>Save to memory</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- */

function Stat({ color, Icon, value, label, sub }: { color: string; Icon: React.ElementType; value: string; label: string; sub: string }) {
  return (
    <div className="mm-stat" style={{ ["--c" as any]: color }}>
      <span className="mm-stat-ico"><Icon size={16} /></span>
      <div className="min-w-0">
        <div className="mm-stat-n">{value}</div>
        <div className="lx-10 lx-mut">{label}</div>
        <div className="mm-stat-sub" title={sub}>{sub}</div>
      </div>
    </div>
  );
}

function Tabb({ on, onClick, icon: Icon, children }: { on: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <button className={`mm-tab ${on ? "on" : ""}`} onClick={onClick}>
      <Icon size={13} /> {children}
    </button>
  );
}

function Card({ title, icon: Icon, tone, note, children }: {
  title: string; icon: React.ElementType; tone?: string; note?: string; children: React.ReactNode;
}) {
  return (
    <div className="mm-card">
      <div className="mm-card-h"><Icon size={14} style={{ color: tone ?? "#a78bfa" }} /><span>{title}</span></div>
      {note && <p className="lx-10 lx-mut mt-1">{note}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mm-card">
      <button className="mm-fold" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <ChevronDown size={14} className={`lx-mut ml-auto mm-chev ${open ? "on" : ""}`} />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function InsightRow({ label, meta }: { label: string; meta: string }) {
  return (
    <div className="mm-irow">
      <span className="mm-irow-l">{label}</span>
      {meta && <span className="lx-10 lx-mut whitespace-nowrap">{meta}</span>}
    </div>
  );
}

/* Same visual language as Approvals / Content / Schedule / Reports. Injected with
   dangerouslySetInnerHTML — React escapes ">" inside a <style> text child, which turns every
   child selector into a hydration mismatch. */
const CSS = `
.mm-wrap{display:flex;height:100%;min-height:0;container-type:inline-size;container-name:mm}
.mm-panel{background:#0a0a11;border:1px solid var(--lx-border);border-radius:16px;min-width:0;width:100%}
.mm-h1{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1;color:#fff}
.mm-icobtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;
  border:1px solid var(--lx-border);background:#0d0d16;color:#9a9ab2;cursor:pointer;transition:.15s;flex-shrink:0}
.mm-icobtn:hover:not(:disabled){color:#fff;border-color:rgba(139,92,246,.55)}
.mm-add{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;border-radius:9px;font-size:12.5px;
  font-weight:600;white-space:nowrap;text-decoration:none}
@container mm (max-width:520px){.mm-add-t{display:none}.mm-add{padding:0 10px}}
.mm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.mm-stat{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:11px;min-width:0;
  background:color-mix(in srgb,var(--c) 9%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 40%,transparent)}
.mm-stat-ico{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;flex-shrink:0;
  color:var(--c);background:color-mix(in srgb,var(--c) 14%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}
.mm-stat-n{font-size:19px;font-weight:800;line-height:1;color:#fff;font-variant-numeric:tabular-nums}
.mm-stat-sub{margin-top:2px;font-size:10px;color:var(--lx-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-tabs{display:flex;flex-wrap:wrap;gap:6px}
.mm-tab{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:9px;font-size:12px;font-weight:600;
  background:#0d0d16;border:1px solid var(--lx-border);color:#9a9ab2;cursor:pointer;transition:.15s}
.mm-tab:hover{color:#fff}
.mm-tab.on{color:#fff;background:linear-gradient(135deg,rgba(79,70,229,.55),rgba(124,58,237,.35));border-color:rgba(139,92,246,.6)}
.mm-card{padding:13px;border-radius:12px;background:#0d0d16;border:1px solid var(--lx-border)}
.mm-card-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#fff}
.mm-fold{display:flex;align-items:center;gap:8px;width:100%;padding:0;background:none;border:none;color:#fff;
  font-size:12.5px;font-weight:600;cursor:pointer;text-align:left}
.mm-chev{transition:transform .15s}
.mm-chev.on{transform:rotate(180deg)}
.mm-fact{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:11px 12px;border-radius:12px;background:#0d0d16;
  border:1px solid var(--lx-border);transition:.15s}
.mm-fact:hover{border-color:rgba(139,92,246,.4)}
.mm-key{flex-shrink:0;min-width:96px;max-width:170px;padding:3px 9px;border-radius:7px;font-size:10.5px;font-weight:700;
  letter-spacing:.04em;text-transform:uppercase;color:#c4b5fd;background:rgba(139,92,246,.12);
  border:1px solid rgba(139,92,246,.3);overflow-wrap:anywhere}
.mm-val{flex:1;min-width:180px;font-size:12.5px;color:#e8e8f2;line-height:1.55;overflow-wrap:anywhere}
.mm-acts{display:flex;gap:4px;margin-left:auto}
.mm-ico{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex-shrink:0;border-radius:8px;
  background:#12121c;border:1px solid var(--lx-border);color:#b6b6c8;cursor:pointer;transition:.15s}
.mm-ico:hover{color:#fff;border-color:rgba(255,255,255,.22)}
.mm-ico.danger{color:#f87171;border-color:rgba(239,68,68,.3)}
.mm-ico.danger:hover{background:rgba(239,68,68,.14);color:#fff}
.mm-ico.ok{color:#4ade80;border-color:rgba(34,197,94,.35)}
.mm-ico.ok:hover{background:rgba(34,197,94,.14);color:#fff}
.mm-in{height:34px;padding:0 11px;border-radius:9px;background:#0a0a11;border:1px solid var(--lx-border);color:#e8e8f2;
  font-size:12.5px;outline:none;min-width:0}
.mm-in:focus{border-color:rgba(139,92,246,.55)}
.mm-in::placeholder{color:var(--lx-dim)}
.mm-label{display:block;margin-bottom:6px;font-size:11px;color:var(--lx-mut)}
.mm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 13px;border-radius:9px;
  background:#12121c;border:1px solid var(--lx-border);color:#d6d6e4;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.mm-btn:hover{color:#fff;border-color:rgba(139,92,246,.5)}
.mm-row{display:flex;flex-wrap:wrap;align-items:center;gap:9px;padding:10px 12px;border-radius:11px;background:#0d0d16;
  border:1px solid var(--lx-border)}
.mm-row-t{font-size:12.5px;font-weight:600;color:#e8e8f2;overflow-wrap:anywhere}
.mm-irow{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;padding:7px 0}
.mm-irow+.mm-irow{border-top:1px solid var(--lx-border)}
.mm-irow-l{font-size:12px;color:#e8e8f2;overflow-wrap:anywhere}
.mm-chip{display:inline-flex;align-items:center;padding:4px 9px;border-radius:7px;font-size:10.5px;font-weight:600;
  color:#d6d6e4;background:rgba(255,255,255,.05);border:1px solid var(--lx-border);overflow-wrap:anywhere}
.mm-meta{font-size:10.5px;color:var(--lx-mut)}
.mm-note{display:flex;align-items:center;gap:9px;padding:11px 12px;border-radius:11px;background:#0d0d16;
  border:1px dashed var(--lx-border);font-size:12px;color:#d6d6e4;text-decoration:none;transition:.15s}
.mm-note:hover{border-color:rgba(139,92,246,.5);color:#fff}
.mm-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:28px 20px;border-radius:12px;
  background:#0d0d16;border:1px dashed var(--lx-border)}
.mm-loading{display:flex;align-items:center;justify-content:center;padding:22px;border-radius:12px;background:#0d0d16;
  border:1px solid var(--lx-border)}
.mm-link,.mm-retry{color:#818cf8;text-decoration:none;background:none;border:none;font:inherit;cursor:pointer;font-weight:600}
.mm-link:hover,.mm-retry:hover{text-decoration:underline}
.mm-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(4,4,10,.7);backdrop-filter:blur(3px)}
.mm-sheet{width:min(460px,100%);border-radius:16px;background:#0a0a11;border:1px solid rgba(255,255,255,.12);
  box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
.mm-sheet-h{display:flex;align-items:center;gap:10px;padding:13px 14px;border-bottom:1px solid var(--lx-border);
  background:linear-gradient(135deg,rgba(124,58,237,.12),transparent 60%)}
.mm-spin{animation:mmSpin 1s linear infinite}
@keyframes mmSpin{to{transform:rotate(360deg)}}
`;
