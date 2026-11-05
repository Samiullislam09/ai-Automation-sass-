"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, BadgeCheck, Bell, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Clock,
  Copy, Eye, FileText, Loader2, Megaphone, MapPin, MoreVertical, Pencil, RefreshCw, Search,
  SlidersHorizontal, UserRound, X, XCircle, CheckCircle2, Monitor, ExternalLink, History, Plus,
  Image as ImageIcon, Sparkles, Undo2,
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
    /** type "image_set" (MASTER_PLAN §19.4.7): every picture made for the parent article, each
     *  with the heading it belongs under so a reviewer can see WHY it is that picture. */
    images?: { slot: string; url: string; alt: string; anchor: string | null; provider: string; kind: string; note?: string; width?: number; height?: number }[];
    /** type "web_story": the pages, in order. */
    pages?: { headline: string; body?: string; image?: string }[];
    storyUrl?: string | null;
  } | null;
  /** Which article an image_set or web_story belongs to — the three reviewable parts of one
   *  order are joined by this (§19.4.7). */
  blueprint?: { parent_article_id?: string } | null;
  created_at: string;
  updated_at?: string;
};

const PAGE_SIZE = 10;
const LIST_CACHE_KEY = "ap:list:v1";

/** The whole team, so the Agent filter is a real roster and not "whoever happens to have a row
 *  today". Only the content agents leave rows here; the rest show 0, which is honest. */
const ALL_AGENTS = [
  "Mr. Lxwa", "Mr. Crawler", "Mr. Analyst", "Mr. Keyword", "Mr. Writer", "Mr. Image",
  "Mr. SEO", "Mr. Story", "Mr. Audit", "Miss Social", "Mr. Leads", "Mr. Publish",
];

const NETWORK_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", x: "X (Twitter)" };

/** Which agent authored a row — by type; the writer/social agents are the only ones that create content_items. */
const AGENT_BY_TYPE: Record<string, string> = { article: "Mr. Writer", social: "Miss Social", gbp: "Mr. Writer", image_set: "Mr. Image", web_story: "Mr. Story" };
const TYPE_LABEL: Record<string, string> = { article: "Blog Post", social: "Social Post", gbp: "GBP Post", image_set: "Images", web_story: "Web Story" };

const STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  awaiting_approval: { label: "Pending Review", color: "#fbbf24", bg: "rgba(251,191,36,.10)", border: "rgba(251,191,36,.35)" },
  published:         { label: "Published",      color: "var(--lx-green)", bg: "rgba(34,197,94,.10)",  border: "rgba(34,197,94,.35)" },
  approved:          { label: "Approved",       color: "var(--lx-blue)", bg: "rgba(59,130,246,.12)", border: "rgba(59,130,246,.35)" },
  rejected:          { label: "Rejected",       color: "#f87171", bg: "rgba(239,68,68,.12)",  border: "rgba(239,68,68,.35)" },
  failed:            { label: "Publish Failed", color: "#f87171", bg: "rgba(239,68,68,.12)",  border: "rgba(239,68,68,.35)" },
  draft:             { label: "Draft",          color: "var(--lx-mut)", bg: "var(--ap-s1)", border: "var(--ap-s2)" },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s, color: "var(--lx-mut)", bg: "var(--ap-s1)", border: "var(--ap-s2)" };

/** Tile colour per type — the mockup gives every article its own tinted icon tile. */
const TILE: Record<string, { from: string; to: string; border: string; glow: string; Icon: React.ElementType }> = {
  article: { from: "#0f1a3a", to: "#1a0f3a", border: "rgba(99,102,241,.6)",  glow: "rgba(99,102,241,.35)",  Icon: FileText },
  social:  { from: "#1a0f3a", to: "#2a0f3a", border: "rgba(168,85,247,.6)",  glow: "rgba(168,85,247,.35)",  Icon: Megaphone },
  gbp:     { from: "#0a1f1a", to: "#0a2a1f", border: "rgba(34,197,94,.55)",  glow: "rgba(34,197,94,.3)",    Icon: MapPin },
  image_set: { from: "#2a0f22", to: "#3a0f2a", border: "rgba(244,114,182,.6)", glow: "rgba(244,114,182,.35)", Icon: ImageIcon },
  web_story: { from: "#0f2a2a", to: "#0f1a3a", border: "rgba(56,189,248,.6)",  glow: "rgba(56,189,248,.35)",  Icon: Sparkles },
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

/** The same screen serves /dashboard/approvals and /dashboard/content (owner, 2026-09-05:
 *  "content page ka UI approval jaisa kardo") — it already lists every status with filters, so
 *  Content is this list with its own title and a Create new button, not a second design. */
export default function ApprovalsSection({
  heading = "Approvals",
  subtitle = "Review and manage all generated content",
  createHref,
  initialItems,
}: {
  heading?: string;
  subtitle?: string;
  createHref?: string;
  /** Rows the server already read for this render: the page paints with data, no extra fetch. */
  initialItems?: ContentItem[];
} = {}) {
  const { act, report, toast } = useStore();
  const [items, setItems] = useState<ContentItem[]>(initialItems ?? []);
  const [loading, setLoading] = useState(!initialItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContentItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<"details" | "preview" | "history">("details");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // filters
  const [q, setQ] = useState("");
  const [fAgent, setFAgent] = useState("all");
  const [fType, setFType] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fDate, setFDate] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "title">("newest");
  const [page, setPage] = useState(1);

  // Stale-while-revalidate: the list from the last visit paints instantly and the network
  // refresh replaces it quietly. The spinner only shows on a true first load.
  const hasData = useRef(!!initialItems);
  const abortRef = useRef<AbortController | null>(null);
  /** `query` goes to the database (title ILIKE), so search reaches every item, not just the 100
   *  the page loads. Typing also filters what is already on screen instantly, below. */
  const load = (query = "") => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (!hasData.current) setLoading(true);
    setSearching(!!query);
    fetch(`/api/content?status=all${query ? `&q=${encodeURIComponent(query)}` : ""}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((data) => {
        if (ac.signal.aborted) return;
        if (data.ok) {
          hasData.current = true;
          setItems(data.items);
          if (!query) { try { sessionStorage.setItem(LIST_CACHE_KEY, JSON.stringify(data.items)); } catch { /* quota or private mode: fine */ } }
        } else toast(data.error || "Couldn't load approvals.", "error");
      })
      .catch((e) => { if (e?.name !== "AbortError") toast("Couldn't load approvals. Try refreshing.", "error"); })
      .finally(() => { if (!ac.signal.aborted) { setLoading(false); setSearching(false); } });
  };
  useEffect(() => {
    if (initialItems) {
      try { sessionStorage.setItem(LIST_CACHE_KEY, JSON.stringify(initialItems)); } catch { /* fine */ }
      return;
    }
    try {
      const raw = sessionStorage.getItem(LIST_CACHE_KEY);
      const cached = raw ? JSON.parse(raw) : null;
      if (Array.isArray(cached) && cached.length) { hasData.current = true; setItems(cached); setLoading(false); }
    } catch { /* unreadable cache: just load */ }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live search: wait 300ms after the last keystroke, then ask the server.
  const firstQ = useRef(true);
  useEffect(() => {
    if (firstQ.current) { firstQ.current = false; return; }
    const t = setTimeout(() => load(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (data.part) {
          toast("Approved.");
          patchItem(c.id, { status: "approved" });
        } else if (data.copyOnly) {
          report(`Approved for copying — not posted anywhere: "${c.title}"`);
          toast("Marked ready — copy the text and post it yourself.");
          patchItem(c.id, { status: "approved" });
        } else {
          act(`"It's live. Prepare distribution."`, "Mr Lxwa", "Miss Social");
          report(`Published after your approval: "${c.title}"`);
          toast(data.url ? `Published! ${data.url}` : "Published!");
          patchItem(c.id, { status: "published", meta: { ...(c.meta ?? {}), publishedUrl: data.url ?? null } });
          settleKids(data.children, "approved");
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

  /** The pictures / story that moved with their article on the server: mirror it locally. */
  const settleKids = (ids: unknown, status: string) => {
    if (!Array.isArray(ids) || !ids.length) return;
    const set = new Set<string>(ids);
    const stamp = { updated_at: new Date().toISOString() };
    setItems((prev) => prev.map((x) => (set.has(x.id) ? { ...x, status, ...stamp } : x)));
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
          settleKids(data.children, "rejected");
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

  // One article = one row. Its pictures and web story hang under it (joined by
  // blueprint.parent_article_id) instead of showing up as separate rows to approve one by one.
  // A part whose article is not in this list (older than the page, or deleted) stays a row of its own.
  const { tops, kidsOf } = useMemo(() => {
    const ids = new Set(items.map((i) => i.id));
    const map = new Map<string, ContentItem[]>();
    const top: ContentItem[] = [];
    for (const i of items) {
      const parent = i.blueprint?.parent_article_id;
      if (parent && ids.has(parent)) map.set(parent, [...(map.get(parent) ?? []), i]);
      else top.push(i);
    }
    return { tops: top, kidsOf: map };
  }, [items]);

  const counts = useMemo(() => {
    const n = (s: string) => tops.filter((i) => i.status === s).length;
    return { total: tops.length, pending: n("awaiting_approval"), published: n("published"), rejected: n("rejected") + n("failed"), draft: n("draft") };
  }, [tops]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const since = fDate === "7d" ? Date.now() - 7 * 864e5 : fDate === "30d" ? Date.now() - 30 * 864e5 : fDate === "90d" ? Date.now() - 90 * 864e5 : 0;
    const out = tops.filter((c) => {
      if (needle && !(c.title ?? "").toLowerCase().includes(needle) && !categoryOf(c).toLowerCase().includes(needle)) return false;
      if (fAgent !== "all" && agentOf(c) !== fAgent) return false;
      if (fType !== "all" && c.type !== fType) return false;
      if (fStatus === "rejected" ? !(c.status === "rejected" || c.status === "failed") : fStatus !== "all" && c.status !== fStatus) return false;
      if (since && +new Date(c.updated_at ?? c.created_at) < since) return false;
      return true;
    });
    const key = (c: ContentItem) => +new Date(c.updated_at ?? c.created_at);
    if (sort === "newest") out.sort((a, b) => key(b) - key(a));
    else if (sort === "oldest") out.sort((a, b) => key(a) - key(b));
    else out.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    return out;
  }, [tops, q, fAgent, fType, fStatus, fDate, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [q, fAgent, fType, fStatus, fDate, sort]);
  // A new page starts at the top, not wherever the last one was scrolled to.
  const listScroll = useRef<HTMLDivElement>(null);
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) { firstPage.current = false; return; }
    listScroll.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [safePage]);

  const agentCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of tops) m.set(agentOf(i), (m.get(agentOf(i)) ?? 0) + 1);
    return m;
  }, [tops]);
  const filtersOn = !!q || fAgent !== "all" || fType !== "all" || fStatus !== "all" || fDate !== "all";
  const clearFilters = () => { setQ(""); setFAgent("all"); setFType("all"); setFStatus("all"); setFDate("all"); };
  const types = Array.from(new Set(items.map((i) => i.type)));

  const openDetail = (c: ContentItem, t: typeof tab = "details") => { setSelectedId(c.id); setTab(t); };

  /* ---- render ---------------------------------------------------------------------------- */

  return (
    <div className="ap-root flex h-full min-h-0 gap-3">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ============ centre column ============ */}
      <section className="ap-panel ap-main flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="ap-hdr">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="ap-h1">{heading}</h1>
              <BadgeCheck size={18} style={{ color: "#3b82f6", fill: "rgba(59,130,246,.25)" }} />
            </div>
            <p className="lx-mut mt-0.5" style={{ fontSize: 12 }}>{subtitle}</p>
          </div>
          {counts.pending > 0 && (
            <button className="ap-todo" onClick={() => setFStatus("awaiting_approval")} title="Show only what is waiting for you">
              <span className="ap-todo-dot" /> {counts.pending} waiting for you
            </button>
          )}
          <button className="ap-icobtn" onClick={() => load(q.trim())} title="Refresh the list" aria-label="Refresh">
            <RefreshCw size={15} className={loading || searching ? "ap-spin" : ""} />
          </button>
          {createHref && (
            <Link href={createHref} className="lx-grad ap-create" title="Ask the team for something new">
              <Plus size={15} /> <span className="ap-create-t">Create new</span>
            </Link>
          )}
        </header>

        <div ref={listScroll} className="lx-scroll flex-1 overflow-y-auto px-4 pb-4">
          {/* stat strip: each tile is also the status filter */}
          <div className="ap-stats mt-3">
            <Stat n={loading ? "–" : counts.total}     label="All items"      color="#8b5cf6" Icon={FileText}     on={fStatus === "all"}               onClick={() => setFStatus("all")} />
            <Stat n={loading ? "–" : counts.pending}   label="Pending review" color="#f59e0b" Icon={Clock}        on={fStatus === "awaiting_approval"} onClick={() => setFStatus("awaiting_approval")} />
            <Stat n={loading ? "–" : counts.published} label="Published"      color="#22c55e" Icon={CheckCircle2} on={fStatus === "published"}         onClick={() => setFStatus("published")} />
            <Stat n={loading ? "–" : counts.rejected}  label="Rejected"       color="#ef4444" Icon={XCircle}      on={fStatus === "rejected"}          onClick={() => setFStatus("rejected")} />
            <Stat n={loading ? "–" : counts.draft}     label="In progress"    color="#3b82f6" Icon={RefreshCw}    on={fStatus === "draft"}             onClick={() => setFStatus("draft")} />
          </div>

          {/* toolbar: one search, four filters, one clear */}
          <div className="ap-toolbar mt-3">
            <label className="ap-search ap-search-main">
              <Search size={15} className="lx-mut" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title" aria-label="Search by title" />
              {searching && <Loader2 size={14} className="ap-spin lx-mut" />}
              {q && !searching && <button className="ap-x" onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}
            </label>
            <Select value={fAgent} onChange={setFAgent} options={[["all", "All agents"], ...ALL_AGENTS.map((a) => [a, `${a} (${agentCount.get(a) ?? 0})`] as [string, string])]} />
            <Select value={fType} onChange={setFType} options={[["all", "All types"], ...types.map((t) => [t, TYPE_LABEL[t] ?? t] as [string, string])]} />
            <Select value={fDate} onChange={setFDate} icon={<Calendar size={14} />} options={[["all", "Any date"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"]]} />
            <Select value={sort} onChange={(v) => setSort(v as typeof sort)} options={[["newest", "Newest first"], ["oldest", "Oldest first"], ["title", "Title A to Z"]]} />
            {filtersOn && <button className="ap-clear" onClick={clearFilters}><X size={13} /> Clear</button>}
          </div>

          {/* table head */}
          <div className="ap-grid ap-head mt-3">
            <span className="ap-c-a">Item</span><span className="ap-c-s">Status</span><span className="ap-c-u">Updated</span><span className="ap-c-x" />
          </div>

          {/* rows */}
          <div className="mt-2 space-y-3">
            {loading ? (
              <>{Array.from({ length: 5 }, (_, i) => <div key={i} className="ap-skel" aria-hidden />)}</>
            ) : rows.length ? rows.map((c) => {
              const tile = tileOf(c.type);
              const selected = c.id === selectedId;
              const isBusy = busy === c.id;
              return (
                <div key={c.id} className={`ap-grid ap-row ${selected ? "on" : ""}`} onClick={() => openDetail(c)}>
                  {/* article */}
                  <div className="ap-c-a flex min-w-0 items-center gap-4">
                    <Tile tile={tile} size={38} />
                    <div className="min-w-0">
                      <ClampTitle text={c.title || "Untitled"} />
                      <div className="ap-meta lx-10 lx-mut mt-1.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
                        <span className="ap-inline-status"><StatusPill s={c.status} /></span>
                        <span className="truncate">{categoryOf(c)}</span><i className="ap-sep" /><span>{agentOf(c)}</span><i className="ap-sep" />
                        <span>{typeof c.meta?.wordCount === "number" ? `${c.meta.wordCount.toLocaleString()} words` : "— words"}</span><i className="ap-sep" /><span>{TYPE_LABEL[c.type] ?? c.type}</span>
                        <i className="ap-sep ap-inline-date" /><span className="ap-inline-date">{fmtBoth(c.updated_at ?? c.created_at)}</span>
                      </div>
                      {(kidsOf.get(c.id)?.length ?? 0) > 0 && (
                        <div className="ap-kids" onClick={(e) => e.stopPropagation()}>
                          {kidsOf.get(c.id)!.map((k) => (
                            <button key={k.id} className="ap-kid" onClick={() => openDetail(k, "preview")} title={`Open ${TYPE_LABEL[k.type] ?? k.type}`}>
                              {k.type === "web_story" ? <Sparkles size={11} /> : <ImageIcon size={11} />}
                              {k.type === "image_set" && (k.meta?.images?.length ?? 0) > 0 ? `${k.meta!.images!.length} images` : TYPE_LABEL[k.type] ?? k.type}
                            </button>
                          ))}
                        </div>
                      )}
                      {c.meta?.publishedUrl && (
                        <a href={c.meta.publishedUrl} target="_blank" rel="noreferrer" className="ap-live" onClick={(e) => e.stopPropagation()} title={c.meta.publishedUrl}>
                          <ExternalLink size={11} /><span className="truncate">{c.meta.publishedUrl.replace(/^https?:\/\//, "")}</span>
                        </a>
                      )}
                    </div>
                  </div>
                  {/* status */}
                  <div className="ap-c-s"><StatusPill s={c.status} /></div>
                  {/* updated */}
                  <div className="ap-c-u lx-11 whitespace-nowrap" style={{ color: "var(--lx-text)" }}>
                    <div>{fmtDate(c.updated_at ?? c.created_at)}</div>
                    <div className="lx-10 lx-mut">{fmtTime(c.updated_at ?? c.created_at)}</div>
                  </div>
                  {/* actions */}
                  <div className="ap-c-x relative flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <RowAction c={c} busy={isBusy} onReview={() => openDetail(c)} onHistory={() => openDetail(c, "history")} onApprove={() => approve(c)} />
                    <button className="ap-kebab" onClick={() => setMenuFor(menuFor === c.id ? null : c.id)} aria-label="More">
                      <MoreVertical size={16} />
                    </button>
                    {menuFor === c.id && (
                      <div className="ap-menu" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { openDetail(c, "preview"); setMenuFor(null); }}><Eye size={13} /> Quick preview</button>
                        {c.type === "article" && <Link href={`/dashboard/content/${c.id}`} target="_blank" rel="noopener" onClick={() => setMenuFor(null)}><Monitor size={13} /> Open in new tab</Link>}
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
              kids={kidsOf.get(detail.id) ?? []}
              onOpenKid={(k) => openDetail(k, "preview")}
              parent={detail.blueprint?.parent_article_id ? items.find((i) => i.id === detail.blueprint!.parent_article_id) ?? null : null}
              onOpenParent={(pa) => openDetail(pa)}
              onItemUpdated={(it) => {
                setDetail((d) => (d && d.id === it.id ? { ...d, ...it } : d));
                setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, meta: it.meta } : x)));
              }}
            />
          </aside>
        </>
      )}
    </div>
  );
}

/* ---- pieces ------------------------------------------------------------------------------ */

function Stat({ n, label, color, Icon, on, onClick }: { n: number | string; label: string; color: string; Icon: React.ElementType; on?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`ap-stat ${on ? "on" : ""}`} style={{ "--c": color } as React.CSSProperties} onClick={onClick} aria-pressed={!!on} title={`Show ${label.toLowerCase()}`}>
      <span className="ap-stat-ico"><Icon size={17} /></span>
      <span className="text-left">
        <span className="ap-stat-n block">{n}</span>
        <span className="lx-10 lx-mut mt-0.5 block">{label}</span>
      </span>
    </button>
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
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.28), color: "#e8e8ff",
        background: `linear-gradient(135deg,${tile.from},${tile.to})`, border: `1px solid ${tile.border}`,
        boxShadow: "inset 0 1px 0 var(--ap-s1), 0 1px 2px rgba(0,0,0,.35)",
      }}
    >
      <tile.Icon size={Math.round(size * 0.44)} strokeWidth={1.7} />
    </span>
  );
}

function StatusPill({ s }: { s: string }) {
  const st = statusOf(s);
  return (
    <span className="lx-pill ap-status" style={{ color: st.color, background: st.bg, borderColor: st.border }}>
      <i className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
      {st.label}
    </span>
  );
}

/** Icon-only row action — the label lives in the native tooltip so the row stays compact. */
function RowAction({ c, busy, onReview, onHistory, onApprove }: { c: ContentItem; busy: boolean; onReview: () => void; onHistory: () => void; onApprove: () => void }) {
  // Approving publishes, so the first click only arms the button ("Confirm?"); a second click
  // within 3 seconds does it. Reading the piece first is one click on the row.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  if (busy) return <span className="ap-btn"><Loader2 size={14} className="ap-spin" /></span>;
  const view = <button className="ap-btn" onClick={onReview}><Eye size={13} /> View</button>;
  const history = <button className="ap-btn" onClick={onHistory} title="See what happened"><History size={13} /> History</button>;
  switch (c.status) {
    case "awaiting_approval": {
      const label = c.type === "social" && c.meta?.copyOnly ? "Mark ready" : "Approve";
      return (
        <>
          <button className="ap-btn" onClick={onReview} title="Read it before you decide"><Eye size={13} /> Review</button>
          {armed
            ? <button className="ap-btn ap-btn-ok" onClick={() => { setArmed(false); onApprove(); }} title="Click again to confirm"><Check size={13} /> Confirm?</button>
            : <button className="ap-btn ap-btn-p" onClick={() => setArmed(true)} title={`${label}: click, then confirm`}><Check size={13} /> {label}</button>}
        </>
      );
    }
    case "published":
      return c.meta?.publishedUrl
        ? <>{view}<a className="ap-btn" href={c.meta.publishedUrl} target="_blank" rel="noreferrer" title="Open the live page"><ExternalLink size={13} /> Live</a></>
        : <>{view}{history}</>;
    case "draft":
      return c.type === "article"
        ? <>{history}<Link className="ap-btn" href={`/dashboard/content/${c.id}`}><Pencil size={13} /> Continue</Link></>
        : <>{history}<button className="ap-btn" onClick={onReview}><Pencil size={13} /> Continue</button></>;
    default:
      return <>{view}{history}</>;
  }
}

/** The pictures made for one article, each shown with the heading it was made for
 *  (MASTER_PLAN §19.4.7). The heading is the point of the review: it is how a reader checks
 *  the promise that an image belongs to its own paragraph rather than being decoration.
 *
 *  A card (a section that explains a map, a chart or a set of steps) says so — those are drawn
 *  from the section's own words on purpose, because an image model would draw a convincing
 *  wrong map (§19.4.3). Each picture can be redone on its own; the others are left alone. */
const SLOT_LABEL = (slot: string) =>
  slot === "thumb" ? "Thumbnail" : slot === "hero" ? "Hero image" : slot === "og" ? "Social preview"
  : slot.startsWith("inline") ? `Inline image ${slot.replace(/\D+/g, "")}`.trim() : slot.replace(/_/g, " ");

function ImageSetPreview({ c, onUpdated }: { c: ContentItem; onUpdated: (item: ContentItem) => void }) {
  const { toast } = useStore();
  // slot -> the address it had when the new one was asked for; the new picture has arrived the
  // moment the slot's address differs.
  const [waiting, setWaiting] = useState<Record<string, string>>({});
  const [undoing, setUndoing] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ url: string; alt: string } | null>(null);
  const images = c.meta?.images ?? [];
  const articleId = c.blueprint?.parent_article_id ?? null;
  // A picture asked for on its own ("ek image banao") belongs to no article: redoing it means
  // asking for the same subject again, not re-running an article's plan.
  const standalone = (c.meta as any)?.standalone === true;
  const subject = String((c.meta as any)?.subject ?? "");

  const redo = async (slot: string, currentUrl: string) => {
    if (!articleId && !standalone) return;
    setWaiting((w) => ({ ...w, [slot]: currentUrl }));
    try {
      const res = await fetch("/api/agents/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(standalone ? { type: "image", subject, bump: 1, source: "manual" } : { type: "image", articleId, slot, bump: 1, source: "manual" }),
      });
      const d = await res.json();
      if (!d.ok) {
        setWaiting((w) => { const x = { ...w }; delete x[slot]; return x; });
        toast(d.error || "Couldn't start that.", "error");
      }
    } catch {
      setWaiting((w) => { const x = { ...w }; delete x[slot]; return x; });
      toast("Couldn't start that: network error.", "error");
    }
  };

  // The job is queued, not finished. Watch the card and swap the picture in the moment it lands,
  // with no refresh; give up quietly after two minutes.
  useEffect(() => {
    const slots = Object.keys(waiting);
    if (!slots.length) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const d = await fetch(`/api/content/${c.id}`).then((r) => r.json());
        if (d?.ok) {
          const imgs: any[] = d.item?.meta?.images ?? [];
          const done = slots.filter((sl) => { const im = imgs.find((i) => i.slot === sl); return !!im && im.url !== waiting[sl]; });
          if (done.length) {
            onUpdated(d.item);
            setWaiting((w) => { const x = { ...w }; done.forEach((sl) => delete x[sl]); return x; });
            toast("New picture is in. You can undo it until you approve.");
          }
        }
      } catch { /* try again on the next tick */ }
      if (tries >= 40) { setWaiting({}); toast("Still working on it. Reopen this in a minute.", "error"); }
    }, 3000);
    return () => clearInterval(timer);
  }, [waiting, c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = async (slot: string) => {
    setUndoing(slot);
    try {
      const res = await fetch(`/api/content/${c.id}/image-undo`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot }),
      });
      const d = await res.json();
      if (!d.ok) { toast(d.error || "Couldn't undo that.", "error"); return; }
      const fresh = await fetch(`/api/content/${c.id}`).then((r) => r.json());
      if (fresh?.ok) onUpdated(fresh.item);
      toast("The earlier picture is back, everywhere it was used.");
    } catch {
      toast("Couldn't undo that: network error.", "error");
    } finally {
      setUndoing(null);
    }
  };

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  if (!images.length) {
    return <div className="ap-card p-4"><p className="lx-11 lx-mut">No pictures on this item yet.</p></div>;
  }

  const hasPrev = images.some((i: any) => i.previous?.url);
  return (
    <div className="space-y-3">
      {hasPrev && (
        <p className="ap-note">A picture you replaced keeps its earlier version until you approve. Approve to delete it for good, or Undo to bring it back.</p>
      )}
      {images.map((img: any) => {
        const isWaiting = img.slot in waiting;
        const ratio = img.width && img.height ? `${img.width} / ${img.height}` : "16 / 9";
        return (
          <figure key={img.slot} className="ap-img">
            <button type="button" className="ap-img-frame" style={{ aspectRatio: ratio }} onClick={() => setZoom({ url: img.url, alt: img.alt })} aria-label={`Enlarge ${SLOT_LABEL(img.slot)}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt} loading="lazy" />
              {img.previous && !isWaiting && <span className="ap-img-tag">New version</span>}
              {isWaiting && <span className="ap-img-busy"><Loader2 size={15} className="ap-spin" /> Making a new version…</span>}
            </button>
            <figcaption className="ap-img-cap">
              <div className="flex items-center justify-between gap-2">
                <span className="ap-img-name">{SLOT_LABEL(img.slot)}</span>
                <a href={img.url} target="_blank" rel="noopener" className="ap-openlink" style={{ marginLeft: 0 }}>Open <ExternalLink size={11} /></a>
              </div>
              {img.anchor && <p className="ap-img-sub">Under: <b>{img.anchor}</b></p>}
              {img.provider === "template" && <p className="ap-img-sub">A branded card. No picture could be made for this slot.</p>}
              <p className="ap-img-alt">{img.alt}</p>
              {(articleId || standalone) && (
                <div className="ap-img-actions">
                  <button className="ap-btn" disabled={isWaiting || undoing === img.slot} onClick={() => redo(img.slot, img.url)}>
                    <RefreshCw size={13} className={isWaiting ? "ap-spin" : ""} /> {isWaiting ? "Making…" : "Another image"}
                  </button>
                  {img.previous?.url && (
                    <button className="ap-btn" disabled={isWaiting || undoing === img.slot} onClick={() => undo(img.slot)} title="Bring the earlier picture back">
                      {undoing === img.slot ? <Loader2 size={13} className="ap-spin" /> : <Undo2 size={13} />} Undo
                    </button>
                  )}
                </div>
              )}
            </figcaption>
          </figure>
        );
      })}
      {zoom && (
        <div className="ap-zoom" onClick={() => setZoom(null)} role="dialog" aria-label="Picture">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.url} alt={zoom.alt} onClick={(e) => e.stopPropagation()} />
          <button className="ap-zoom-x" onClick={() => setZoom(null)} aria-label="Close"><X size={18} /></button>
        </div>
      )}
    </div>
  );
}

/** The story as the reader will swipe through it: the pages in order, cover first, at the
 *  shape a phone gives them (MASTER_PLAN §19.4.5). The AMP verdict is shown plainly, because
 *  an invalid Web Story gets no place in Discover's carousel and the carousel is the whole
 *  reason to make one — "we made it" and "Google will show it" are different claims. */
function WebStoryPreview({ c }: { c: ContentItem }) {
  const pages = c.meta?.pages ?? [];
  const valid = (c.meta as any)?.ampValid === true;
  const checkedBy = String((c.meta as any)?.ampCheckedBy ?? "");
  const errors: string[] = Array.isArray((c.meta as any)?.ampErrors) ? (c.meta as any).ampErrors : [];

  return (
    <div className="ap-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="lx-10 rounded-full px-2 py-0.5 font-semibold" style={{ border: `1px solid ${valid ? "rgba(74,222,128,.5)" : "rgba(248,113,113,.5)"}`, color: valid ? "var(--lx-green)" : "#f87171" }}>
          {valid ? "Valid AMP" : "Not valid AMP yet"}
        </span>
        <span className="lx-10 lx-mut">
          {checkedBy === "amphtml-validator"
            ? "checked with Google's own validator"
            : "structural checks only — the validator's ruleset could not be fetched"}
        </span>
        <span className="lx-10 lx-mut ml-auto">{pages.length} pages</span>
      </div>

      {!valid && errors.length > 0 && (
        <ul className="mt-2 space-y-1 pl-4" style={{ listStyle: "disc" }}>
          {errors.map((e, i) => <li key={i} className="lx-10" style={{ color: "#f87171" }}>{e}</li>)}
        </ul>
      )}

      <div className="lx-scroll mt-3 flex gap-3 overflow-x-auto pb-2">
        {pages.map((p, i) => (
          <figure key={i} className="m-0 shrink-0 rounded-lg" style={{ width: 150, border: "1px solid var(--lx-border)", overflow: "hidden", background: "var(--lx-card)" }}>
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.image} alt={p.headline} loading="lazy" style={{ display: "block", width: "100%", aspectRatio: "9 / 16", objectFit: "cover" }} />
            ) : (
              <div style={{ width: "100%", aspectRatio: "9 / 16", background: "var(--lx-in)" }} />
            )}
            <figcaption className="p-2">
              <span className="lx-10 lx-mut">{i === 0 ? "Cover" : `Page ${i + 1}`}</span>
              <p className="lx-10 mt-0.5" style={{ color: "var(--lx-text)", lineHeight: 1.4 }}>{p.headline}</p>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="lx-10 lx-mut mt-2">The cover is the only page Google Discover shows in its carousel.</p>
    </div>
  );
}

function Drawer({ c, loading, busy, tab, setTab, onClose, onApprove, onReject, onCopy, kids, onOpenKid, parent, onOpenParent, onItemUpdated }: {
  onItemUpdated: (item: ContentItem) => void; kids: ContentItem[]; onOpenKid: (k: ContentItem) => void; parent: ContentItem | null; onOpenParent: (p: ContentItem) => void;
  c: ContentItem; loading: boolean; busy: boolean; tab: "details" | "preview" | "history";
  setTab: (t: "details" | "preview" | "history") => void; onClose: () => void; onApprove: () => void; onReject: () => void; onCopy: () => void;
}) {
  const st = statusOf(c.status);
  const tile = tileOf(c.type);
  const events = useMemo(() => historyOf(c), [c]);
  const pending = c.status === "awaiting_approval";
  const copyOnly = c.type === "social" && !!c.meta?.copyOnly;
  const approveLabel = copyOnly ? "Mark ready" : c.type === "article" || kids.length ? "Approve & publish" : "Approve";
  const hint = kids.length
    ? `Publishes the article together with its ${kids.map((k) => (TYPE_LABEL[k.type] ?? k.type).toLowerCase()).join(" and ")}.`
    : c.type === "article" ? "Publishes this article to your connected site."
    : copyOnly ? "Marks it ready to copy. Nothing is posted anywhere."
    : "Approves this item.";
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
              {c.type === "article" && (
                <Link href={`/dashboard/content/${c.id}`} target="_blank" rel="noopener" className="ap-openlink">
                  Open full article <ExternalLink size={11} />
                </Link>
              )}
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
              <Field label="Current Version"><span className="lx-12" style={{ color: "var(--lx-text)" }}>{versionOf(c)}</span></Field>
              <Field label="Created by"><span className="flex items-center gap-2 lx-11"><span className="ap-avatar"><UserRound size={12} /></span>{agentOf(c)}</span></Field>
              <Field label="Word Count"><span className="lx-12" style={{ color: "var(--lx-text)" }}>{typeof c.meta?.wordCount === "number" ? c.meta.wordCount.toLocaleString() : "not recorded"}</span></Field>
              <Field label="Created"><span className="flex items-center gap-1.5 lx-11"><Calendar size={13} className="lx-mut" />{fmtBoth(c.created_at)}</span></Field>
              <Field label="Last Updated"><span className="flex items-center gap-1.5 lx-11"><Calendar size={13} className="lx-mut" />{fmtBoth(c.updated_at ?? c.created_at)}</span></Field>
              <Field label="Type"><span className="lx-pill blue">{TYPE_LABEL[c.type] ?? c.type}</span></Field>
              <Field label="Category"><span className="lx-pill purple">{categoryOf(c)}</span></Field>
              {c.meta?.publishedUrl && (
                <Field label="Live URL" wide>
                  <a href={c.meta.publishedUrl} target="_blank" rel="noreferrer" className="lx-11 truncate block" style={{ color: "var(--lx-blue)" }}>{c.meta.publishedUrl}</a>
                </Field>
              )}
              {c.meta?.publishError && (
                <Field label="Publish error" wide><span className="lx-11" style={{ color: "#f87171" }}>{c.meta.publishError}</span></Field>
              )}
            </div>
            {(kids.length > 0 || parent) && (
              <div className="ap-card mt-3 p-4">
                <h3 className="ap-h3">{parent ? "Part of an article" : "Included with this article"}</h3>
                <p className="lx-10 lx-mut mt-1">
                  {parent ? "Approve or reject the article and this goes with it." : "Approving or rejecting the article decides all of these at once."}
                </p>
                <div className="mt-3 space-y-2">
                  {(parent ? [parent] : kids).map((k) => (
                    <button key={k.id} className="ap-part" onClick={() => (parent ? onOpenParent(k) : onOpenKid(k))}>
                      <Tile tile={tileOf(k.type)} size={30} />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="ap-part-t">{TYPE_LABEL[k.type] ?? k.type}</span>
                        <span className="lx-10 lx-mut block truncate">{k.type === "image_set" && k.meta?.images?.length ? `${k.meta.images.length} pictures` : k.title || "Untitled"}</span>
                      </span>
                      <StatusPill s={k.status} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="ap-card mt-3 p-4">
              <h3 className="ap-h3">Review History</h3>
              <Timeline events={events} />
            </div>
          </>
        )}

        {tab === "preview" && c.type === "image_set" && (
          <ImageSetPreview c={c} onUpdated={onItemUpdated} />
        )}

        {tab === "preview" && c.type === "web_story" && (
          <WebStoryPreview c={c} />
        )}

        {tab === "preview" && c.type !== "image_set" && c.type !== "web_story" && (
          <div className="ap-card p-4">
            {loading && typeof c.body !== "string" ? (
              <div className="flex items-center gap-2 lx-11 lx-mut"><Loader2 size={14} className="ap-spin" /> Loading content…</div>
            ) : !c.body ? (
              <p className="lx-11 lx-mut">This item has no body text yet.</p>
            ) : c.type === "article" ? (
              <div className="ap-prose" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            ) : (
              <>
                <p className="lx-11" style={{ whiteSpace: "pre-wrap", margin: 0, color: "var(--lx-text)", lineHeight: 1.6 }}>{c.body}</p>
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

      {/* decision bar */}
      <div className="ap-foot">
        {pending ? (
          <>
            <p className="ap-foot-hint">{hint}</p>
            <div className="ap-foot-btns">
              <button className="ap-reject" disabled={busy} onClick={onReject}><X size={15} /> Reject</button>
              <button className="lx-grad ap-approve" disabled={busy} onClick={onApprove}>
                {busy ? <Loader2 size={15} className="ap-spin" /> : <Check size={15} />} {approveLabel}
              </button>
            </div>
          </>
        ) : (
          <p className="ap-foot-hint ap-foot-state">This item is <b>{st.label.toLowerCase()}</b>, so there is nothing left to decide.</p>
        )}
        {c.type !== "article" && (
          <button className="ap-changes" onClick={onCopy}><Copy size={14} /> Copy text</button>
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
          <div className="lx-11 mt-0.5" style={{ color: "var(--lx-text)" }}>{e.title}</div>
          {e.detail && <div className="lx-10 lx-mut mt-0.5 break-words">{e.detail}</div>}
          <div className="lx-10 lx-mut mt-0.5">{e.who === "You" ? "Reviewer: You" : e.who}</div>
        </div>
      ))}
    </div>
  );
}

/* ---- page-local CSS (colours/spacing measured off the reference mockup) ------------------ */
const CSS = `
.ap-root{--ap-s1:rgba(255,255,255,.05);--ap-s2:rgba(255,255,255,.1);--ap-s3:rgba(255,255,255,.18)}
.light .ap-root{--ap-s1:rgba(22,32,60,.05);--ap-s2:rgba(22,32,60,.1);--ap-s3:rgba(22,32,60,.18)}
/* light theme: translucent dark-mode accents need a deeper ink to stay readable on white */
.light .ap-root .ap-status{filter:brightness(.6) saturate(1.35)}
.light .ap-root .ap-reject{color:#c0283f}
.light .ap-root .ap-act-b{color:#0e7490}
.light .ap-root .ap-panel,.light .ap-root .ap-card,.light .ap-root .ap-row{box-shadow:0 1px 2px rgba(22,32,60,.06)}
.light .ap-root .ap-drawer{box-shadow:0 20px 60px rgba(22,32,60,.22)}
.ap-kids{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.ap-kid{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:10.5px;font-weight:600;cursor:pointer;
  color:var(--lx-mut);background:var(--ap-s1);border:1px solid var(--lx-border);transition:.15s}
.ap-kid:hover{color:var(--lx-text);border-color:rgba(139,92,246,.55)}
.ap-part{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:10px;cursor:pointer;
  background:var(--ap-s1);border:1px solid var(--lx-border);transition:.15s;color:var(--lx-text)}
.ap-part:hover{border-color:rgba(139,92,246,.55)}
.ap-part-t{display:block;font-size:12.5px;font-weight:600}
.ap-panel{background:var(--lx-panel);border:1px solid var(--lx-border);border-radius:16px}
/* the centre column is sized by the CONTAINER (drawer open = ~540px even on a 1366px screen),
   so every breakpoint below is a container query, never a viewport one */
.ap-main{container-type:inline-size;container-name:ap}
.ap-hdr-search{display:none}
@container ap (min-width:760px){.ap-hdr-search{display:flex}}
.ap-drawer{display:flex;flex-direction:column;width:min(92vw,400px);flex-shrink:0;position:fixed;top:12px;right:12px;bottom:12px;z-index:50;
  box-shadow:0 20px 60px rgba(0,0,0,.6)}
@media (min-width:1280px){.ap-drawer{position:relative;top:auto;right:auto;bottom:auto;height:100%;z-index:auto;box-shadow:none}}
.ap-h1{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.ap-h2{font-size:15px;font-weight:700;line-height:1.3;color:var(--lx-text);min-width:0}
.ap-h3{font-size:14px;font-weight:700;color:var(--lx-text)}
.ap-search{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:9px;
  background:var(--lx-card);border:1px solid var(--lx-border);transition:border-color .15s}
.ap-search:focus-within{border-color:rgba(139,92,246,.55)}
.ap-search input{flex:1;min-width:0;background:none;border:none;outline:none;color:var(--lx-text);font-size:12px}
.ap-search input::placeholder{color:var(--lx-dim)}
.ap-icobtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;
  border:1px solid var(--lx-border);background:var(--lx-card);color:var(--lx-mut);cursor:pointer;transition:.15s;flex-shrink:0}
.ap-icobtn:hover,.ap-icobtn.on{color:var(--lx-text);border-color:rgba(139,92,246,.55)}
.ap-create{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:9px;font-size:12.5px;font-weight:600;white-space:nowrap}
@container ap (max-width:560px){.ap-create-t{display:none}.ap-create{padding:0 10px}}
.ap-dot{position:absolute;top:8px;right:8px;width:6px;height:6px;border-radius:50%;background:#8b5cf6;box-shadow:0 0 6px #8b5cf6}
.ap-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px}
.ap-stat{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;min-width:0;
  background:color-mix(in srgb,var(--c) 9%,var(--lx-card));border:1px solid color-mix(in srgb,var(--c) 40%,transparent);
  box-shadow:inset 0 0 30px color-mix(in srgb,var(--c) 5%,transparent)}
.ap-stat-ico{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;flex-shrink:0;
  color:var(--c);background:color-mix(in srgb,var(--c) 14%,var(--lx-card));border:1px solid color-mix(in srgb,var(--c) 45%,transparent);
  box-shadow:0 0 14px color-mix(in srgb,var(--c) 30%,transparent)}
.ap-stat-n{font-size:19px;font-weight:800;line-height:1;color:var(--lx-text)}
.ap-stat .lx-10{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-select{position:relative;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 8px 0 10px;border-radius:9px;
  background:var(--lx-card);border:1px solid var(--lx-border);color:var(--lx-text);font-size:12px;cursor:pointer}
.ap-select:hover{border-color:rgba(139,92,246,.45)}
.ap-select select{appearance:none;-webkit-appearance:none;background:none;border:none;outline:none;color:inherit;font:inherit;
  padding-right:2px;cursor:pointer}
.ap-select select option{background:var(--lx-in);color:var(--lx-text)}
.ap-grid{display:grid;grid-template-columns:minmax(0,1fr) 108px 96px 232px;grid-template-areas:"a s u x";align-items:center;gap:14px}
.ap-c-a{grid-area:a;min-width:0}.ap-c-s{grid-area:s;justify-self:start}.ap-c-u{grid-area:u}.ap-c-x{grid-area:x;justify-self:end}
/* row actions are icon-only squares: the row stays compact, the label is the tooltip */
.ap-act{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border-radius:8px;
  background:var(--lx-in);border:1px solid var(--lx-border);color:var(--lx-mut);cursor:pointer;transition:.15s}
.ap-act:hover{color:var(--lx-text);border-color:var(--ap-s3);background:var(--lx-in)}
.ap-act-b{color:#7dd3fc;background:rgba(56,189,248,.09);border-color:rgba(56,189,248,.32)}
.ap-act-b:hover{color:var(--lx-text);background:rgba(56,189,248,.2);border-color:rgba(56,189,248,.6)}
.ap-act-p{color:#fff;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-color:rgba(139,92,246,.65);
  box-shadow:0 2px 10px rgba(124,58,237,.3)}
.ap-act-p:hover{color:#fff;filter:brightness(1.1)}
.ap-inline-date{display:none}
.ap-live{display:inline-flex;align-items:center;gap:4px;max-width:100%;margin-top:3px;font-size:11px;color:var(--lx-green);text-decoration:none}
.ap-live:hover{text-decoration:underline}
@container ap (max-width:980px){
  /* narrow: the status pill moves into the meta line and the date with it, so the TITLE gets the
     whole width left over after the two buttons */
  .ap-grid{grid-template-columns:minmax(0,1fr) 232px;grid-template-areas:"a x";gap:12px}
  .ap-c-s{display:none}
  .ap-c-u{display:none}
  .ap-inline-date{display:inline}
  .ap-inline-status{display:inline-flex}
}
.ap-inline-status{display:none}
@container ap (max-width:620px){
  .ap-grid{grid-template-columns:minmax(0,1fr) max-content;grid-template-areas:"a a" "s x";row-gap:10px}
  .ap-head{display:none}
  .ap-c-s{justify-self:start}
  .ap-c-u{display:none}
  .ap-inline-date{display:inline}
}
@container ap (max-width:620px){
  /* phone: titles wrap to two lines, filters become a tidy two-up grid, nothing is cut off */
  .ap-c-s{display:block}
  .ap-inline-status{display:none}
  .ap-btn{min-width:72px;padding:0 8px}
  .ap-title{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .ap-tip{display:none}
  .ap-meta{white-space:normal;flex-wrap:wrap;row-gap:4px}
  .ap-row{padding:12px 14px}
  .ap-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ap-stat:last-child:nth-child(odd){grid-column:1/-1}
  .ap-search-main{flex:1 1 100%}
  .ap-c-x{justify-self:end}
  .ap-act-0{display:none}
  .ap-todo{order:3}
  .ap-select{flex:1 1 calc(50% - 8px);min-width:0}
  .ap-select select{width:100%;min-width:0}
  .ap-pager button{min-width:36px;height:36px}
  .ap-act,.ap-kebab,.ap-icobtn{min-width:36px;min-height:36px}
}
.ap-hdr{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:16px 16px 12px;border-bottom:1px solid var(--lx-border)}
.ap-todo{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;
  color:#f59e0b;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);white-space:nowrap}
.ap-todo:hover{background:rgba(245,158,11,.18)}
.ap-todo-dot{width:7px;height:7px;border-radius:50%;background:#f59e0b;box-shadow:0 0 8px #f59e0b}
.light .ap-root .ap-todo{color:#a16207}
.ap-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-top:12px;border-top:1px solid var(--lx-border)}
.ap-search-main{flex:1 1 240px;min-width:0;height:36px}
.ap-toolbar .ap-select{height:36px}
.ap-x{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;border:none;background:var(--ap-s1);color:var(--lx-mut);cursor:pointer}
.ap-x:hover{color:var(--lx-text)}
.ap-status{font-size:10px!important;line-height:1.3;padding:2px 8px!important;gap:5px!important;font-weight:600!important}
.ap-status i{width:5px!important;height:5px!important}
.ap-skel{height:74px;border-radius:12px;border:1px solid var(--lx-border);
  background:linear-gradient(90deg,var(--ap-s1) 25%,var(--ap-s2) 50%,var(--ap-s1) 75%);background-size:200% 100%;animation:apShim 1.3s linear infinite}
@keyframes apShim{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.ap-skel{animation:none}}
.ap-btn-ok{color:#fff;background:linear-gradient(135deg,#16a34a,#15803d);border-color:rgba(34,197,94,.7);box-shadow:0 2px 10px rgba(22,163,74,.3)}
.ap-btn-ok:hover{filter:brightness(1.08);border-color:rgba(34,197,94,.95)}
.ap-note{margin:0;padding:10px 12px;border-radius:10px;font-size:11.5px;line-height:1.45;color:var(--lx-mut);
  background:var(--ap-s1);border:1px solid var(--lx-border)}
.ap-img{margin:0;border-radius:12px;overflow:hidden;background:var(--lx-card);border:1px solid var(--lx-border)}
.ap-img-frame{position:relative;display:block;width:100%;padding:0;border:none;cursor:zoom-in;background:var(--ap-s1);overflow:hidden}
.ap-img-frame img{display:block;width:100%;height:100%;object-fit:cover}
.ap-img-tag{position:absolute;top:10px;left:10px;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:700;color:#fff;
  background:linear-gradient(135deg,#4f46e5,#7c3aed);box-shadow:0 2px 8px rgba(0,0,0,.35)}
.ap-img-busy{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;font-size:12.5px;font-weight:600;color:#fff;
  background:rgba(8,8,16,.62);backdrop-filter:blur(2px)}
.ap-img-cap{padding:12px 14px 14px;display:grid;gap:6px}
.ap-img-name{font-size:13px;font-weight:700;color:var(--lx-text)}
.ap-img-sub{margin:0;font-size:11.5px;color:var(--lx-mut)}
.ap-img-sub b{color:var(--lx-text);font-weight:600}
.ap-img-alt{margin:0;font-size:11.5px;line-height:1.5;color:var(--lx-mut);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.ap-img-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.ap-img-actions .ap-btn{min-width:0;padding:0 12px}
.ap-btn:disabled{opacity:.55;cursor:not-allowed}
.ap-zoom{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.86);cursor:zoom-out}
.ap-zoom img{max-width:94vw;max-height:90vh;object-fit:contain;border-radius:10px;cursor:default}
.ap-zoom-x{position:absolute;top:16px;right:16px;width:38px;height:38px;border-radius:50%;border:none;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;
  display:flex;align-items:center;justify-content:center}
.ap-clear{display:inline-flex;align-items:center;gap:5px;height:36px;padding:0 10px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;
  color:var(--lx-mut);background:none;border:1px dashed var(--lx-border)}
.ap-clear:hover{color:var(--lx-text);border-color:var(--ap-s3)}
button.ap-stat{cursor:pointer;text-align:left;font:inherit;color:inherit;transition:border-color .15s,transform .1s}
button.ap-stat:hover{border-color:color-mix(in srgb,var(--c) 70%,transparent)}
button.ap-stat:active{transform:scale(.98)}
button.ap-stat.on{border-color:var(--c);box-shadow:0 0 0 1px var(--c),inset 0 0 30px color-mix(in srgb,var(--c) 10%,transparent)}
.ap-c-x{display:flex;align-items:center;justify-content:flex-end;gap:6px;position:relative}
.ap-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:84px;height:30px;padding:0 10px;border-radius:8px;
  font-size:12px;font-weight:600;white-space:nowrap;text-decoration:none;cursor:pointer;
  color:var(--lx-text);background:var(--lx-in);border:1px solid var(--lx-border);transition:.15s}
.ap-btn:hover{border-color:var(--ap-s3)}
.ap-btn-p{color:#fff;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-color:rgba(139,92,246,.65);box-shadow:0 2px 10px rgba(124,58,237,.3)}
.ap-btn-p:hover{filter:brightness(1.1);border-color:rgba(139,92,246,.9)}
.ap-act-0{visibility:hidden}
.ap-head{padding:0 18px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--lx-mut)}
.ap-row{background:var(--lx-card);border:1px solid var(--lx-border);border-radius:12px;padding:16px 18px;cursor:pointer;
  transition:border-color .15s,background .15s;display:grid;position:relative}
.ap-row:hover{border-color:var(--ap-s2);background:var(--lx-card2);z-index:5}
.ap-row.on{border-color:rgba(139,92,246,.5);box-shadow:0 0 0 1px rgba(139,92,246,.2),0 0 22px rgba(139,92,246,.12)}
.ap-title-wrap{position:relative;min-width:0}
.ap-title{font-size:13.5px;font-weight:600;color:var(--lx-text);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* full title on hover — a real tooltip, not the browser's slow native one */
.ap-tip{position:absolute;left:0;top:calc(100% + 6px);z-index:40;max-width:min(460px,70vw);width:max-content;padding:8px 10px;border-radius:9px;
  background:var(--lx-in);border:1px solid var(--ap-s2);box-shadow:0 12px 32px rgba(0,0,0,.6);
  color:#f2f2f7;font-size:12.5px;font-weight:500;line-height:1.45;white-space:normal;
  opacity:0;pointer-events:none;transform:translateY(-3px);transition:opacity .15s,transform .15s;transition-delay:0s}
.ap-title-wrap:hover .ap-tip{opacity:1;transform:translateY(0);transition-delay:.3s}
.ap-sep{width:3px;height:3px;border-radius:50%;background:var(--lx-dim);flex-shrink:0}
.ap-primary{padding:6px 12px;font-size:12px;border-radius:9px;gap:6px}
.ap-kebab{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;
  background:none;border:none;color:var(--lx-mut);cursor:pointer;transition:.15s}
.ap-kebab:hover{color:var(--lx-text);background:var(--ap-s1)}
.ap-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;min-width:190px;padding:6px;border-radius:12px;
  background:var(--lx-in);border:1px solid var(--ap-s2);box-shadow:0 12px 32px rgba(0,0,0,.55)}
.ap-menu>*{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border-radius:8px;border:none;background:none;
  color:var(--lx-text);font-size:12.5px;cursor:pointer;text-align:left}
.ap-menu>*:hover{background:var(--ap-s1);color:var(--lx-text)}
.ap-menu>*:disabled{opacity:.5;cursor:not-allowed}
.ap-menu>.danger{color:#f87171}
.ap-pager{display:flex;align-items:center;gap:6px}
.ap-pager button{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:32px;padding:0 8px;border-radius:9px;
  border:1px solid var(--lx-border);background:var(--lx-card);color:var(--lx-text);font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.ap-pager button:hover:not(:disabled){border-color:rgba(139,92,246,.5);color:var(--lx-text)}
.ap-pager button:disabled{opacity:.35;cursor:not-allowed}
.ap-pager button.on{background:linear-gradient(135deg,#4f46e5,#7c3aed);border-color:rgba(139,92,246,.7);color:#fff;
  box-shadow:0 4px 16px rgba(124,58,237,.35)}
.ap-close{position:absolute;top:16px;right:14px;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
  border-radius:8px;border:none;background:none;color:var(--lx-mut);cursor:pointer}
.ap-close:hover{color:var(--lx-text);background:var(--ap-s1)}
@media (min-width:1280px){.ap-drawer .ap-close{right:46px}}
.ap-card{background:var(--lx-card);border:1px solid var(--lx-border);border-radius:12px}
.ap-avatar{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;
  background:var(--lx-in);border:1px solid var(--lx-border);color:var(--lx-mut)}
.ap-tl{position:relative;padding-left:18px}
.ap-tl::before{content:"";position:absolute;left:5px;top:6px;bottom:6px;width:1px;background:var(--ap-s1)}
.ap-tl-item{position:relative;padding-bottom:16px}
.ap-tl-item:last-child{padding-bottom:0}
.ap-tl-dot{position:absolute;left:-18px;top:3px;width:11px;height:11px;border-radius:50%;background:var(--lx-card);
  border:2px solid var(--c);box-shadow:0 0 8px color-mix(in srgb,var(--c) 70%,transparent)}
.ap-foot{padding:12px 16px 16px;border-top:1px solid var(--lx-border);display:grid;gap:10px}
.ap-foot-hint{margin:0;font-size:11.5px;line-height:1.45;color:var(--lx-mut)}
.ap-foot-state b{color:var(--lx-text);font-weight:600}
.ap-foot-btns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.7fr);gap:10px}
.ap-openlink{margin-left:auto;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-size:11px;font-weight:600;
  color:var(--lx-blue);text-decoration:none}
.ap-openlink:hover{text-decoration:underline}
.ap-reject{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;border-radius:11px;font-size:13.5px;font-weight:600;
  color:#f87171;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.45);cursor:pointer;transition:.15s}
.ap-reject:hover:not(:disabled){background:rgba(239,68,68,.16)}
.ap-approve{height:42px;font-size:13.5px;border-radius:11px}
.ap-reject:disabled,.ap-approve:disabled{opacity:.4;cursor:not-allowed;filter:none}
.ap-changes{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border-radius:12px;font-size:14px;font-weight:600;
  color:var(--lx-text);background:var(--ap-s1);border:1px solid var(--lx-border);cursor:pointer;transition:.15s}
.ap-changes:hover{border-color:rgba(139,92,246,.55);color:var(--lx-text)}
.ap-spin{animation:apSpin 1s linear infinite}
@keyframes apSpin{to{transform:rotate(360deg)}}
.ap-prose{font-size:13px;line-height:1.7;color:var(--lx-text)}
.ap-prose h1{font-size:18px;font-weight:800;color:var(--lx-text);margin:0 0 12px}
.ap-prose h2{font-size:15px;font-weight:700;color:var(--lx-text);margin:18px 0 8px}
.ap-prose h3{font-size:13.5px;font-weight:700;color:var(--lx-text);margin:14px 0 6px}
.ap-prose p{margin:0 0 10px}
.ap-prose ul,.ap-prose ol{padding-left:18px;margin:0 0 10px}
.ap-prose a{color:var(--lx-blue)}
.ap-prose img{max-width:100%;border-radius:8px}
`;
