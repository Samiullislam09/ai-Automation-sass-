"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Bell, CheckCircle2, ChevronDown, Copy, ExternalLink, Eye,
  Lock, MinusCircle, MoreVertical, Pencil, RotateCw, Send, Sparkles, X, XCircle,
} from "lucide-react";
import { renderMarkdown } from "@/lib/md";
import { useStore } from "@/lib/store";

/** /dashboard/content/[id] — "Article Approval", rebuilt 2026-09-04 to match the owner's
 *  reference mockup (Downloads/artical read for approved page.png) 1:1: dashboard sidebar shell,
 *  "Article Approval" page header with Back to Content, the article toolbar (title + edit pencil,
 *  status dot, Previous / Next / More Actions), the browser-chrome article preview, the review
 *  bar (comment + Change Status + Approve & Publish, then Request Changes / Reject) and the
 *  right rail (Article Details + AI Assistant SEO score).
 *
 *  Same real actions as before, kept verbatim — save / approve / publish / reject / AI-revise
 *  through the same /api/content/[id]/** routes. Only the chrome changed.
 *
 *  IT NOW LIVES INSIDE THE DASHBOARD SHELL. It used to render full-screen with its own
 *  `.lx-root` + <LxGlobalStyle/> (owner's call, 2026-08-29). The 2026-09-04 mockup shows the
 *  left nav on this page, so app/dashboard/content/[id]/page.tsx wraps it in <MrLxwaDashboard>
 *  and the theme/root now come from that shell instead of being mounted twice.
 *
 *  The article preview itself (hero + body, inside the browser-chrome mock) is WHITE with dark
 *  text — a real published page is not dark-mode, and the reference mockup shows exactly that;
 *  only the surrounding review chrome stays the app's own dark theme.
 *
 *  WHAT'S REAL vs WHAT'S NOT — owner decisions from 2026-08-29, unchanged:
 *   - Hero photo: the reference has a stock house photo. Mr. Image (the agent that would
 *     generate one per article) isn't built yet, so this page shows NO photo — a plain
 *     gradient block with the real title/meta text instead. Never a fake stock image.
 *   - The mockup's site header inside the preview (client logo + nav) is the customer's own
 *     live site chrome; we render the article only, since we don't host their template.
 *   - Tags / "Assigned By": real (`meta.relatedKeywords`, `meta.chosenBy` — written by
 *     agent-server/src/agents/writer.ts since 2026-08-29). Older rows say "not recorded".
 *   - Category: derived at read time from the Site Brain's topic clusters (GET /api/site-brain)
 *     by nearest keyword-token overlap — the port of agent-server's nearestCluster() below.
 *   - SEO Score + the 5-item checklist: Mr. SEO's own ~22 deterministic checks
 *     (agent-server/src/lib/seoChecks.ts), grouped — not a second, invented score.
 *   - The header bell's count is the tenant's real awaiting_approval total (same list this page
 *     already loads for Previous/Next), and links to Approvals.
 *   - Link Preview: the real published URL once live (`meta.publishedUrl`), or the staged path
 *     from the real slug beforehand, labelled "will publish to" so it's never read as live.
 */

type QualityGate = { score: number; passed: boolean; wordCount: number; sections: number; links: number };
type SeoCheck = { id: string; label: string; ok: boolean; severity: "block" | "warn" | "info"; detail: string; fix: string | null };
type SeoIssue = { id: string; severity: "block" | "warn" | "info"; what: string; fix: string };
type SeoMeta = { score: number; passed: boolean; issues: SeoIssue[]; checks?: SeoCheck[]; serpCompared: boolean; checkedAt: string };

type Item = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  body: string | null;
  primary_keyword: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
  meta: {
    wordCount?: number;
    sections?: number;
    links?: number;
    qualityGate?: QualityGate;
    metaTitle?: string;
    metaDescription?: string;
    slug?: string;
    seo?: SeoMeta;
    seoScore?: number;
    publishedUrl?: string | null;
    relatedKeywords?: string[];
    chosenBy?: "user" | "auto" | null;
    editedByHuman?: boolean;
  } | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting_approval: "Ready for Review",
  approved: "Approved",
  published: "Published",
  failed: "Failed the quality gate",
  rejected: "Rejected",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "#8b8ba0",
  awaiting_approval: "#4ade80",
  approved: "#60a5fa",
  published: "#4ade80",
  failed: "#f87171",
  rejected: "#f87171",
};

/** Mr. SEO's ~22 check ids, grouped into the reference's 5-item checklist. Every id below is a
 *  real check id from agent-server/src/lib/seoChecks.ts — nothing here is invented, and any id
 *  that doesn't fit one of these 5 concepts (title length, internal links, slug, schema, SERP
 *  comparison...) simply isn't summarized here; it's still in "View full SEO report". */
const SEO_CATEGORIES: { label: string; ids: string[] }[] = [
  { label: "Keyword Usage", ids: ["title-keyword", "title-keyword-position", "keyword-in-heading", "secondary-keyword-coverage", "keyword-density", "keyword-first-100"] },
  { label: "Readability", ids: ["readability-sentences", "readability-paragraphs"] },
  { label: "Meta Description", ids: ["meta-description"] },
  { label: "Heading Structure", ids: ["h1-unique", "h2-count", "heading-order"] },
  { label: "Image Optimization", ids: ["image-alt"] },
];

type CatStatus = "pass" | "issue" | "unmeasured";

function categorizeSeo(seo: SeoMeta | undefined): { label: string; status: CatStatus }[] {
  // Rows saved before 2026-08-29 only have `issues` (failures), not the full `checks` list —
  // for those, a category is "issue" if something in it failed, "unmeasured" otherwise (never
  // assumed to have passed on data we don't actually have).
  const checks: SeoCheck[] =
    seo?.checks ??
    (seo?.issues ?? []).map((i) => ({ id: i.id, label: i.id, ok: false, severity: i.severity, detail: i.what, fix: i.fix }));

  return SEO_CATEGORIES.map((cat) => {
    const relevant = checks.filter((c) => cat.ids.includes(c.id));
    const measured = relevant.filter((c) => c.severity !== "info");
    if (!measured.length) return { label: cat.label, status: "unmeasured" as const };
    return { label: cat.label, status: measured.some((c) => !c.ok) ? ("issue" as const) : ("pass" as const) };
  });
}

/** A trimmed port of agent-server's nearestCluster() — same token-overlap idea, run here
 *  because there is no API exposing it yet. Real Site Brain data in, real answer out; "no
 *  match" is Uncategorized, never a guess. */
function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}
function nearestCategory(primary: string | null, clusters: { name: string; page_urls: string[] }[]): string | null {
  if (!primary || !clusters.length) return null;
  const wanted = new Set(tokens(primary));
  let best: string | null = null;
  let bestScore = 0;
  for (const c of clusters) {
    const have = new Set(tokens(`${c.name} ${(c.page_urls ?? []).slice(0, 8).join(" ")}`));
    let score = 0;
    wanted.forEach((w) => { if (have.has(w)) score++; });
    if (score > bestScore) { bestScore = score; best = c.name; }
  }
  return bestScore > 0 ? best : null;
}

// Locale AND time zone pinned (not the environment default) — the server's Node locale/TZ and
// the browser's can format the same Date differently ("29 Aug 2026, 09:00 am" in server UTC vs
// "Aug 29, 2026, 02:30 PM" in the browser's local zone), which is a hydration mismatch on a
// component whose first paint is SSR'd. UTC everywhere beats "right for the browser, wrong for
// the server" — see MrLxwaDashboard.tsx's own blink/hydration lessons.
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export default function ArticleApprovalSection({
  item,
  editable,
  id,
  siteName,
  siteUrl,
}: {
  item: Item;
  editable: boolean;
  id: string;
  siteName: string | null;
  siteUrl: string | null;
}) {
  const { toast, confirmAction, s: account } = useStore();
  const router = useRouter();

  const [tab, setTab] = useState<"read" | "edit">("read");
  const [body, setBody] = useState(item.body ?? "");
  const [title, setTitle] = useState(item.title ?? "");
  const [savedBody, setSavedBody] = useState(item.body ?? "");
  const [savedTitle, setSavedTitle] = useState(item.title ?? "");
  const dirty = body !== savedBody || title !== savedTitle;

  const [comment, setComment] = useState("");
  const [revising, setRevising] = useState(false);
  const [busy, setBusy] = useState("");
  const [statusChoice, setStatusChoice] = useState<"approve" | "reject" | "request_changes">("approve");
  const [seoReportOpen, setSeoReportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const undoStack = useRef<string[]>([]);

  const html = useMemo(() => renderMarkdown(body), [body]);
  const meta = item.meta ?? {};
  const seo = meta.seo;
  const categories = useMemo(() => categorizeSeo(seo), [seo]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Close the More Actions menu on any outside click.
  useEffect(() => {
    if (!moreOpen) return;
    const close = () => setMoreOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [moreOpen]);

  // Prev/Next — real neighbours in this tenant's content list, not a fixed demo order. The same
  // list gives the header bell its real "waiting for you" count.
  const [neighbors, setNeighbors] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });
  const [pending, setPending] = useState(0);
  useEffect(() => {
    fetch("/api/content?status=all")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        const list: { id: string; status: string }[] = d.items ?? [];
        setPending(list.filter((it) => it.status === "awaiting_approval").length);
        const ids = list.map((it) => it.id);
        const i = ids.indexOf(id);
        if (i === -1) return;
        setNeighbors({ prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null });
      })
      .catch(() => {});
  }, [id]);

  // Category — real Site Brain topic clusters, matched client-side (see nearestCategory above).
  const [category, setCategory] = useState<string | null | "loading">("loading");
  useEffect(() => {
    fetch("/api/site-brain")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { setCategory(null); return; }
        setCategory(nearestCategory(item.primary_keyword, d.profile?.topic_clusters ?? []));
      })
      .catch(() => setCategory(null));
  }, [item.primary_keyword]);

  const revise = async (instruction: string) => {
    const text = instruction.trim();
    if (!text || revising) return;
    setRevising(true);
    try {
      const res = await fetch(`/api/content/${id}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text, body }),
      });
      const data = await res.json();
      if (!data.ok) { toast(data.error ?? "Revision failed.", "error"); return; }
      undoStack.current.push(body);
      setBody(data.body);
      setComment("");
      setTab("read");
      toast("Draft updated from your comment — review it, then Save.");
    } catch (e: any) {
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setRevising(false);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      const res = await fetch(`/api/content/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, title }),
      });
      const data = await res.json();
      if (!data.ok) { toast(data.error ?? "Save failed.", "error"); return; }
      setSavedBody(body);
      setSavedTitle(title);
      undoStack.current = [];
      toast("Saved.");
    } catch (e: any) {
      toast(`Save failed: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  const approve = async () => {
    if (dirty) { toast("Pehle changes save karo, phir publish.", "info"); return; }
    setBusy("approve");
    try {
      const res = await fetch(`/api/content/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) { toast(data.error ?? "Publish failed.", "error"); return; }
      toast(data.url ? `Published! ${data.url}` : "Published!");
      router.push("/dashboard/content");
    } catch (e: any) {
      toast(`Publish failed: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  const reject = async () => {
    const ok = await confirmAction({
      title: "Reject this article?",
      body: "It leaves the approval queue and the team treats it as feedback. This can't be undone here.",
      confirmLabel: "Reject",
      danger: true,
    });
    if (!ok) return;
    setBusy("reject");
    try {
      const res = await fetch(`/api/content/${id}/reject`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast("Rejected — the team will adjust.");
      router.push("/dashboard/content");
    } catch (e: any) {
      toast(`Reject failed: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  const runStatusChange = () => {
    if (statusChoice === "approve") return approve();
    if (statusChoice === "reject") return reject();
    if (!comment.trim()) { toast("Pehle comment likho — wahi instruction ban ke draft rewrite hoga.", "info"); return; }
    return revise(comment);
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast("Markdown copied.");
    } catch {
      toast("Copy failed — your browser blocked the clipboard.", "error");
    }
  };

  const wordCount = meta.wordCount ?? 0;
  const readMins = Math.max(1, Math.round(wordCount / 200));
  const targetKeywords = [item.primary_keyword, ...((meta.relatedKeywords ?? []).filter((k) => k !== item.primary_keyword))].filter(Boolean) as string[];
  const domain = (siteUrl ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const slug = meta.slug ?? item.slug ?? null;
  const previewUrl = meta.publishedUrl || (domain && slug ? `${domain}/${slug}` : domain || "no domain connected");
  const isLive = !!meta.publishedUrl;
  const pending_ = item.status === "awaiting_approval";

  const scoreColor = (s: number) => (s >= 75 ? "#22c55e" : s >= 50 ? "#fbbf24" : "#ef4444");
  const gaugeR = 34;
  const gaugeC = 2 * Math.PI * gaugeR;
  const userInitial = (account.user?.name || account.user?.email || "U").trim().charAt(0).toUpperCase();

  return (
    <div className="aa-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ---------------- page header ---------------- */}
      <header className="aa-head">
        <div className="min-w-0">
          <h1 className="aa-h1">Article Approval</h1>
          <p className="lx-mut mt-1" style={{ fontSize: 12.5 }}>Review, approve, and publish articles with confidence.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/dashboard/content" className="aa-btn"><ArrowLeft size={14} /> Back to Content</Link>
          <Link href="/dashboard/approvals" className="aa-ico" aria-label="Approvals" title={`${pending} waiting for review`}>
            <Bell size={16} />
            {pending > 0 && <span className="aa-badge">{pending > 9 ? "9+" : pending}</span>}
          </Link>
          <span className="aa-avatar">{userInitial}</span>
        </div>
      </header>

      {/* ---------------- article toolbar ---------------- */}
      <div className="aa-bar">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {tab === "edit" ? (
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="aa-title-in" />
            ) : (
              <h2 className="aa-h2" title={title || "Untitled"}>{title || "Untitled"}</h2>
            )}
            {editable && (
              <button className="aa-pencil" onClick={() => setTab(tab === "edit" ? "read" : "edit")} title={tab === "edit" ? "Back to preview" : "Edit article"}>
                {tab === "edit" ? <Eye size={14} /> : <Pencil size={14} />}
              </button>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="aa-status" style={{ color: STATUS_COLOR[item.status] ?? "#8b8ba0" }}>
              <i style={{ background: STATUS_COLOR[item.status] ?? "#8b8ba0" }} />
              {STATUS_LABEL[item.status] ?? item.status}
            </span>
            {dirty && <span className="aa-status" style={{ color: "#fbbf24" }}><i style={{ background: "#fbbf24" }} />Unsaved changes</span>}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className="aa-btn" disabled={!neighbors.prev} onClick={() => neighbors.prev && router.push(`/dashboard/content/${neighbors.prev}`)}>
            <ArrowLeft size={14} /> Previous
          </button>
          <button className="aa-btn" disabled={!neighbors.next} onClick={() => neighbors.next && router.push(`/dashboard/content/${neighbors.next}`)}>
            Next <ArrowRight size={14} />
          </button>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button className="aa-btn" onClick={() => setMoreOpen((o) => !o)}>
              <MoreVertical size={14} /> More Actions <ChevronDown size={13} />
            </button>
            {moreOpen && (
              <div className="aa-menu">
                {editable && (
                  <button onClick={() => { setTab(tab === "edit" ? "read" : "edit"); setMoreOpen(false); }}>
                    {tab === "edit" ? <><Eye size={13} /> Preview article</> : <><Pencil size={13} /> Edit article</>}
                  </button>
                )}
                <button onClick={() => { copyMarkdown(); setMoreOpen(false); }}><Copy size={13} /> Copy markdown</button>
                {isLive && <a href={meta.publishedUrl!} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open live page</a>}
                <Link href="/dashboard/approvals"><CheckCircle2 size={13} /> Go to Approvals</Link>
                {pending_ && <button className="danger" onClick={() => { setMoreOpen(false); reject(); }}><X size={13} /> Reject article</button>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- body grid ---------------- */}
      <div className="aa-grid">
        {/* ------- main: browser-style preview ------- */}
        <div className="min-w-0 space-y-3">
          <div className="aa-card overflow-hidden">
            {/* address bar */}
            <div className="aa-chrome">
              <span className="aa-chrome-nav"><ArrowLeft size={13} /></span>
              <span className="aa-chrome-nav"><ArrowRight size={13} /></span>
              <span className="aa-chrome-nav"><RotateCw size={13} /></span>
              <span className="aa-url">
                {isLive && <Lock size={11} style={{ color: "#4ade80", flexShrink: 0 }} />}
                <span className="truncate" style={{ color: isLive ? "#4ade80" : "var(--lx-mut)" }}>{previewUrl}</span>
              </span>
              <span className="aa-chrome-nav"><MoreVertical size={13} /></span>
            </div>

            {/* body — WHITE, like the real published page (see header comment); everything
                else on this screen stays the app's own dark theme, deliberately, so it's
                obvious where "the app" ends and "what your reader will see" begins. */}
            {tab === "read" ? (
              /* the preview scrolls inside its own frame (like the reference mockup) so the
                 review bar underneath stays reachable without scrolling a whole article */
              <div className="aa-view lx-scroll">
                {/* hero — no photo (see header comment), just the real title/meta text */}
                <div className="aa-hero">
                  <div className="aa-hero-title">{title || "Untitled"}</div>
                  {meta.metaDescription && <p className="aa-hero-sub">{meta.metaDescription}</p>}
                  <div className="aa-hero-meta">By {siteName ?? "the team"} · {fmtDate(item.created_at)} · {readMins} min read</div>
                </div>
                {body.trim() ? (
                  <div className="aa-page">
                    <article className="lxpv-article" dangerouslySetInnerHTML={{ __html: html }} />
                  </div>
                ) : (
                  <p className="lx-11 lx-mut p-8 text-center">This item has no article text stored. Nothing was written, or the draft was cleared.</p>
                )}
              </div>
            ) : (
              <div className="p-4">
                <label className="aa-label">Article (markdown)</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck
                  className="lx-in lx-12 w-full p-3"
                  style={{ minHeight: "58vh", lineHeight: 1.7, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }}
                />
                <div className="mt-3 flex items-center gap-2">
                  <button className="lx-grad aa-primary" onClick={save} disabled={!dirty || !!busy}>
                    {busy === "save" ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    className="aa-btn"
                    disabled={!undoStack.current.length}
                    onClick={() => { const prev = undoStack.current.pop(); if (prev !== undefined) setBody(prev); }}
                  >
                    Undo
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ------- review bar ------- */}
          <div className="aa-card p-4">
            <div className="aa-review">
              <div className="min-w-0">
                <label className="aa-label">Add Review Comment</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={editable ? "Share your feedback or notes about this article…" : "Read-only — this item is no longer editable."}
                  disabled={!editable || revising}
                  className="aa-textarea"
                />
              </div>
              <div className="aa-status-col">
                <label className="aa-label">Change Status</label>
                <div className="aa-select">
                  <select value={statusChoice} onChange={(e) => setStatusChoice(e.target.value as any)} disabled={!pending_}>
                    <option value="approve">Approve</option>
                    <option value="request_changes">Request Changes</option>
                    <option value="reject">Reject</option>
                  </select>
                  <ChevronDown size={14} className="lx-mut" />
                </div>
                <button className="lx-grad aa-approve" onClick={runStatusChange} disabled={!pending_ || !!busy || revising}>
                  {busy === "approve" ? "Publishing…" : revising ? "Rewriting…" : (
                    <>
                      {statusChoice === "approve" ? <Send size={15} /> : statusChoice === "reject" ? <X size={15} /> : <Sparkles size={15} />}
                      {statusChoice === "approve" ? "Approve & Publish" : statusChoice === "reject" ? "Reject" : "Apply & Request Changes"}
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="aa-warn" onClick={() => revise(comment)} disabled={!pending_ || !comment.trim() || revising}
                title={pending_ ? "Rewrites the draft from your comment" : "Only a pending article can be sent back"}>
                Request Changes
              </button>
              <button className="aa-danger" onClick={reject} disabled={!pending_ || !!busy}
                title={pending_ ? "" : "Only a pending article can be rejected"}>
                Reject
              </button>
            </div>
          </div>
        </div>

        {/* ------- right rail ------- */}
        <aside className="aa-rail space-y-3">
          <div className="aa-card p-4">
            <div className="aa-h3">Article Details</div>
            <dl className="mt-3 space-y-2.5">
              <KV label="Author" value="Mr. Writer" />
              <KV label="Assigned By" value={meta.chosenBy === "user" ? "You" : meta.chosenBy === "auto" ? "Mr. Keyword" : "Not recorded"} />
              <KV label="Category" value={category === "loading" ? "Loading…" : category ?? "Uncategorized"} />
              <Block label="Tags">
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(meta.relatedKeywords ?? []).length ? (
                    meta.relatedKeywords!.map((k) => <span key={k} className="aa-tag">{k}</span>)
                  ) : (
                    <span className="lx-11 lx-mut">No related keywords recorded for this draft.</span>
                  )}
                </div>
              </Block>
              <Block label="Word Count"><div className="aa-val">{wordCount ? wordCount.toLocaleString() : "—"}</div></Block>
              <Block label="Target Keywords"><div className="aa-val">{targetKeywords.length ? targetKeywords.join(", ") : "—"}</div></Block>
              <Block label="Created At"><div className="aa-val">{fmtDate(item.created_at)}</div></Block>
              <Block label="Last Updated"><div className="aa-val">{fmtDate(item.updated_at)}</div></Block>
              <Block label="Link Preview">
                {slug || meta.publishedUrl ? (
                  isLive ? (
                    <a href={meta.publishedUrl!} target="_blank" rel="noreferrer" className="aa-link">
                      <span className="truncate">{meta.publishedUrl}</span><ExternalLink size={12} />
                    </a>
                  ) : (
                    <div className="aa-val truncate">will publish to /{slug}</div>
                  )
                ) : (
                  <div className="lx-11 lx-mut mt-1">No slug yet — decided at publish.</div>
                )}
              </Block>
            </dl>
          </div>

          <div className="aa-card p-4">
            <div className="aa-h3">AI Assistant</div>
            <div className="aa-seo-label"><Sparkles size={13} style={{ color: "#a78bfa" }} /> SEO Score</div>

            {seo ? (
              <>
                <div className="mt-2 flex items-center gap-3">
                  <svg width={80} height={80} viewBox="0 0 80 80" className="shrink-0">
                    <circle cx={40} cy={40} r={gaugeR} fill="none" stroke="var(--lx-in)" strokeWidth={6} />
                    <circle
                      cx={40} cy={40} r={gaugeR} fill="none" stroke={scoreColor(seo.score)} strokeWidth={6} strokeLinecap="round"
                      strokeDasharray={gaugeC} strokeDashoffset={gaugeC * (1 - seo.score / 100)}
                      transform="rotate(-90 40 40)"
                    />
                    <text x={40} y={39} textAnchor="middle" fontSize={19} fontWeight={800} fill="#fff">{seo.score}</text>
                    <text x={40} y={52} textAnchor="middle" fontSize={9} fill="var(--lx-mut)">/100</text>
                  </svg>
                  <p className="lx-11 lx-mut">
                    {seo.passed ? "Great! This article is well-optimized." : `${seo.issues.length} issue(s) worth a look before this goes live.`}
                  </p>
                </div>

                <div className="mt-3 space-y-2">
                  {categories.map((c) => (
                    <div key={c.label} className="aa-check">
                      {c.status === "pass" ? <CheckCircle2 size={15} style={{ color: "#22c55e" }} />
                        : c.status === "issue" ? <XCircle size={15} style={{ color: "#f87171" }} />
                        : <MinusCircle size={15} style={{ color: "var(--lx-dim)" }} />}
                      <span style={{ color: c.status === "unmeasured" ? "var(--lx-dim)" : "#e8e8f2" }}>{c.label}</span>
                    </div>
                  ))}
                </div>

                <button className="aa-report" onClick={() => setSeoReportOpen((o) => !o)}>
                  {seoReportOpen ? "Hide full SEO report" : "View Full SEO Report"}
                  <ExternalLink size={13} />
                </button>
                {seoReportOpen && (
                  <div className="lx-scroll mt-2 space-y-2" style={{ maxHeight: 260, overflowY: "auto" }}>
                    {seo.issues.length ? seo.issues.map((iss) => (
                      <div key={iss.id} className="aa-issue">
                        <div className="lx-11 font-semibold" style={{ color: iss.severity === "block" ? "#f87171" : "#fbbf24" }}>
                          {iss.severity === "block" ? "Blocker" : "Warning"} · {iss.what}
                        </div>
                        {iss.fix && <div className="lx-10 lx-mut mt-1">{iss.fix}</div>}
                      </div>
                    )) : <p className="lx-11 lx-mut">No open issues — every measured check passed.</p>}
                  </div>
                )}
              </>
            ) : (
              <p className="lx-11 lx-mut mt-2">Mr. SEO hasn&apos;t checked this draft yet.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="aa-kv">
      <span className="aa-k">{label}</span>
      <span className="aa-v" title={value}>{value}</span>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="aa-block">
      <div className="aa-k">{label}</div>
      {children}
    </div>
  );
}

/* Deliberately NOT ".prose" — app/globals.css already defines a global .prose (for the old
   dark-themed reviewer) with color:var(--ink), which leaked through here (an invisible
   near-white H1 on this white page) since a scoped selector for one class name doesn't stop a
   same-named GLOBAL rule from also matching. Own class, no clash. The article preview is a
   WHITE page (see header comment) — every colour there is picked for readability on white,
   not the dashboard's own dark palette.
   NOTE: this is one CSS string injected with dangerouslySetInnerHTML, not <style>{...}</style> —
   React escapes ">" inside a text child, which turns every child selector into a hydration
   mismatch (the exact bug hit on the Approvals rebuild). */
const CSS = `
/* every breakpoint here is a CONTAINER query: this page sits inside the dashboard shell,
   so the space it actually gets is the shell column, not the viewport */
.aa-wrap{display:flex;flex-direction:column;gap:12px;min-width:0;container-type:inline-size;container-name:aa}
.aa-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid var(--lx-border)}
.aa-h1{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1;color:#fff}
.aa-h2{font-size:17px;font-weight:700;color:#fff;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.aa-h3{font-size:14px;font-weight:700;color:#fff}
.aa-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:9px;white-space:nowrap;
  background:#12121c;border:1px solid var(--lx-border);color:#d6d6e4;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.aa-btn:hover:not(:disabled){color:#fff;border-color:rgba(139,92,246,.5);background:#171722}
.aa-btn:disabled{opacity:.4;cursor:not-allowed}
.aa-ico{position:relative;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;
  background:#12121c;border:1px solid var(--lx-border);color:#b6b6c8;transition:.15s}
.aa-ico:hover{color:#fff;border-color:rgba(139,92,246,.5)}
.aa-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;
  background:#ef4444;color:#fff;font-size:9.5px;font-weight:700;display:flex;align-items:center;justify-content:center}
.aa-avatar{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;
  background:linear-gradient(135deg,#7c3aed,#db2777);color:#fff;font-size:13px;font-weight:700;flex-shrink:0}
.aa-bar{display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px}
.aa-pencil{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;flex-shrink:0;
  background:none;border:none;color:#8b8ba0;cursor:pointer;transition:.15s}
.aa-pencil:hover{color:#fff;background:rgba(255,255,255,.07)}
.aa-title-in{min-width:280px;flex:1;height:34px;padding:0 10px;border-radius:9px;background:#0d0d16;
  border:1px solid var(--lx-border);color:#fff;font-size:15px;font-weight:700;outline:none}
.aa-title-in:focus{border-color:rgba(139,92,246,.55)}
.aa-status{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600}
.aa-status i{width:6px;height:6px;border-radius:50%;display:inline-block}
.aa-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:40;min-width:186px;padding:6px;border-radius:12px;
  background:#12121c;border:1px solid rgba(255,255,255,.1);box-shadow:0 12px 32px rgba(0,0,0,.55)}
.aa-menu>*{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border-radius:8px;border:none;background:none;
  color:#d6d6e4;font-size:12.5px;cursor:pointer;text-align:left}
.aa-menu>*:hover{background:rgba(255,255,255,.06);color:#fff}
.aa-menu>.danger{color:#f87171}
.aa-grid{display:grid;grid-template-columns:minmax(0,1fr) 272px;gap:12px;align-items:start}
@container aa (max-width:700px){.aa-grid{grid-template-columns:minmax(0,1fr)}}
.aa-card{background:#0a0a11;border:1px solid var(--lx-border);border-radius:14px}
.aa-chrome{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#12121c;border-bottom:1px solid var(--lx-border)}
.aa-chrome-nav{color:#6b6b80;display:inline-flex;flex-shrink:0}
.aa-url{display:flex;align-items:center;gap:6px;flex:1;min-width:0;height:28px;padding:0 12px;border-radius:14px;
  background:#0a0a11;border:1px solid var(--lx-border);font-size:11.5px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.aa-view{max-height:min(70vh,760px);overflow-y:auto}
.aa-hero{padding:30px 26px;background:linear-gradient(135deg,#1c1330,#0b0b18 60%,#0a1420);border-bottom:1px solid var(--lx-border)}
.aa-hero-title{font-size:28px;font-weight:800;line-height:1.15;color:#fff;letter-spacing:-.02em;max-width:640px}
.aa-hero-sub{margin-top:10px;max-width:560px;font-size:13.5px;line-height:1.55;color:#b8b8cc}
.aa-hero-meta{margin-top:16px;font-size:11.5px;color:#8b8ba0}
.aa-page{background:#fff}
.lxpv-article{max-width:720px;margin:0 auto;padding:28px 26px 34px}
.aa-label{display:block;margin-bottom:6px;font-size:11.5px;color:var(--lx-mut)}
.aa-textarea{width:100%;min-height:78px;padding:10px 12px;border-radius:10px;background:#0d0d16;border:1px solid var(--lx-border);
  color:#e8e8f2;font-size:12.5px;line-height:1.6;outline:none;resize:vertical}
.aa-textarea:focus{border-color:rgba(139,92,246,.55)}
.aa-textarea::placeholder{color:var(--lx-dim)}
.aa-textarea:disabled{opacity:.6}
.aa-review{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:14px;align-items:start}
@container aa (max-width:660px){.aa-review{grid-template-columns:minmax(0,1fr)}}
.aa-select{position:relative;display:flex;align-items:center;gap:6px;height:40px;padding:0 10px 0 12px;border-radius:10px;
  background:#0d0d16;border:1px solid var(--lx-border)}
.aa-select select{flex:1;min-width:0;appearance:none;-webkit-appearance:none;background:none;border:none;outline:none;
  color:#e8e8f2;font-size:12.5px;cursor:pointer}
.aa-select select option{background:#12121c;color:#e8e8f2}
.aa-select select:disabled{opacity:.55;cursor:not-allowed}
.aa-approve{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:42px;margin-top:8px;
  border-radius:10px;font-size:13px;font-weight:600}
.aa-approve:disabled{opacity:.4;cursor:not-allowed;filter:none}
.aa-primary{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 16px;border-radius:10px;font-size:12.5px;font-weight:600}
.aa-warn,.aa-danger{display:inline-flex;align-items:center;justify-content:center;height:38px;padding:0 18px;border-radius:10px;
  font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s;background:transparent}
.aa-warn{color:#fbbf24;border:1px solid rgba(251,191,36,.45)}
.aa-warn:hover:not(:disabled){background:rgba(251,191,36,.12)}
.aa-danger{color:#f87171;border:1px solid rgba(239,68,68,.45)}
.aa-danger:hover:not(:disabled){background:rgba(239,68,68,.12)}
.aa-warn:disabled,.aa-danger:disabled{opacity:.4;cursor:not-allowed}
.aa-kv{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.aa-k{font-size:11.5px;color:var(--lx-mut)}
.aa-v{font-size:12.5px;font-weight:600;color:#fff;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.aa-block{padding-top:2px}
.aa-val{margin-top:3px;font-size:12.5px;font-weight:600;color:#fff;line-height:1.45}
.aa-tag{display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10.5px;font-weight:600;
  color:#d6d6e4;background:rgba(255,255,255,.05);border:1px solid var(--lx-border)}
.aa-link{display:flex;align-items:center;gap:5px;margin-top:3px;font-size:12px;color:#818cf8;text-decoration:none}
.aa-link:hover{text-decoration:underline}
.aa-seo-label{display:flex;align-items:center;gap:6px;margin-top:12px;font-size:11.5px;color:var(--lx-mut)}
.aa-check{display:flex;align-items:center;gap:8px;font-size:12.5px}
.aa-report{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:14px;padding-top:12px;
  border-top:1px solid var(--lx-border);color:#818cf8;font-size:12.5px;font-weight:600;background:none;border-left:none;
  border-right:none;border-bottom:none;cursor:pointer}
.aa-report:hover{color:#a5b4fc}
.aa-issue{padding:10px;border-radius:10px;background:#0d0d16;border:1px solid var(--lx-border)}
.lxpv-article h1{display:none}
.lxpv-article h2{font-size:20px;font-weight:800;margin:26px 0 10px;color:#16161f}
.lxpv-article h3{font-size:16px;font-weight:700;margin:18px 0 6px;color:#16161f}
.lxpv-article p{color:#33333f;line-height:1.75;margin:0 0 14px;font-size:15px}
.lxpv-article ul{margin:0 0 16px;padding:0;list-style:none}
.lxpv-article li{position:relative;padding-left:26px;margin-bottom:12px;color:#33333f;font-size:15px;line-height:1.6}
.lxpv-article li::before{content:"";position:absolute;left:6px;top:8px;width:6px;height:6px;border-radius:50%;background:#7c3aed}
.lxpv-article a{color:#4f46e5;text-decoration:underline}
.lxpv-article strong{color:#0c0c15}
.lxpv-article img{max-width:100%;border-radius:10px;margin:14px 0}
`;
