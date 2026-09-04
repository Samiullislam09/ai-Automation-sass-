"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, BadgeCheck, Bell, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Clock,
  Copy, Eye, FileText, Loader2, Megaphone, MapPin, MoreVertical, Pencil, RefreshCw, Search,
  SlidersHorizontal, UserRound, X, XCircle, CheckCircle2, Monitor, ExternalLink,
} from "lucide-react";
import { renderMarkdown } from "@/lib/md";
import { useStore } from "@/lib/store";

/** /dashboard/approvals — rebuilt 2026-09-04 to match the owner's reference mockup
 *  (Downloads/approval page ui.png) 1:1 in layout and colour: stat strip, filter bar, article
 *  table with per-status actions, pagination, and a right-hand detail drawer with
 *  Details / Content Preview / History tabs and Reject / Approve / Request Changes.
 *
 *  Same real logic as before, kept verbatim: /api/content list, approve/reject endpoints, the
 *  optimistic 6s-Undo reject flow, and §7.7's "copy-only never says published" rule.
 *
 *  WHAT'S REAL vs WHAT THE MOCKUP HAD — every number on this page reads off the database:
 *   - The list now loads `status=all` (not just awaiting_approval) so the stat cards, status
 *     filter and the non-pending rows (Published / Rejected / Draft / Failed) are real counts.
 *   - "Re-checking" in the mockup has no status of its own in content_items; the 5th card is
 *     "In Progress" (= `draft`, still being written), same cyan styling.
 *   - Version: there is no per-item version table. `v1` = as the agent wrote it, `v2` = a
 *     human edit was saved on top (`meta.editedByHuman`) — never a made-up higher number.
 *   - Review History is derived from timestamps that actually exist on the row (created_at,
 *     meta.seo.checkedAt, meta.editedAt, updated_at + status). No invented reviewer comments.
 *   - "Request Changes" opens the real editor's AI-revise (/dashboard/content/[id]); there is
 *     no separate "changes requested" status to write. */

type Status = "draft" | "awaiting_approval" | "approved" | "published" | "failed" | "rejected";

type ContentItem = {
  id: string;
  type: string;
  status: Status | string;
  title: string | null;
  body?: string | null;
  cluster?: string | null;
  meta: {
    wordCount?: number; sections?: number; links?: number; network?: string; copyOnly?: boolean; imageBrief?: string;
    editedByHuman?: boolean; editedAt?: string; publishedUrl?: string | null; publishError?: string;
    seo?: { score?: number; checkedAt?: string }; qualityGate?: { score?: number; passed?: boolean };
  } | null;
  created_at: string;
  updated_at?: string;
};

const PAGE_SIZE = 10;

const NETWORK_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", x: "X (Twitter)" };

/** Which agent authored a row — by type; the writer/social agents are the only ones that create content_items. */
const AGENT_BY_TYPE: Record<string, string> = { article: "Mr. Writer", social: "Miss Social", gbp: "Mr. Writer" };
const TYPE_LABEL: Record<string, string> = { article: "Blog Post", social: "Social Post", gbp: "GBP Post" };

const STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  awaiting_approval: { label: "Pending Review", color: "#fbbf24", bg: "rgba(251,191,36,.10)", border: "rgba(251,191,36,.35)" },
  published:         { label: "Published",      color: "#4ade80", bg: "rgba(34,197,94,.10)",  border: "rgba(34,197,94,.35)" },
  approved:          { label: "Approved",       color: "#60a5fa", bg: "rgba(59,130,246,.12)", border: "rgba(59,130,246,.35)" },
  rejected:          { label: "Rejected",       color: "#f87171", bg: "rgba(239,68,68,.12)",  border: "rgba(239,68,68,.35)" },
  failed:            { label: "Publish Failed", color: "#f87171", bg: "rgba(239,68,68,.12)",  border: "rgba(239,68,68,.35)" },
  draft:             { label: "Draft",          color: "#8b8ba0", bg: "rgba(255,255,255,.04)", border: "rgba(255,255,255,.12)" },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s, color: "#8b8ba0", bg: "rgba(255,255,255,.04)", border: "rgba(255,255,255,.12)" };

/** Tile colour per type — the mockup gives every article its own tinted icon tile. */
const TILE: Record<string, { from: string; to: string; border: string; glow: string; Icon: React.ElementType }> = {
  article: { from: "#0f1a3a", to: "#1a0f3a", border: "rgba(99,102,241,.6)",  glow: "rgba(99,102,241,.35)",  Icon: FileText },
  social:  { from: "#1a0f3a", to: "#2a0f3a", border: "rgba(168,85,247,.6)",  glow: "rgba(168,85,247,.35)",  Icon: Megaphone },
  gbp:     { from: "#0a1f1a", to: "#0a2a1f", border: "rgba(34,197,94,.55)",  glow: "rgba(34,197,94,.3)",    Icon: MapPin },
};
const tileOf = (t: string) => TILE[t] ?? TILE.article;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
const fmtBoth = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
const versionOf = (c: ContentItem) => (c.meta?.editedByHuman ? "v2" : "v1");
const agentOf = (c: ContentItem) => AGENT_BY_TYPE[c.type] ?? "Mr. Writer";
const categoryOf = (c: ContentItem) =>
  c.type === "social" ? (c.meta?.network ? NETWORK_LABEL[c.meta.network] ?? c.meta.network : "Social") : c.cluster || "Uncategorized";

type HistoryEvent = { at: string; title: string; who: string; detail?: string; color: string };

/** Real timeline from the timestamps a row actually carries. Order: oldest first, rendered newest first. */
function historyOf(c: ContentItem): HistoryEvent[] {
  const ev: HistoryEvent[] = [{ at: c.created_at, title: `${TYPE_LABEL[c.type] ?? "Item"} created`, who: agentOf(c), color: "#a78bfa" }];
  const m = c.meta ?? {};
  if (m.qualityGate && typeof m.qualityGate.score === "number") {
    ev.push({ at: c.created_at, title: m.qualityGate.passed ? "Passed the quality gate" : "Failed the quality gate", who: "Mr. QA", detail: `Score ${m.qualityGate.score}/100`, color: m.qualityGate.passed ? "#22c55e" : "#ef4444" });
  }
  if (m.seo?.checkedAt) ev.push({ at: m.seo.checkedAt, title: "SEO checked", who: "Mr. SEO", detail: typeof m.seo.score === "number" ? `SEO score ${m.seo.score}/100` : undefined, color: "#3b82f6" });
  if (m.editedAt) ev.push({ at: m.editedAt, title: "Edited by you", who: "You", detail: "Saved from the editor (v2)", color: "#22d3ee" });
  const upd = c.updated_at ?? c.created_at;
  switch (c.status) {
    case "awaiting_approval": ev.push({ at: upd, title: "Submitted for review", who: agentOf(c), color: "#fbbf24" }); break;
    case "published": ev.push({ at: upd, title: "Approved & published", who: "You", detail: m.publishedUrl ?? undefined, color: "#22c55e" }); break;
    case "approved": ev.push({ at: upd, title: "Approved — ready to copy", who: "You", detail: "Not posted anywhere (copy-only)", color: "#3b82f6" }); break;
    case "rejected": ev.push({ at: upd, title: "Rejected", who: "You", color: "#ef4444" }); break;
    case "failed": ev.push({ at: upd, title: "Publish failed", who: "Mr. Publish", detail: m.publishError, color: "#ef4444" }); break;
  }
  return ev.sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

/* ---------------------------------------------------------------------------------------- */

export default function ApprovalsSection() {
  const { act, report, toast } = useStore();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContentItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<"details" | "preview" | "history">("details");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  // filters
  const [q, setQ] = useState("");
  const [fAgent, setFAgent] = useState("all");
  const [fType, setFType] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fDate, setFDate] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "title">("newest");
  const [page, setPage] = useState(1);

  const load = () => {
    setLoading(true);
    fetch("/api/content?status=all")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setItems(data.items); else toast(data.error || "Couldn't load approvals.", "error"); })
      .catch(() => toast("Couldn't load approvals — try refreshing.", "error"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Default selection = first pending item (the mockup opens with the top pending article).
  // Runs ONCE after the first load — it used to re-fire on every render where selectedId was
  // null, which is exactly what the drawer's Close button sets, so Close never closed anything.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || !items.length) return;
    autoSelected.current = true;
    const first = items.find((i) => i.status === "awaiting_approval") ?? items[0];
    if (first && typeof window !== "undefined" && window.innerWidth >= 1280) setSelectedId(first.id);
  }, [items]);

  // Body isn't in the list payload (it's the whole article) — fetched per selection.
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const base = items.find((i) => i.id === selectedId) ?? null;
    setDetail(base);
    setDetailLoading(true);
    let dead = false;
    fetch(`/api/content/${selectedId}`)
      .then((r) => r.json())
      .then((d) => { if (!dead && d.ok) setDetail({ ...(base ?? {}), ...d.item }); })
      .catch(() => {})
      .finally(() => { if (!dead) setDetailLoading(false); });
    return () => { dead = true; };
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  /* ---- real actions (unchanged) ------------------------------------------------------- */

  const approve = async (c: ContentItem) => {
    setBusy(c.id);
    try {
      const res = await fetch(`/api/content/${c.id}/approve`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        if (data.copyOnly) {
          report(`Approved for copying — not posted anywhere: "${c.title}"`);
          toast("Marked ready — copy the text and post it yourself.");
          patchItem(c.id, { status: "approved" });
        } else {
          act(`"It's live. Prepare distribution."`, "Mr Lxwa", "Miss Social");
          report(`Published after your approval: "${c.title}"`);
          toast(data.url ? `Published! ${data.url}` : "Published!");
          patchItem(c.id, { status: "published", meta: { ...(c.meta ?? {}), publishedUrl: data.url ?? null } });
        }
      } else {
        toast(`${c.type === "social" ? "Couldn't approve" : "Publish failed"}: ${data.error}`, "error");
        if (res.status === 502) patchItem(c.id, { status: "failed", meta: { ...(c.meta ?? {}), publishError: data.error } });
      }
    } catch {
      toast("Network error — try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  const patchItem = (id: string, p: Partial<ContentItem>) => {
    const stamp = { updated_at: new Date().toISOString() };
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...p, ...stamp } : x)));
    setDetail((d) => (d && d.id === id ? { ...d, ...p, ...stamp } : d));
  };

  const copyPost = async (c: ContentItem) => {
    try {
      let body = c.body;
      if (typeof body !== "string") {
        const d = await fetch(`/api/content/${c.id}`).then((r) => r.json());
        body = d?.item?.body ?? "";
      }
      await navigator.clipboard.writeText(body ?? "");
      toast("Copied — paste it into the app.");
    } catch {
      toast("Couldn't copy — select and copy the text manually.", "error");
    }
  };

  const reject = (c: ContentItem) => {
    const prevStatus = c.status;
    patchItem(c.id, { status: "rejected" });
    let undone = false;
    const timer = setTimeout(async () => {
      setBusy(c.id);
      try {
        const res = await fetch(`/api/content/${c.id}/reject`, { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          act(`"Understood. We'll adjust and learn from this."`, "Mr Lxwa");
          report(`Rejected by you (team will adjust): "${c.title}"`);
        } else {
          restore();
          toast(`Reject failed: ${data.error}`, "error");
        }
      } catch {
        restore();
        toast("Reject failed — network error.", "error");
      } finally {
        setBusy(null);
      }
    }, 6000);
    const restore = () => patchItem(c.id, { status: prevStatus });
    toast("Rejected", "ok", {
      ms: 6000,
      action: { label: "Undo", onClick: () => { if (undone) return; undone = true; clearTimeout(timer); restore(); } },
    });
  };

  /* ---- derived -------------------------------------------------------------------------- */

  const counts = useMemo(() => {
    const n = (s: string) => items.filter((i) => i.status === s).length;
    return { total: items.length, pending: n("awaiting_approval"), published: n("published"), rejected: n("rejected") + n("failed"), draft: n("draft") };
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const since = fDate === "7d" ? Date.now() - 7 * 864e5 : fDate === "30d" ? Date.now() - 30 * 864e5 : fDate === "90d" ? Date.now() - 90 * 864e5 : 0;
    const out = items.filter((c) => {
      if (needle && !(c.title ?? "").toLowerCase().includes(needle) && !categoryOf(c).toLowerCase().includes(needle)) return false;
      if (fAgent !== "all" && agentOf(c) !== fAgent) return false;
      if (fType !== "all" && c.type !== fType) return false;
      if (fStatus !== "all" && c.status !== fStatus) return false;
      if (since && +new Date(c.updated_at ?? c.created_at) < since) return false;
      return true;
    });
    const key = (c: ContentItem) => +new Date(c.updated_at ?? c.created_at);
    if (sort === "newest") out.sort((a, b) => key(b) - key(a));
    else if (sort === "oldest") out.sort((a, b) => key(a) - key(b));
    else out.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    return out;
  }, [items, q, fAgent, fType, fStatus, fDate, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [q, fAgent, fType, fStatus, fDate, sort]);

  const agents = Array.from(new Set(items.map(agentOf)));
  const types = Array.from(new Set(items.map((i) => i.type)));

  const openDetail = (c: ContentItem, t: typeof tab = "details") => { setSelectedId(c.id); setTab(t); };

  /* ---- render ---------------------------------------------------------------------------- */

  return (
    <div className="flex h-full min-h-0 gap-3">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ============ centre column ============ */}
      <section className="ap-panel ap-main flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--lx-border)" }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="ap-h1">Approvals</h1>
              <BadgeCheck size={18} style={{ color: "#3b82f6", fill: "rgba(59,130,246,.25)" }} />
            </div>
            <p className="lx-mut mt-0.5" style={{ fontSize: 12 }}>Review and manage all generated content</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="ap-search ap-hdr-search" style={{ width: 170 }}>
              <Search size={15} className="lx-mut" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles..." />
            </label>
            <Link href="/dashboard/reports" className="ap-icobtn relative" title="Reports & notifications">
              <Bell size={16} />
              {counts.pending > 0 && <span className="ap-dot" />}
            </Link>
            <button className={`ap-icobtn ${showFilters ? "on" : ""}`} onClick={() => setShowFilters((v) => !v)} title="Toggle filters">
              <SlidersHorizontal size={16} />
            </button>
          </div>
        </header>

        <div className="lx-scroll flex-1 overflow-y-auto px-4 pb-4">
          {/* stat strip */}
          <div className="ap-stats mt-3">
            <Stat n={counts.total}     label="Total Articles" color="#8b5cf6" Icon={FileText} />
            <Stat n={counts.pending}   label="Pending Review" color="#f59e0b" Icon={Clock} />
            <Stat n={counts.published} label="Published"      color="#22c55e" Icon={CheckCircle2} />
            <Stat n={counts.rejected}  label="Rejected"       color="#ef4444" Icon={XCircle} />
            <Stat n={counts.draft}     label="In Progress"    color="#3b82f6" Icon={RefreshCw} />
          </div>

          {/* filter bar */}
          {showFilters && (
            <div className="mt-3 flex flex-wrap items-center gap-2 pt-3" style={{ borderTop: "1px solid var(--lx-border)" }}>
              <label className="ap-search" style={{ width: 160 }}>
                <Search size={15} className="lx-mut" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles..." />
              </label>
              <Select value={fAgent} onChange={setFAgent} options={[["all", "All Agents"], ...agents.map((a) => [a, a] as [string, string])]} />
              <Select value={fType} onChange={setFType} options={[["all", "All Types"], ...types.map((t) => [t, TYPE_LABEL[t] ?? t] as [string, string])]} />
              <Select value={fStatus} onChange={setFStatus} options={[["all", "All Status"], ...Object.entries(STATUS).map(([k, v]) => [k, v.label] as [string, string])]} />
              <Select value={fDate} onChange={setFDate} icon={<Calendar size={14} />} options={[["all", "All Dates"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"]]} />
              <div className="ml-auto">
                <Select value={sort} onChange={(v) => setSort(v as typeof sort)} options={[["newest", "Sort: Newest"], ["oldest", "Sort: Oldest"], ["title", "Sort: Title A–Z"]]} />
              </div>
            </div>
          )}

          {/* table head */}
          <div className="ap-grid ap-head mt-3">
            <span className="ap-c-a">Article</span><span className="ap-c-s">Status</span><span className="ap-c-v">Version</span><span className="ap-c-u">Updated</span><span className="ap-c-x text-right">Actions</span>
          </div>

          {/* rows */}
          <div className="mt-1.5 space-y-1.5">
            {loading ? (
              <div className="ap-row items-center justify-center py-10"><Loader2 size={18} className="ap-spin lx-mut" /><span className="lx-11 lx-mut ml-2">Loading…</span></div>
            ) : rows.length ? rows.map((c) => {
              const tile = tileOf(c.type);
              const selected = c.id === selectedId;
              const isBusy = busy === c.id;
              return (
                <div key={c.id} className={`ap-grid ap-row ${selected ? "on" : ""}`} onClick={() => openDetail(c)}>
                  {/* article */}
                  <div className="ap-c-a flex min-w-0 items-center gap-3">
                    <Tile tile={tile} size={44} />
                    <div className="min-w-0">
                      <ClampTitle text={c.title || "Untitled"} />
                      <div className="lx-10 lx-mut mt-1 flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
                        <span className="truncate">{categoryOf(c)}</span><i className="ap-sep" /><span>{agentOf(c)}</span><i className="ap-sep" />
                        <span>{typeof c.meta?.wordCount === "number" ? `${c.meta.wordCount.toLocaleString()} words` : "— words"}</span><i className="ap-sep" /><span>{TYPE_LABEL[c.type] ?? c.type}</span>
                      </div>
                      {c.meta?.publishedUrl && (
                        <a href={c.meta.publishedUrl} target="_blank" rel="noreferrer" className="ap-live" onClick={(e) => e.stopPropagation()} title={c.meta.publishedUrl}>
                          <ExternalLink size={11} /><span className="truncate">{c.meta.publishedUrl.replace(/^https?:\/\//, "")}</span>
                        </a>
                      )}
                    </div>
                  </div>
                  {/* status */}
                  <div className="ap-c-s"><StatusPill s={c.status} /></div>
                  {/* version */}
                  <div className="ap-c-v lx-11" style={{ color: "#d6d6e4" }}>{versionOf(c)}</div>
                  {/* updated */}
                  <div className="ap-c-u lx-11 whitespace-nowrap" style={{ color: "#d6d6e4" }}>
                    <div>{fmtDate(c.updated_at ?? c.created_at)}</div>
                    <div className="lx-10 lx-mut">{fmtTime(c.updated_at ?? c.created_at)}</div>
                  </div>
                  {/* actions */}
                  <div className="ap-c-x relative flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {c.type === "article" && (
                      <Link href={`/dashboard/content/${c.id}`} className="ap-bview" title="Open the full article review page">
                        <Monitor size={13} /><span>Browser View</span>
                      </Link>
                    )}
                    <RowAction c={c} busy={isBusy} onReview={() => openDetail(c)} onHistory={() => openDetail(c, "history")} />
                    <button className="ap-kebab" onClick={() => setMenuFor(menuFor === c.id ? null : c.id)} aria-label="More">
                      <MoreVertical size={16} />
                    </button>
                    {menuFor === c.id && (
                      <div className="ap-menu" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { openDetail(c, "preview"); setMenuFor(null); }}><Eye size={13} /> Preview</button>
                        {c.type === "article" && <Link href={`/dashboard/content/${c.id}`}><Monitor size={13} /> Browser View</Link>}
                        {c.type === "social" && <button onClick={() => { copyPost(c); setMenuFor(null); }}><Copy size={13} /> Copy text</button>}
                        {c.meta?.publishedUrl && <a href={c.meta.publishedUrl} target="_blank" rel="noreferrer"><ArrowRight size={13} /> Open live page</a>}
                        {c.status === "awaiting_approval" && (
                          <>
                            <button onClick={() => { approve(c); setMenuFor(null); }} disabled={isBusy}><Check size={13} /> {c.type === "social" && c.meta?.copyOnly ? "Mark ready" : "Approve & publish"}</button>
                            <button className="danger" onClick={() => { reject(c); setMenuFor(null); }} disabled={isBusy}><X size={13} /> Reject</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }) : (
              <div className="ap-row flex-col items-center gap-2 py-10 text-center">
                <div className="text-2xl">✨</div>
                <p className="lx-11 lx-mut">
                  {items.length ? "Nothing matches these filters." : "All clear — nothing here yet. Your team will notify you when new work is ready."}
                </p>
              </div>
            )}
          </div>

          {/* footer / pagination */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="lx-11 lx-mut">
              {filtered.length
                ? `Showing ${(safePage - 1) * PAGE_SIZE + 1} to ${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length} ${filtered.length === 1 ? "article" : "articles"}`
                : "Showing 0 articles"}
            </span>
            <div className="ap-pager">
              <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} aria-label="Previous"><ChevronLeft size={15} /></button>
              {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, safePage - 3), Math.max(0, safePage - 3) + 5).map((p) => (
                <button key={p} className={p === safePage ? "on" : ""} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button disabled={safePage >= pages} onClick={() => setPage(safePage + 1)} aria-label="Next"><ChevronRight size={15} /></button>
            </div>
          </div>
        </div>
      </section>

      {/* ============ right drawer ============ */}
      {selectedId && detail && (
        <>
          <div className="fixed inset-0 z-40 xl:hidden" style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(2px)" }} onClick={() => setSelectedId(null)} />
          <aside className="ap-panel ap-drawer">
            <Drawer
              c={detail}
              loading={detailLoading}
              busy={busy === detail.id}
              tab={tab}
              setTab={setTab}
              onClose={() => setSelectedId(null)}
              onApprove={() => approve(detail)}
              onReject={() => reject(detail)}
              onCopy={() => copyPost(detail)}
            />
          </aside>
        </>
      )}
    </div>
  );
}

/* ---- pieces ------------------------------------------------------------------------------ */

function Stat({ n, label, color, Icon }: { n: number; label: string; color: string; Icon: React.ElementType }) {
  return (
    <div className="ap-stat" style={{ "--c": color } as React.CSSProperties}>
      <span className="ap-stat-ico"><Icon size={17} /></span>
      <div>
        <div className="ap-stat-n">{n}</div>
        <div className="lx-10 lx-mut mt-0.5">{label}</div>
      </div>
    </div>
  );
}

function Select({ value, onChange, options, icon }: { value: string; onChange: (v: string) => void; options: [string, string][]; icon?: React.ReactNode }) {
  return (
    <label className="ap-select">
      {icon}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <ChevronDown size={13} className="lx-mut" />
    </label>
  );
}

function Tile({ tile, size = 60 }: { tile: ReturnType<typeof tileOf>; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, background: `linear-gradient(135deg,${tile.from},${tile.to})`, border: `1px solid ${tile.border}`, boxShadow: `0 0 18px ${tile.glow}`, color: "#e8e8ff" }}
    >
      <tile.Icon size={Math.round(size * 0.42)} strokeWidth={1.6} />
    </span>
  );
}

function StatusPill({ s }: { s: string }) {
  const st = statusOf(s);
  return (
    <span className="lx-pill" style={{ color: st.color, background: st.bg, borderColor: st.border }}>
      <i className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
      {st.label}
    </span>
  );
}

function RowAction({ c, busy, onReview, onHistory }: { c: ContentItem; busy: boolean; onReview: () => void; onHistory: () => void }) {
  if (busy) return <span className="lx-ghost" style={{ minWidth: 88, justifyContent: "center" }}><Loader2 size={14} className="ap-spin" /></span>;
  switch (c.status) {
    case "awaiting_approval":
      return <button className="lx-grad ap-primary" onClick={onReview}>Review <ArrowRight size={14} /></button>;
    case "published":
      return c.meta?.publishedUrl
        ? <a className="lx-ghost" href={c.meta.publishedUrl} target="_blank" rel="noreferrer"><Eye size={14} /> View</a>
        : <button className="lx-ghost" onClick={onReview}><Eye size={14} /> View</button>;
    case "approved":
      return <button className="lx-ghost" onClick={onReview}><Eye size={14} /> View</button>;
    case "draft":
      return c.type === "article"
        ? <Link className="lx-ghost" href={`/dashboard/content/${c.id}`}>Continue <Pencil size={13} /></Link>
        : <button className="lx-ghost" onClick={onReview}>Continue <Pencil size={13} /></button>;
    default:
      return <button className="lx-ghost" onClick={onHistory}>Review History</button>;
  }
}

function Drawer({ c, loading, busy, tab, setTab, onClose, onApprove, onReject, onCopy }: {
  c: ContentItem; loading: boolean; busy: boolean; tab: "details" | "preview" | "history";
  setTab: (t: "details" | "preview" | "history") => void; onClose: () => void; onApprove: () => void; onReject: () => void; onCopy: () => void;
}) {
  const st = statusOf(c.status);
  const tile = tileOf(c.type);
  const events = useMemo(() => historyOf(c), [c]);
  const pending = c.status === "awaiting_approval";
  const bodyHtml = useMemo(() => (c.type === "article" && c.body ? renderMarkdown(c.body) : ""), [c.type, c.body]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [c.id, tab]);

  return (
    <>
      {/* head */}
      <div className="px-4 pt-4" style={{ paddingRight: 52 }}>
        <button className="ap-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="flex items-start gap-3">
          <Tile tile={tile} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="ap-h2">{c.title || "Untitled"}</h2>
              <StatusPill s={c.status} />
            </div>
            <div className="lx-10 lx-mut mt-1.5 flex items-center gap-2">
              <span className="truncate">{categoryOf(c)}</span><i className="ap-sep" /><span className="whitespace-nowrap">{agentOf(c)}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-6" style={{ borderBottom: "1px solid var(--lx-border)" }}>
          {([["details", "Details"], ["preview", "Content Preview"], ["history", "History"]] as const).map(([k, l]) => (
            <button key={k} className={`lx-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {/* body */}
      <div ref={scroller} className="lx-scroll flex-1 overflow-y-auto px-4 py-4">
        {tab === "details" && (
          <>
            <div className="ap-card grid grid-cols-2 gap-x-4 gap-y-4 p-4">
              <Field label="Status"><StatusPill s={c.status} /></Field>
              <Field label="Current Version"><span className="lx-12" style={{ color: "#e8e8f2" }}>{versionOf(c)}</span></Field>
              <Field label="Created by"><span className="flex items-center gap-2 lx-11"><span className="ap-avatar"><UserRound size={12} /></span>{agentOf(c)}</span></Field>
              <Field label="Word Count"><span className="lx-12" style={{ color: "#e8e8f2" }}>{typeof c.meta?.wordCount === "number" ? c.meta.wordCount.toLocaleString() : "not recorded"}</span></Field>
              <Field label="Created"><span className="flex items-center gap-1.5 lx-11"><Calendar size={13} className="lx-mut" />{fmtBoth(c.created_at)}</span></Field>
              <Field label="Last Updated"><span className="flex items-center gap-1.5 lx-11"><Calendar size={13} className="lx-mut" />{fmtBoth(c.updated_at ?? c.created_at)}</span></Field>
              <Field label="Type"><span className="lx-pill blue">{TYPE_LABEL[c.type] ?? c.type}</span></Field>
              <Field label="Category"><span className="lx-pill purple">{categoryOf(c)}</span></Field>
              {c.meta?.publishedUrl && (
                <Field label="Live URL" wide>
                  <a href={c.meta.publishedUrl} target="_blank" rel="noreferrer" className="lx-11 truncate block" style={{ color: "#60a5fa" }}>{c.meta.publishedUrl}</a>
                </Field>
              )}
              {c.meta?.publishError && (
                <Field label="Publish error" wide><span className="lx-11" style={{ color: "#f87171" }}>{c.meta.publishError}</span></Field>
              )}
            </div>
            <div className="ap-card mt-3 p-4">
              <h3 className="ap-h3">Review History</h3>
              <Timeline events={events} />
            </div>
          </>
        )}

        {tab === "preview" && (
          <div className="ap-card p-4">
            {loading && typeof c.body !== "string" ? (
              <div className="flex items-center gap-2 lx-11 lx-mut"><Loader2 size={14} className="ap-spin" /> Loading content…</div>
            ) : !c.body ? (
              <p className="lx-11 lx-mut">This item has no body text yet.</p>
            ) : c.type === "article" ? (
              <div className="ap-prose" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            ) : (
              <>
                <p className="lx-11" style={{ whiteSpace: "pre-wrap", margin: 0, color: "#e8e8f2", lineHeight: 1.6 }}>{c.body}</p>
                {c.meta?.imageBrief && <p className="lx-10 lx-mut mt-3">📷 {c.meta.imageBrief}</p>}
                <button className="lx-ghost mt-3" onClick={onCopy}><Copy size={13} /> Copy text</button>
              </>
            )}
            {c.type === "article" && (
              <Link href={`/dashboard/content/${c.id}`} className="lx-ghost mt-4 inline-flex"><Pencil size={13} /> Open full editor</Link>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="ap-card p-4">
            <h3 className="ap-h3">Review History</h3>
            <Timeline events={events} />
            <p className="lx-10 lx-dim mt-3">Built from the timestamps saved on this item — created, quality gate, SEO check, your edits, and its current status.</p>
          </div>
        )}
      </div>

      {/* actions */}
      <div className="px-4 pb-4 pt-3" style={{ borderTop: "1px solid var(--lx-border)" }}>
        <div className="grid grid-cols-2 gap-3">
          <button className="ap-reject" disabled={!pending || busy} onClick={onReject} title={pending ? "" : `A ${st.label.toLowerCase()} item can't be rejected`}>
            <X size={16} /> Reject
          </button>
          <button className="lx-grad ap-approve" disabled={!pending || busy} onClick={onApprove} title={pending ? "" : `A ${st.label.toLowerCase()} item can't be approved`}>
            {busy ? <Loader2 size={16} className="ap-spin" /> : <Check size={16} />} {c.type === "social" && c.meta?.copyOnly ? "Mark ready" : "Approve"}
          </button>
        </div>
        {c.type === "article" ? (
          <Link href={`/dashboard/content/${c.id}`} className="ap-changes mt-3"><RefreshCw size={15} /> Request Changes</Link>
        ) : (
          <button className="ap-changes mt-3" onClick={onCopy}><Copy size={15} /> Copy text</button>
        )}
      </div>
    </>
  );
}

/** One-line ellipsised title; the full text pops up on hover ONLY when it was actually cut off
 *  (measured, not guessed — a short title never gets a pointless tooltip). */
function ClampTitle({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div className="ap-title-wrap">
      <div ref={ref} className="ap-title">{text}</div>
      {clipped && <div className="ap-tip" role="tooltip">{text}</div>}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <div className="lx-10 lx-mut mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function Timeline({ events }: { events: HistoryEvent[] }) {
  return (
    <div className="ap-tl mt-3">
      {events.map((e, i) => (
        <div key={i} className="ap-tl-item">
          <span className="ap-tl-dot" style={{ "--c": e.color } as React.CSSProperties} />
          <div className="lx-10 lx-mut">{fmtBoth(e.at)}</div>
          <div className="lx-11 mt-0.5" style={{ color: "#e8e8f2" }}>{e.title}</div>
          {e.detail && <div className="lx-10 lx-mut mt-0.5 break-words">{e.detail}</div>}
          <div className="lx-10 lx-mut mt-0.5">{e.who === "You" ? "Reviewer: You" : e.who}</div>
        </div>
      ))}
    </div>
  );
}

/* ---- page-local CSS (colours/spacing measured off the reference mockup) ------------------ */
const CSS = `
.ap-panel{background:#0a0a11;border:1px solid var(--lx-border);border-radius:16px}
/* the centre column is sized by the CONTAINER (drawer open = ~540px even on a 1366px screen),
   so every breakpoint below is a container query, never a viewport one */
.ap-main{container-type:inline-size;container-name:ap}
.ap-hdr-search{display:none}
@container ap (min-width:760px){.ap-hdr-search{display:flex}}
.ap-drawer{display:flex;flex-direction:column;width:min(92vw,400px);flex-shrink:0;position:fixed;top:12px;right:12px;bottom:12px;z-index:50;
  box-shadow:0 20px 60px rgba(0,0,0,.6)}
@media (min-width:1280px){.ap-drawer{position:relative;top:auto;right:auto;bottom:auto;height:100%;z-index:auto;box-shadow:none}}
.ap-h1{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.ap-h2{font-size:17px;font-weight:700;line-height:1.3;color:#fff;min-width:0}
.ap-h3{font-size:14px;font-weight:700;color:#fff}
.ap-search{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:9px;
  background:#0d0d16;border:1px solid var(--lx-border);transition:border-color .15s}
.ap-search:focus-within{border-color:rgba(139,92,246,.55)}
.ap-search input{flex:1;min-width:0;background:none;border:none;outline:none;color:#e8e8f2;font-size:12px}
.ap-search input::placeholder{color:var(--lx-dim)}
.ap-icobtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;
  border:1px solid var(--lx-border);background:#0d0d16;color:#9a9ab2;cursor:pointer;transition:.15s;flex-shrink:0}
.ap-icobtn:hover,.ap-icobtn.on{color:#fff;border-color:rgba(139,92,246,.55)}
.ap-dot{position:absolute;top:8px;right:8px;width:6px;height:6px;border-radius:50%;background:#8b5cf6;box-shadow:0 0 6px #8b5cf6}
.ap-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px}
.ap-stat{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;min-width:0;
  background:color-mix(in srgb,var(--c) 9%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 40%,transparent);
  box-shadow:inset 0 0 30px color-mix(in srgb,var(--c) 5%,transparent)}
.ap-stat-ico{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;flex-shrink:0;
  color:var(--c);background:color-mix(in srgb,var(--c) 14%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);
  box-shadow:0 0 14px color-mix(in srgb,var(--c) 30%,transparent)}
.ap-stat-n{font-size:19px;font-weight:800;line-height:1;color:#fff}
.ap-stat .lx-10{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-select{position:relative;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 8px 0 10px;border-radius:9px;
  background:#0d0d16;border:1px solid var(--lx-border);color:#d6d6e4;font-size:12px;cursor:pointer}
.ap-select:hover{border-color:rgba(139,92,246,.45)}
.ap-select select{appearance:none;-webkit-appearance:none;background:none;border:none;outline:none;color:inherit;font:inherit;
  padding-right:2px;cursor:pointer}
.ap-select select option{background:#12121c;color:#e8e8f2}
.ap-grid{display:grid;grid-template-columns:minmax(0,1fr) 128px 56px 96px max-content;grid-template-areas:"a s v u x";align-items:center;gap:10px}
.ap-c-a{grid-area:a;min-width:0}.ap-c-s{grid-area:s}.ap-c-v{grid-area:v}.ap-c-u{grid-area:u}.ap-c-x{grid-area:x}
.ap-bview{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:9px;font-size:11.5px;font-weight:600;white-space:nowrap;
  color:#7dd3fc;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.35);transition:.15s}
.ap-bview:hover{background:rgba(56,189,248,.16);color:#fff;border-color:rgba(56,189,248,.6)}
.ap-live{display:inline-flex;align-items:center;gap:4px;max-width:100%;margin-top:3px;font-size:11px;color:#4ade80;text-decoration:none}
.ap-live:hover{text-decoration:underline}
@container ap (max-width:980px){
  .ap-grid{grid-template-columns:minmax(0,1fr) 118px max-content;grid-template-areas:"a s x";gap:8px}
  .ap-c-v,.ap-c-u{display:none}
}
@container ap (max-width:620px){
  .ap-grid{grid-template-columns:minmax(0,1fr) max-content;grid-template-areas:"a a" "s x";row-gap:10px}
  .ap-head{display:none}
  .ap-c-s{justify-self:start}
}
.ap-head{padding:0 12px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--lx-mut)}
.ap-row{background:#0d0d16;border:1px solid var(--lx-border);border-radius:11px;padding:10px 12px;cursor:pointer;
  transition:border-color .15s,background .15s;display:grid;position:relative}
.ap-row:hover{border-color:rgba(255,255,255,.14);background:#10101a;z-index:5}
.ap-row.on{border-color:rgba(139,92,246,.5);box-shadow:0 0 0 1px rgba(139,92,246,.2),0 0 22px rgba(139,92,246,.12)}
.ap-title-wrap{position:relative;min-width:0}
.ap-title{font-size:13.5px;font-weight:600;color:#fff;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* full title on hover — a real tooltip, not the browser's slow native one */
.ap-tip{position:absolute;left:0;top:calc(100% + 6px);z-index:40;max-width:min(460px,70vw);width:max-content;padding:8px 10px;border-radius:9px;
  background:#16161f;border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 32px rgba(0,0,0,.6);
  color:#f2f2f7;font-size:12.5px;font-weight:500;line-height:1.45;white-space:normal;
  opacity:0;pointer-events:none;transform:translateY(-3px);transition:opacity .15s,transform .15s;transition-delay:0s}
.ap-title-wrap:hover .ap-tip{opacity:1;transform:translateY(0);transition-delay:.3s}
.ap-sep{width:3px;height:3px;border-radius:50%;background:var(--lx-dim);flex-shrink:0}
.ap-primary{padding:6px 12px;font-size:12px;border-radius:9px;gap:6px}
.ap-row .lx-ghost{padding:6px 10px;font-size:11.5px;border-radius:9px}
.ap-kebab{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;
  background:none;border:none;color:#8b8ba0;cursor:pointer;transition:.15s}
.ap-kebab:hover{color:#fff;background:rgba(255,255,255,.06)}
.ap-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;min-width:190px;padding:6px;border-radius:12px;
  background:#12121c;border:1px solid rgba(255,255,255,.1);box-shadow:0 12px 32px rgba(0,0,0,.55)}
.ap-menu>*{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border-radius:8px;border:none;background:none;
  color:#d6d6e4;font-size:12.5px;cursor:pointer;text-align:left}
.ap-menu>*:hover{background:rgba(255,255,255,.06);color:#fff}
.ap-menu>*:disabled{opacity:.5;cursor:not-allowed}
.ap-menu>.danger{color:#f87171}
.ap-pager{display:flex;align-items:center;gap:6px}
.ap-pager button{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:32px;padding:0 8px;border-radius:9px;
  border:1px solid var(--lx-border);background:#0d0d16;color:#d6d6e4;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.ap-pager button:hover:not(:disabled){border-color:rgba(139,92,246,.5);color:#fff}
.ap-pager button:disabled{opacity:.35;cursor:not-allowed}
.ap-pager button.on{background:linear-gradient(135deg,#4f46e5,#7c3aed);border-color:rgba(139,92,246,.7);color:#fff;
  box-shadow:0 4px 16px rgba(124,58,237,.35)}
.ap-close{position:absolute;top:16px;right:14px;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
  border-radius:8px;border:none;background:none;color:#9a9ab2;cursor:pointer}
.ap-close:hover{color:#fff;background:rgba(255,255,255,.06)}
@media (min-width:1280px){.ap-drawer .ap-close{right:46px}}
.ap-card{background:#0d0d16;border:1px solid var(--lx-border);border-radius:12px}
.ap-avatar{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;
  background:#1a1a26;border:1px solid var(--lx-border);color:#c4c4d4}
.ap-tl{position:relative;padding-left:18px}
.ap-tl::before{content:"";position:absolute;left:5px;top:6px;bottom:6px;width:1px;background:rgba(255,255,255,.08)}
.ap-tl-item{position:relative;padding-bottom:16px}
.ap-tl-item:last-child{padding-bottom:0}
.ap-tl-dot{position:absolute;left:-18px;top:3px;width:11px;height:11px;border-radius:50%;background:#0d0d16;
  border:2px solid var(--c);box-shadow:0 0 8px color-mix(in srgb,var(--c) 70%,transparent)}
.ap-reject{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;border-radius:12px;font-size:14px;font-weight:600;
  color:#f87171;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.45);cursor:pointer;transition:.15s}
.ap-reject:hover:not(:disabled){background:rgba(239,68,68,.16)}
.ap-approve{height:44px;font-size:14px;border-radius:12px}
.ap-reject:disabled,.ap-approve:disabled{opacity:.4;cursor:not-allowed;filter:none}
.ap-changes{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border-radius:12px;font-size:14px;font-weight:600;
  color:#e8e8f2;background:rgba(255,255,255,.03);border:1px solid var(--lx-border);cursor:pointer;transition:.15s}
.ap-changes:hover{border-color:rgba(139,92,246,.55);color:#fff}
.ap-spin{animation:apSpin 1s linear infinite}
@keyframes apSpin{to{transform:rotate(360deg)}}
.ap-prose{font-size:13px;line-height:1.7;color:#d6d6e4}
.ap-prose h1{font-size:18px;font-weight:800;color:#fff;margin:0 0 12px}
.ap-prose h2{font-size:15px;font-weight:700;color:#fff;margin:18px 0 8px}
.ap-prose h3{font-size:13.5px;font-weight:700;color:#fff;margin:14px 0 6px}
.ap-prose p{margin:0 0 10px}
.ap-prose ul,.ap-prose ol{padding-left:18px;margin:0 0 10px}
.ap-prose a{color:#60a5fa}
.ap-prose img{max-width:100%;border-radius:8px}
`;
