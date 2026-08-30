"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { renderMarkdown } from "@/lib/md";
import { useStore } from "@/lib/store";
import { LxGlobalStyle } from "@/components/lx-theme";

/** /dashboard/content/[id] — "Article Approval", pixel-matched to the reference mockup
 *  (Downloads/artical read for approved page.png, given 2026-08-29) on the new Lx theme.
 *  Same real actions as the old reviewer (components/ArticleReview.tsx) — save / approve /
 *  publish / reject / AI-revise, same /api/content/[id]/** routes — just a new UI, and richer
 *  real data pulled onto the sidebar that ArticleReview never showed.
 *
 *  FULL-SCREEN, NOT inside <MrLxwaDashboard> — the owner asked (2026-08-29) for this to open as
 *  its own dedicated page, no dashboard sidebar competing for width, closer to how a real
 *  article-review tool feels. It brings its own `.lx-root` + <LxGlobalStyle/> (the same theme
 *  CSS the dashboard shell uses, shared via components/lx-theme.tsx — see that file) instead of
 *  inheriting them from a wrapper. app/dashboard/content/[id]/page.tsx renders this directly.
 *
 *  The article preview itself (hero + body, inside the browser-chrome mock) is WHITE with dark
 *  text — a real published page is not dark-mode, and the reference mockup shows exactly that;
 *  only the surrounding review chrome (toolbar, Article Details, AI Assistant, edit mode) stays
 *  the app's own dark theme.
 *
 *  WHAT'S REAL vs WHAT'S NOT — owner decisions from 2026-08-29:
 *   - Hero photo: the reference has a stock house photo. Mr. Image (the agent that would
 *     generate one per article) isn't built yet, so this page shows NO photo — a plain
 *     gradient block with the real title/meta text instead. Never a fake stock image.
 *   - Tags / "Assigned By": now real. agent-server/src/agents/writer.ts (2026-08-29) started
 *     saving `meta.relatedKeywords` (Mr. Keyword's own researched cluster for the topic) and
 *     `meta.chosenBy` ("user" | "auto") on every new article. Older rows won't have either —
 *     shown as "not recorded" rather than blank or invented.
 *   - Category: derived at read time from the Site Brain's topic clusters (GET /api/site-brain)
 *     by nearest keyword-token overlap with the primary keyword — the same idea as
 *     agent-server's nearestCluster(), ported client-side since there is no API for it yet.
 *     "Uncategorized" when the Brain has nothing close enough.
 *   - SEO Score + the 5-item checklist: Mr. SEO already runs ~22 deterministic checks
 *     (agent-server/src/lib/seoChecks.ts) and now saves the full list to `meta.seo.checks`
 *     (2026-08-29 — it used to save only the failures). The 5 categories below are the same
 *     checks grouped, not a different, invented score.
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
const STATUS_TONE: Record<string, string> = {
  draft: "mut",
  awaiting_approval: "amber",
  approved: "green",
  published: "green",
  failed: "red",
  rejected: "red",
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
// the server" — see MrLxwaDashboard.tsx's own blink/hydration lessons from earlier this session.
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
  const { toast, confirmAction } = useStore();
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

  // Prev/Next — real neighbours in this tenant's content list, not a fixed demo order.
  const [neighbors, setNeighbors] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });
  useEffect(() => {
    fetch("/api/content?status=all")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        const ids: string[] = (d.items ?? []).map((it: any) => it.id);
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

  const wordCount = meta.wordCount ?? 0;
  const readMins = Math.max(1, Math.round(wordCount / 200));
  const targetKeywords = [item.primary_keyword, ...((meta.relatedKeywords ?? []).filter((k) => k !== item.primary_keyword))].filter(Boolean) as string[];
  const domain = (siteUrl ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const slug = meta.slug ?? item.slug ?? null;
  const previewUrl = meta.publishedUrl || (domain && slug ? `${domain}/${slug}` : domain || "no domain connected");
  const isLive = !!meta.publishedUrl;

  const scoreColor = (s: number) => (s >= 75 ? "#22c55e" : s >= 50 ? "#fbbf24" : "#ef4444");
  const gaugeR = 46;
  const gaugeC = 2 * Math.PI * gaugeR;

  return (
    <div className="lx-root min-h-screen">
      <LxGlobalStyle />
      <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Link href="/dashboard/content" className="lx-ghost">← Back to Content</Link>
        <div className="ml-auto flex items-center gap-2">
          <button className="lx-ghost" disabled={!neighbors.prev} onClick={() => neighbors.prev && router.push(`/dashboard/content/${neighbors.prev}`)}>← Previous</button>
          <button className="lx-ghost" disabled={!neighbors.next} onClick={() => neighbors.next && router.push(`/dashboard/content/${neighbors.next}`)}>Next →</button>
          {editable && (
            <button className="lx-ghost" onClick={() => setTab(tab === "edit" ? "read" : "edit")}>
              {tab === "edit" ? "Preview" : "Edit article"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {tab === "edit" ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="lx-in lx-13 px-3 py-2 font-bold" style={{ minWidth: 320 }} />
        ) : (
          <h1 className="text-lg font-bold">{title || "Untitled"}</h1>
        )}
        <span className={"lx-pill " + (STATUS_TONE[item.status] ?? "mut")}>{STATUS_LABEL[item.status] ?? item.status}</span>
        {dirty && <span className="lx-pill amber">Unsaved changes</span>}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) 320px" }}>
        {/* ---------------- main: browser-style preview ---------------- */}
        <div className="min-w-0 space-y-4">
          <div className="lx-card overflow-hidden">
            {/* address bar */}
            <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--lx-border)", background: "var(--lx-panel)" }}>
              <span className="lx-mut lx-11">‹</span>
              <span className="lx-mut lx-11">›</span>
              <span className="lx-mut lx-11">⟳</span>
              <span className="lx-in lx-11 lx-mono flex-1 truncate px-3 py-1.5" style={{ color: isLive ? "#4ade80" : "var(--lx-mut)" }}>
                {isLive ? "🔒 " : ""}{previewUrl}
              </span>
            </div>

            {/* hero — no photo (see header comment), just the real title/meta text */}
            <div
              className="px-6 py-10 sm:px-10"
              style={{ background: "linear-gradient(135deg,#1c1330,#0b0b18 60%,#0a1420)", borderBottom: "1px solid var(--lx-border)" }}
            >
              <div className="text-2xl font-extrabold leading-tight sm:text-3xl" style={{ color: "#fff" }}>{title || "Untitled"}</div>
              {meta.metaDescription && <p className="lx-mut mt-2" style={{ maxWidth: 560 }}>{meta.metaDescription}</p>}
              <div className="lx-11 lx-mut mt-4">
                By {siteName ?? "the team"} · {fmtDate(item.created_at)} · {readMins} min read
              </div>
            </div>

            {/* body — WHITE, like the real published page (see header comment); everything
                else on this screen stays the app's own dark theme, deliberately, so it's
                obvious where "the app" ends and "what your reader will see" begins. */}
            {tab === "read" ? (
              body.trim() ? (
                <div style={{ background: "#ffffff" }}>
                  <article className="lxpv-article mx-auto max-w-[720px] px-6 py-8 sm:px-10" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              ) : (
                <p className="lx-11 lx-mut p-8 text-center">This item has no article text stored. Nothing was written, or the draft was cleared.</p>
              )
            ) : (
              <div className="p-4 sm:p-6">
                <label className="lx-10 lx-mut mb-1.5 block font-semibold uppercase">Article (markdown)</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck
                  className="lx-in lx-12 w-full p-3"
                  style={{ minHeight: "60vh", lineHeight: 1.7, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }}
                />
                <div className="mt-3 flex items-center gap-2">
                  <button className="lx-grad px-4 py-2" onClick={save} disabled={!dirty || !!busy}>
                    {busy === "save" ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    className="lx-ghost"
                    disabled={!undoStack.current.length}
                    onClick={() => { const prev = undoStack.current.pop(); if (prev !== undefined) setBody(prev); }}
                  >
                    Undo
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ---------------- review bar ---------------- */}
          <div className="lx-card flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <label className="lx-10 lx-mut mb-1.5 block font-semibold uppercase">Add Review Comment</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={editable ? "Share your feedback or notes about this article… (used as the rewrite instruction for “Request Changes”)" : "Read-only — this item is no longer editable."}
                  disabled={!editable || revising}
                  className="lx-in lx-12 w-full p-2.5"
                  style={{ minHeight: 70 }}
                />
              </div>
              <div className="w-full shrink-0 sm:w-56">
                <label className="lx-10 lx-mut mb-1.5 block font-semibold uppercase">Change Status</label>
                <select
                  value={statusChoice}
                  onChange={(e) => setStatusChoice(e.target.value as any)}
                  className="lx-in lx-12 w-full px-3 py-2.5"
                  disabled={item.status !== "awaiting_approval"}
                >
                  <option value="approve">Approve</option>
                  <option value="request_changes">Request Changes</option>
                  <option value="reject">Reject</option>
                </select>
                <button
                  className="lx-grad lx-12 mt-2 w-full py-2.5"
                  onClick={runStatusChange}
                  disabled={item.status !== "awaiting_approval" || !!busy || revising}
                >
                  {busy === "approve" ? "Publishing…" : revising ? "Rewriting…" : statusChoice === "approve" ? "✓ Approve & Publish" : statusChoice === "reject" ? "Reject" : "Apply & Request Changes"}
                </button>
              </div>
            </div>

            {item.status === "awaiting_approval" && (
              <div className="flex items-center gap-2 border-t pt-3" style={{ borderColor: "var(--lx-border)" }}>
                <button className="lx-ghost" style={{ borderColor: "rgba(251,191,36,.4)", color: "#fbbf24" }} onClick={() => revise(comment)} disabled={!comment.trim() || revising}>
                  Request Changes
                </button>
                <button className="lx-ghost" style={{ borderColor: "rgba(239,68,68,.4)", color: "#f87171" }} onClick={reject} disabled={!!busy}>
                  Reject
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ---------------- sidebar ---------------- */}
        <aside className="space-y-4">
          <div className="lx-card p-4">
            <div className="mb-3 text-sm font-bold">Article Details</div>
            <dl className="space-y-3">
              <Row label="Author" value="Mr. Writer" />
              <Row
                label="Assigned By"
                value={meta.chosenBy === "user" ? "You picked the topic" : meta.chosenBy === "auto" ? "Mr. Keyword (auto-picked)" : "Not recorded"}
              />
              <Row label="Category" value={category === "loading" ? "Loading…" : category ?? "Uncategorized"} />
              <div>
                <div className="lx-10 lx-mut font-semibold uppercase">Tags</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(meta.relatedKeywords ?? []).length ? (
                    meta.relatedKeywords!.map((k) => <span key={k} className="lx-pill mut">{k}</span>)
                  ) : (
                    <span className="lx-11 lx-mut">No related keywords recorded for this draft.</span>
                  )}
                </div>
              </div>
              <Row label="Word Count" value={wordCount ? wordCount.toLocaleString() : "—"} />
              <div>
                <div className="lx-10 lx-mut font-semibold uppercase">Target Keywords</div>
                <div className="lx-12 mt-1">{targetKeywords.length ? targetKeywords.join(", ") : "—"}</div>
              </div>
              <Row label="Created At" value={fmtDate(item.created_at)} />
              <Row label="Last Updated" value={fmtDate(item.updated_at)} />
              <div>
                <div className="lx-10 lx-mut font-semibold uppercase">Link Preview</div>
                {slug || meta.publishedUrl ? (
                  isLive ? (
                    <a href={meta.publishedUrl!} target="_blank" rel="noreferrer" className="lx-12 mt-1 block truncate" style={{ color: "var(--lx-cyan)" }}>
                      {meta.publishedUrl} ↗
                    </a>
                  ) : (
                    <div className="lx-12 mt-1 truncate">will publish to /{slug}</div>
                  )
                ) : (
                  <div className="lx-11 lx-mut mt-1">No slug yet — decided at publish.</div>
                )}
              </div>
            </dl>
          </div>

          <div className="lx-card p-4">
            <div className="mb-3 text-sm font-bold">AI Assistant</div>
            <div className="lx-10 lx-mut mb-2 font-semibold uppercase">✦ SEO Score</div>

            {seo ? (
              <>
                <div className="flex items-center gap-3">
                  <svg width={104} height={104} viewBox="0 0 104 104" className="shrink-0">
                    <circle cx={52} cy={52} r={gaugeR} fill="none" stroke="var(--lx-in)" strokeWidth={8} />
                    <circle
                      cx={52} cy={52} r={gaugeR} fill="none" stroke={scoreColor(seo.score)} strokeWidth={8} strokeLinecap="round"
                      strokeDasharray={gaugeC} strokeDashoffset={gaugeC * (1 - seo.score / 100)}
                      transform="rotate(-90 52 52)"
                    />
                    <text x={52} y={49} textAnchor="middle" fontSize={22} fontWeight={800} fill="#fff">{seo.score}</text>
                    <text x={52} y={65} textAnchor="middle" fontSize={10} fill="var(--lx-mut)">/100</text>
                  </svg>
                  <p className="lx-11 lx-mut">
                    {seo.passed ? "Great! This article is well-optimized." : `${seo.issues.length} issue(s) worth a look before this goes live.`}
                  </p>
                </div>

                <div className="mt-3.5 space-y-1.5">
                  {categories.map((c) => (
                    <div key={c.label} className="flex items-center gap-2 lx-11">
                      <span style={{ color: c.status === "pass" ? "#4ade80" : c.status === "issue" ? "#f87171" : "var(--lx-dim)" }}>
                        {c.status === "pass" ? "✓" : c.status === "issue" ? "✕" : "–"}
                      </span>
                      <span style={{ color: c.status === "unmeasured" ? "var(--lx-dim)" : "var(--lx-text)" }}>{c.label}</span>
                    </div>
                  ))}
                </div>

                <button className="lx-11 mt-3 font-semibold" style={{ color: "var(--lx-cyan)" }} onClick={() => setSeoReportOpen((o) => !o)}>
                  {seoReportOpen ? "Hide full SEO report ▴" : "View Full SEO Report ▾"}
                </button>
                {seoReportOpen && (
                  <div className="lx-scroll mt-2 space-y-2" style={{ maxHeight: 260, overflowY: "auto" }}>
                    {seo.issues.length ? seo.issues.map((iss) => (
                      <div key={iss.id} className="lx-card2 p-2.5">
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
              <p className="lx-11 lx-mut">Mr. SEO hasn&apos;t checked this draft yet.</p>
            )}
          </div>
        </aside>
      </div>

      <style jsx>{`
        /* Deliberately NOT ".prose" — app/globals.css already defines a global .prose (for the
           old dark-themed reviewer) with color:var(--ink), which leaked through here (an
           invisible near-white H1 on this white page) since a scoped selector for one class
           name doesn't stop a same-named GLOBAL rule from also matching. Own class, no clash.
           The article preview is a WHITE page (see header comment) — every color below is
           picked for readability on white, not the dashboard's own dark palette. */
        .lxpv-article :global(h1) { display: none; } /* the hero above already shows the title */
        .lxpv-article :global(h2) { font-size: 20px; font-weight: 800; margin: 26px 0 10px; color: #16161f; }
        .lxpv-article :global(h3) { font-size: 16px; font-weight: 700; margin: 18px 0 6px; color: #16161f; }
        .lxpv-article :global(p) { color: #33333f; line-height: 1.75; margin: 0 0 14px; font-size: 15px; }
        .lxpv-article :global(ul) { margin: 0 0 16px; padding: 0; list-style: none; }
        .lxpv-article :global(li) { position: relative; padding-left: 26px; margin-bottom: 12px; color: #33333f; font-size: 15px; line-height: 1.6; }
        .lxpv-article :global(li)::before { content: "●"; position: absolute; left: 4px; top: 2px; font-size: 8px; color: #7c3aed; }
        .lxpv-article :global(a) { color: #4f46e5; text-decoration: underline; }
        .lxpv-article :global(strong) { color: #0c0c15; }
        .lxpv-article :global(img) { max-width: 100%; border-radius: 10px; margin: 14px 0; }
      `}</style>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="lx-10 lx-mut font-semibold uppercase">{label}</div>
      <div className="lx-12 mt-0.5">{value}</div>
    </div>
  );
}
