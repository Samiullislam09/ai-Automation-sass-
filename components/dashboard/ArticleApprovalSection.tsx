"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Bold, CheckCircle2, ChevronLeft, ChevronRight, Clapperboard, Clock, Code2, Copy,
  ExternalLink, Eye, Heading2, Heading3, Italic, Link2, List, ListOrdered, Lock, MinusCircle,
  Check, MoreVertical, Pencil, Pilcrow, Redo2, Send, Sparkles, Undo2, X, XCircle,
} from "lucide-react";
import { renderMarkdown } from "@/lib/md";
import { htmlToMarkdown } from "@/lib/html-to-md";
import { useStore } from "@/lib/store";
import { LxGlobalStyle } from "@/components/lx-theme";

/** /dashboard/content/[id] — the article reviewer.
 *
 *  REBUILT 2026-09-18 to read like a real published web page, on the owner's call:
 *   - No dashboard shell. The left nav is gone (app/dashboard/content/[id]/page.tsx no longer
 *     wraps this in <MrLxwaDashboard>), so the article gets the whole viewport. This component
 *     mounts <LxGlobalStyle/> itself again — but NOT `.lx-root`, because that element is what
 *     paints the app dark; the light --lx-* values this page needs are redefined in CSS below.
 *   - The whole page is light. It used to be a white article island inside dark app chrome and
 *     a browser-chrome mock; now it's a white sheet on a light canvas with one slim top bar.
 *     The article scrolls with the page instead of inside its own 80vh frame.
 *   - The bottom review bar is gone — "Add Review Comment", the "Change Status" select and the
 *     Approve / Request Changes / Reject row. Its three actions all survive in the rail:
 *     "Approve & Publish" as the one primary button, "Request changes" and "Reject" as text
 *     links underneath, and Request Changes opens its comment box inline (that comment is
 *     still the instruction sent to /revise — nothing about the action changed, only where
 *     you click it).
 *   - The rail is 210px and compact. Word Count and Link Preview were dropped (owner's pick);
 *     Status, Author, Assigned By, Category, Target Keywords, Created, Updated, Tags and the
 *     SEO score + checklist stayed.
 *
 *  Same real actions as before, kept verbatim — save / approve / publish / reject / AI-revise
 *  through the same /api/content/[id]/** routes. Only the chrome changed.
 *
 *  WHAT'S REAL vs WHAT'S NOT — owner decisions from 2026-08-29, unchanged:
 *   - Hero photo: there is none. Mr. Image (the agent that would generate one per article)
 *     isn't built yet, so this page shows the real title/meta text only. Never a fake stock
 *     image.
 *   - The customer's own site header/nav isn't rendered: we don't host their template, so the
 *     preview is the article, not their whole page.
 *   - Tags / "Assigned By": real (`meta.relatedKeywords`, `meta.chosenBy` — written by
 *     agent-server/src/agents/writer.ts since 2026-08-29). Older rows say "not recorded".
 *   - Category: derived at read time from the Site Brain's topic clusters (GET /api/site-brain)
 *     by nearest keyword-token overlap — the port of agent-server's nearestCluster() below.
 *   - SEO Score + the 5-item checklist: Mr. SEO's own ~22 deterministic checks
 *     (agent-server/src/lib/seoChecks.ts), grouped — not a second, invented score.
 *   - The address in the top bar: the real published URL once live (`meta.publishedUrl`), or
 *     the staged path from the real slug beforehand (grey, not green, until it is live). */

/** One row of `media` (migration 023) — a picture Mr. Image made for this article. `anchor`
 *  is the exact H2 an inline image was drawn for; null on slots that belong to the article as
 *  a whole (hero, thumb) or to the story (story_*). */
export type MediaRow = {
  slot: string; url: string; alt: string | null; anchor: string | null;
  width: number | null; height: number | null; provider: string | null;
};

/** The article's Web Story — its own reviewable content_item. `meta.pages` is what Mr. Story
 *  actually wrote; `body` (the AMP HTML) isn't read here, the story has its own review page. */
export type StoryRow = {
  id: string; status: string; title: string | null;
  meta: { pages?: { headline?: string; body?: string; image?: string }[]; ampValid?: boolean } | null;
};

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

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const figure = (m: MediaRow, cls = "") =>
  `<figure class="aa-fig ${cls}"><img src="${esc(m.url)}" alt="${esc(m.alt ?? "")}" loading="lazy" />` +
  (m.alt ? `<figcaption>${esc(m.alt)}</figcaption>` : "") +
  `</figure>`;

/** Drops each inline image in after the H2 its `anchor` names. Mr. Image stores the exact
 *  heading text it drew for, so the match is on the H2's own text, not on position — an
 *  article that gets re-ordered keeps every picture beside the right section. An image whose
 *  anchor matches no heading is appended at the end rather than silently dropped. */
function withInlineImages(html: string, images: MediaRow[]) {
  if (!images.length) return html;
  const norm = (t: string) => t.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const left = images.slice();
  const out = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, (full, inner) => {
    const head = norm(inner);
    const at = left.findIndex((m) => m.anchor && norm(m.anchor) === head);
    if (at === -1) return full;
    const [hit] = left.splice(at, 1);
    return full + figure(hit);
  });
  return out + left.map((m) => figure(m)).join("");
}

export default function ArticleApprovalSection({
  item,
  editable,
  id,
  siteName,
  siteUrl,
  media,
  story,
}: {
  item: Item;
  editable: boolean;
  id: string;
  siteName: string | null;
  siteUrl: string | null;
  media: MediaRow[];
  story: StoryRow | null;
}) {
  const { toast, confirmAction } = useStore();
  const router = useRouter();

  const [tab, setTab] = useState<"read" | "edit">("read");
  const [body, setBody] = useState(item.body ?? "");
  const [title, setTitle] = useState(item.title ?? "");
  const [savedBody, setSavedBody] = useState(item.body ?? "");
  const [savedTitle, setSavedTitle] = useState(item.title ?? "");
  // Round-tripping the article through the visual editor re-normalises its markdown a little
  // (spacing, escapes) without anyone having changed a word, so edit mode keeps its own
  // baseline: "dirty" means different from what the server has AND from that baseline.
  const [editBase, setEditBase] = useState<string | null>(null);
  const dirty = (body !== savedBody && body !== (editBase ?? savedBody)) || title !== savedTitle;

  const [comment, setComment] = useState("");
  const [revising, setRevising] = useState(false);
  const [busy, setBusy] = useState("");
  const [askOpen, setAskOpen] = useState(false);   // the inline "Request changes" comment box
  // "WebStory available" in the rail scrolls the story into view and flashes it, so the click
  // lands somewhere visible instead of just jumping (owner, 2026-09-18: "camera focus ho").
  const storyRef = useRef<HTMLDivElement>(null);
  const [storyGlow, setStoryGlow] = useState(false);
  const [seoReportOpen, setSeoReportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [source, setSource] = useState(false);      // raw-markdown escape hatch inside edit mode
  const [linkOpen, setLinkOpen] = useState(false);
  // The URL is editable until the article goes live (owner, 2026-09-18). `slugSaved` is the
  // local truth after a save, so the top bar and the rail both update without a reload.
  const [slugEditing, setSlugEditing] = useState(false);
  const [slugDraft, setSlugDraft] = useState("");
  const [slugSaved, setSlugSaved] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const undoStack = useRef<string[]>([]);
  const editorRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editHtmlRef = useRef("");

  /* ---- WYSIWYG editing (no markdown to learn — owner's ask, 2026-09-05) ----------------
     The editable surface IS the rendered article. Its HTML is seeded once when edit mode
     opens and never re-written from state (that would jump the caret); every keystroke is
     converted back to markdown, which is what actually gets saved. */
  const syncFromEditor = () => {
    const el = editorRef.current;
    if (el) setBody(htmlToMarkdown(el as HTMLElement));
  };
  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    syncFromEditor();
  };
  const applyLink = () => {
    const url = linkUrl.trim();
    if (!/^(https?:\/\/|\/)/.test(url)) { toast("Link https:// se ya / se shuru hona chahiye.", "info"); return; }
    exec("createLink", url);
    setLinkUrl("");
    setLinkOpen(false);
  };
  // Seeds the editable article once per edit session (and when coming back from Source).
  useEffect(() => {
    if (tab !== "edit" || source) return;
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = editHtmlRef.current;
    const md = htmlToMarkdown(el);
    setBody(md);
    setEditBase(md);
  }, [tab, source]);

  // The title box is a textarea so a long headline wraps instead of being cut off; it has to
  // be re-measured on every keystroke, and once when edit mode opens.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title, tab, source]);

  const enterEdit = () => {
    editHtmlRef.current = renderMarkdown(body) || "<p><br /></p>";
    setTab("edit");
  };
  const toggleEdit = () => (tab === "edit" ? setTab("read") : enterEdit());
  const toggleSource = () => {
    // leaving Source: re-seed the editable HTML from whatever the markdown now says
    if (source) editHtmlRef.current = renderMarkdown(body) || "<p><br /></p>";
    setSource((v) => !v);
  };

  /* ---- pictures --------------------------------------------------------------------
     Mr. Image files every picture in `media` (migration 023), never in the article markdown,
     so this page has to put them back: `hero` is the lead image a real blog post opens with,
     `inline_*` rows go beside the H2 their `anchor` names, `thumb` is the listing card's
     image (shown in the rail, not in the body) and `story_*` belongs to the Web Story. */
  const heroImage = useMemo(() => media.find((m) => m.slot === "hero") ?? null, [media]);
  const inlineImages = useMemo(() => media.filter((m) => /^inline/.test(m.slot)), [media]);
  const articleImages = useMemo(() => media.filter((m) => !/^story_/.test(m.slot)), [media]);
  const storyPages = story?.meta?.pages ?? [];

  const html = useMemo(() => withInlineImages(renderMarkdown(body), inlineImages), [body, inlineImages]);
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

  // Prev/Next — real neighbours in this tenant's content list, not a fixed demo order.
  const [neighbors, setNeighbors] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });
  useEffect(() => {
    fetch("/api/content?status=all")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        const ids: string[] = (d.items ?? []).map((it: { id: string }) => it.id);
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
      setAskOpen(false);
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
      setEditBase(null);
      undoStack.current = [];
      toast("Saved.");
    } catch (e: any) {
      toast(`Save failed: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  /** Renames the URL. The server does the slugifying and owns the uniqueness rule (one site
   *  cannot have two articles on one URL — migration 019's index), so this just sends what was
   *  typed and shows whatever comes back. */
  const saveSlug = async () => {
    const wanted = slugDraft.trim();
    if (!wanted) { toast("Type a URL slug first.", "info"); return; }
    setBusy("slug");
    try {
      const res = await fetch(`/api/content/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: wanted }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { toast(data?.error ?? `Couldn't save the URL (HTTP ${res.status}).`, "error"); return; }
      setSlugSaved(data.slug ?? wanted);
      setSlugEditing(false);
      toast(`URL is now /${data.slug ?? wanted}`);
    } catch (e: any) {
      toast(`Couldn't save the URL: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  const approve = async () => {
    if (dirty) { toast("Save your changes before publishing.", "info"); return; }
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

  const focusStory = () => {
    const el = storyRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setStoryGlow(true);
    window.setTimeout(() => setStoryGlow(false), 1600);
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
  const slug = slugSaved ?? meta.slug ?? item.slug ?? null;
  const previewUrl = meta.publishedUrl || (domain && slug ? `${domain}/${slug}` : domain || "no domain connected");
  const isLive = !!meta.publishedUrl;
  const pending_ = item.status === "awaiting_approval";

  const scoreColor = (s: number) => (s >= 75 ? "#22c55e" : s >= 50 ? "#fbbf24" : "#ef4444");
  const gaugeR = 34;
  const gaugeC = 2 * Math.PI * gaugeR;

  return (
    <div className="aa-wrap">
      <LxGlobalStyle />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ---------------- top bar ----------------
          The whole page is light now (owner, 2026-09-18: "real web page article jaisa show
          karna hai, white bg"), so this bar is the only chrome left: back, the neighbour
          steps, where it will publish, the status, edit, and More Actions. */}
      <div className="aa-bar">
        <Link href="/dashboard/content" className="aa-cbtn" title="Back to Content"><ArrowLeft size={15} /></Link>
        <button className="aa-cbtn" disabled={!neighbors.prev} title="Previous article"
          onClick={() => neighbors.prev && router.push(`/dashboard/content/${neighbors.prev}`)}>
          <ChevronLeft size={15} />
        </button>
        <button className="aa-cbtn" disabled={!neighbors.next} title="Next article"
          onClick={() => neighbors.next && router.push(`/dashboard/content/${neighbors.next}`)}>
          <ChevronRight size={15} />
        </button>
        {slugEditing ? (
          /* Editing the URL. The domain is fixed (it is the connected site), so only the slug
             half is typeable — you cannot accidentally publish to someone else's domain. */
          <span className="aa-url editing">
            <span className="aa-url-fixed">{domain ? `${domain}/` : "/"}</span>
            <input
              autoFocus
              value={slugDraft}
              onChange={(e) => setSlugDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveSlug();
                if (e.key === "Escape") setSlugEditing(false);
              }}
              placeholder="article-url-slug"
              spellCheck={false}
            />
            <button className="aa-url-ok" onClick={saveSlug} disabled={busy === "slug"} title="Save this URL">
              {busy === "slug" ? "…" : <Check size={13} />}
            </button>
            <button className="aa-url-x" onClick={() => setSlugEditing(false)} title="Cancel"><X size={13} /></button>
          </span>
        ) : (
          <span className="aa-url">
            {isLive && <Lock size={11} style={{ color: "#16a34a", flexShrink: 0 }} />}
            <span className="truncate" style={{ color: isLive ? "#16a34a" : "#6b7280" }}>{previewUrl}</span>
            {editable && !isLive && (
              <button className="aa-url-edit" title="Change the URL (slug)"
                onClick={() => { setSlugDraft(slug ?? ""); setSlugEditing(true); }}>
                <Pencil size={11} />
              </button>
            )}
          </span>
        )}
        <span className="aa-chip" style={{ color: STATUS_COLOR[item.status] ?? "#6b7280" }} title={`Status: ${STATUS_LABEL[item.status] ?? item.status}`}>
          <i style={{ background: STATUS_COLOR[item.status] ?? "#6b7280" }} />
          <span className="aa-chip-t">{STATUS_LABEL[item.status] ?? item.status}</span>
        </span>
        {dirty && (
          <span className="aa-chip" style={{ color: "#b45309" }} title="Unsaved changes">
            <i style={{ background: "#b45309" }} /><span className="aa-chip-t">Unsaved</span>
          </span>
        )}
        {editable && (
          <button className={`aa-cbtn ${tab === "edit" ? "on" : ""}`} onClick={toggleEdit} title={tab === "edit" ? "Back to preview" : "Edit article"}>
            {tab === "edit" ? <Eye size={15} /> : <Pencil size={15} />}
          </button>
        )}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button className="aa-cbtn" onClick={() => setMoreOpen((o) => !o)} title="More actions"><MoreVertical size={15} /></button>
          {moreOpen && (
            <div className="aa-menu">
              {editable && (
                <button onClick={() => { toggleEdit(); setMoreOpen(false); }}>
                  {tab === "edit" ? <><Eye size={13} /> Preview article</> : <><Pencil size={13} /> Edit article</>}
                </button>
              )}
              <button onClick={() => { copyMarkdown(); setMoreOpen(false); }}><Copy size={13} /> Copy markdown</button>
              {isLive && <a href={meta.publishedUrl!} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open live page</a>}
              <Link href="/dashboard/approvals"><CheckCircle2 size={13} /> Go to Approvals</Link>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- body grid ---------------- */}
      <div className="aa-grid">
        {/* ------- main: the article, as a reader would see it ------- */}
        <div className="min-w-0">
          {tab === "read" ? (
            /* No inner scroll frame any more: the article scrolls with the page, like a real
               published post, instead of inside a 80vh box. */
            <div className="aa-sheet">
              <div className="aa-hero">
                <h1 className="aa-hero-title">{title || "Untitled"}</h1>
                {meta.metaDescription && <p className="aa-hero-sub">{meta.metaDescription}</p>}
                <div className="aa-hero-meta">By {siteName ?? "the team"} · {fmtDate(item.created_at)} · {readMins} min read</div>
              </div>
              {/* the lead image — a real `media` row, never a placeholder. Nothing renders
                  here when Mr. Image hasn't made one for this article yet. */}
              {heroImage && (
                <figure className="aa-lead">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={heroImage.url} alt={heroImage.alt ?? ""} />
                  {heroImage.alt && <figcaption>{heroImage.alt}</figcaption>}
                </figure>
              )}
              {body.trim() ? (
                <div className="aa-page">
                  <article className="lxpv-article" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              ) : (
                <p className="aa-empty">This item has no article text stored. Nothing was written, or the draft was cleared.</p>
              )}
            </div>
          ) : (
            /* EDIT MODE — you edit the page itself, not markup. The article is still stored
               as markdown (the publisher, Mr. SEO and every agent read markdown), so what the
               browser produces is converted back on every keystroke via lib/html-to-md.ts.
               "Source" is still there for anyone who wants the raw markdown. */
            <div className="aa-sheet">
              <div className="aa-tools">
                {!source && (
                  <>
                    <Tool title="Bold" onClick={() => exec("bold")}><Bold size={14} /></Tool>
                    <Tool title="Italic" onClick={() => exec("italic")}><Italic size={14} /></Tool>
                    <span className="aa-tool-sep" />
                    <Tool title="Heading" onClick={() => exec("formatBlock", "h2")}><Heading2 size={14} /></Tool>
                    <Tool title="Sub-heading" onClick={() => exec("formatBlock", "h3")}><Heading3 size={14} /></Tool>
                    <Tool title="Normal text" onClick={() => exec("formatBlock", "p")}><Pilcrow size={14} /></Tool>
                    <span className="aa-tool-sep" />
                    <Tool title="Bullet list" onClick={() => exec("insertUnorderedList")}><List size={14} /></Tool>
                    <Tool title="Numbered list" onClick={() => exec("insertOrderedList")}><ListOrdered size={14} /></Tool>
                    <Tool title="Link" onClick={() => setLinkOpen((o) => !o)}><Link2 size={14} /></Tool>
                    <span className="aa-tool-sep" />
                    <Tool title="Undo" onClick={() => exec("undo")}><Undo2 size={14} /></Tool>
                    <Tool title="Redo" onClick={() => exec("redo")}><Redo2 size={14} /></Tool>
                  </>
                )}
                <button className={`aa-btn ml-auto ${source ? "on" : ""}`} onClick={toggleSource} title="Show the raw markdown">
                  <Code2 size={14} /> Source
                </button>
                <button className="aa-primary" onClick={save} disabled={!dirty || !!busy}>
                  {busy === "save" ? "Saving…" : "Save"}
                </button>
              </div>

              {linkOpen && !source && (
                <div className="aa-linkbar">
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://example.com/page — select the words first, then paste the link"
                    onKeyDown={(e) => { if (e.key === "Enter") applyLink(); }}
                  />
                  <button className="aa-btn" onMouseDown={(e) => e.preventDefault()} onClick={applyLink}>Add link</button>
                  <button className="aa-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => { exec("unlink"); setLinkOpen(false); }}>Remove</button>
                </div>
              )}

              <div className="aa-hero">
                <textarea
                  ref={titleRef}
                  className="aa-hero-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Article title"
                  rows={1}
                />
                {meta.metaDescription && <p className="aa-hero-sub">{meta.metaDescription}</p>}
                <div className="aa-hero-meta">By {siteName ?? "the team"} · {fmtDate(item.created_at)} · {readMins} min read</div>
              </div>
              {source ? (
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck
                  className="aa-source"
                />
              ) : (
                <div className="aa-page">
                  {/* deliberately empty in JSX: the HTML is written by the effect above
                      when edit mode opens. React must not own these children — with
                      dangerouslySetInnerHTML on a contentEditable it re-applies the seed
                      on every re-render and every typed character vanishes. */}
                  <article
                    ref={editorRef}
                    className="lxpv-article aa-editable"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck
                    onInput={syncFromEditor}
                    onBlur={syncFromEditor}
                  />
                </div>
              )}
            </div>
          )}

          {/* ------- Web Story -------
              A story is its own reviewable content_item (migration 023), tied here by
              blueprint->>parent_article_id — it is NOT part of the article row, which is why
              this page showed nothing until 2026-09-18. Shown as the pages Mr. Story actually
              wrote; the AMP HTML itself is reviewed on the story's own page. */}
          <div ref={storyRef} className={`aa-story ${storyGlow ? "glow" : ""}`}>
            <div className="aa-story-head">
              <div>
                <div className="aa-story-t"><Clapperboard size={15} /> Web Story</div>
                <div className="aa-story-s">
                  {story
                    ? `${storyPages.length} page${storyPages.length === 1 ? "" : "s"} · ${STATUS_LABEL[story.status] ?? story.status}${story.meta?.ampValid === false ? " · AMP not valid yet" : ""}`
                    : "Mr. Story hasn't made one for this article yet."}
                </div>
              </div>
              {story && (
                <Link href={`/dashboard/content/${story.id}`} className="aa-btn">
                  Review story <ExternalLink size={13} />
                </Link>
              )}
            </div>

            {story && storyPages.length > 0 ? (
              <div className="aa-story-strip">
                {storyPages.map((pg, i) => (
                  <div key={i} className="aa-story-card">
                    {pg.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={pg.image} alt={pg.headline ?? `Page ${i + 1}`} />
                    ) : (
                      <div className="aa-story-noimg">No image</div>
                    )}
                    <div className="aa-story-scrim">
                      <div className="aa-story-h">{pg.headline ?? `Page ${i + 1}`}</div>
                      {pg.body && <div className="aa-story-b">{pg.body}</div>}
                    </div>
                    <span className="aa-story-n">{i + 1}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="aa-story-empty">
                {story
                  ? "This story has no pages stored."
                  : "Web Stories are made by Mr. Story after an article passes its gate. This draft never got one."}
              </p>
            )}
          </div>
        </div>

        {/* ------- right rail -------
            Deliberately narrow and quiet (owner, 2026-09-18: "kam se kam space lage"). The
            old bottom review bar — comment box, Change Status select, Approve / Request
            Changes / Reject row — is gone; its three actions live here as the one primary
            button plus two text links, and Request Changes opens the comment box inline. */}
        <aside className="aa-rail">
          {/* --- what you came here to do --- */}
          <div className="aa-box">
            {isLive ? (
              <a className="aa-live-btn" href={meta.publishedUrl!} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> View Published Article
              </a>
            ) : (
              <button className="aa-rail-btn" onClick={approve} disabled={!pending_ || !!busy || dirty}
                title={dirty ? "Save your changes first" : pending_ ? "Approve and publish this article" : "Only a pending article can be published"}>
                <Send size={14} /> {busy === "approve" ? "Publishing…" : "Approve & Publish"}
              </button>
            )}

            {pending_ && (
              <div className="aa-acts">
                <button className="aa-linkbtn" onClick={() => setAskOpen((o) => !o)} disabled={revising}>
                  {revising ? "Rewriting…" : "Request changes"}
                </button>
                <span className="aa-actsep" />
                <button className="aa-linkbtn danger" onClick={reject} disabled={!!busy}>Reject</button>
              </div>
            )}

            {pending_ && askOpen && (
              <div className="aa-ask">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="What should Mr. Writer change?"
                  disabled={revising}
                />
                <button className="aa-primary aa-ask-send" onClick={() => revise(comment)} disabled={!comment.trim() || revising}>
                  <Sparkles size={13} /> {revising ? "Rewriting…" : "Send to Mr. Writer"}
                </button>
              </div>
            )}
          </div>

          {/* --- what else this order produced. The images and the story are separate database
                rows, not part of the article; this is the only place on the page that says
                whether they exist at all. */}
          <div className="aa-box">
            <div className="aa-box-h">Assets</div>

            <button className={`aa-asset ${story ? "on" : ""}`} onClick={focusStory}
              title={story ? "Jump to the Web Story below" : "No Web Story was made for this article"}>
              <Clapperboard size={15} />
              <span className="aa-asset-t">{story ? "WebStory available" : "No WebStory"}</span>
              {story && <span className="aa-asset-n">{storyPages.length}</span>}
            </button>

            {articleImages.length > 0 ? (
              <>
                <div className="aa-asset-lbl">{articleImages.length} image{articleImages.length === 1 ? "" : "s"}</div>
                <div className="aa-thumbs">
                  {articleImages.map((m) => (
                    <a key={m.slot} href={m.url} target="_blank" rel="noreferrer" className="aa-thumb" title={`${m.slot} · ${m.alt ?? "no alt text"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt={m.alt ?? m.slot} />
                      <span>{m.slot}</span>
                    </a>
                  ))}
                </div>
              </>
            ) : (
              <p className="aa-muted">No images — Mr. Image hasn&apos;t made any for this article.</p>
            )}
          </div>

          {/* --- the facts, each on its own line so nothing has to be truncated --- */}
          <div className="aa-box">
            <div className="aa-box-h">Article Details</div>

            <div className="aa-badge" style={{ color: STATUS_COLOR[item.status] ?? "#6b7280", background: `${STATUS_COLOR[item.status] ?? "#6b7280"}14` }}>
              <i style={{ background: STATUS_COLOR[item.status] ?? "#6b7280" }} />
              {STATUS_LABEL[item.status] ?? item.status}
            </div>

            <div className="aa-stats">
              <div><b>{wordCount ? wordCount.toLocaleString() : "—"}</b><span>words</span></div>
              <div><b>{readMins}</b><span>min read</span></div>
              <div><b>{meta.sections ?? "—"}</b><span>sections</span></div>
              <div><b>{meta.links ?? "—"}</b><span>links</span></div>
            </div>

            <F label="Author" value="Mr. Writer" />
            <F label="Assigned by" value={meta.chosenBy === "user" ? "You" : meta.chosenBy === "auto" ? "Mr. Keyword" : "Not recorded"} />
            <F label="Category" value={category === "loading" ? "Loading…" : category ?? "Uncategorized"} />
            <F label="Primary keyword" value={item.primary_keyword ?? "—"} />

            <div className="aa-f">
              <div className="aa-k">Tags</div>
              {(meta.relatedKeywords ?? []).length ? (
                <div className="aa-tags">
                  {meta.relatedKeywords!.map((k) => <span key={k} className="aa-tag">{k}</span>)}
                </div>
              ) : (
                <div className="aa-muted">No related keywords recorded for this draft.</div>
              )}
            </div>

            <div className="aa-f">
              <div className="aa-k">Link preview</div>
              {isLive ? (
                <a href={meta.publishedUrl!} target="_blank" rel="noreferrer" className="aa-url-btn live" title={meta.publishedUrl!}>
                  <Lock size={11} className="shrink-0" /><span className="truncate">{meta.publishedUrl!.replace(/^https?:\/\//, "")}</span>
                  <ExternalLink size={11} className="ml-auto shrink-0" />
                </a>
              ) : (
                <span className="aa-url-btn" title={slug ? `Not live yet — this is where it will publish: /${slug}` : "The slug is decided when the article is published"}>
                  <Clock size={11} className="shrink-0" /><span className="truncate">{slug ? `/${slug}` : "slug decided at publish"}</span>
                  <span className="aa-url-tag">not live</span>
                </span>
              )}
            </div>

            <div className="aa-dates">
              <span>Created {fmtDate(item.created_at)}</span>
              <span>Updated {fmtDate(item.updated_at)}</span>
            </div>
          </div>

          {/* --- Mr. SEO --- */}
          <div className="aa-box">
            <div className="aa-box-h">SEO</div>
            {seo ? (
              <>
                <div className="aa-seo-head">
                  <svg width={48} height={48} viewBox="0 0 80 80" className="shrink-0">
                    <circle cx={40} cy={40} r={gaugeR} fill="none" stroke="#e8eaee" strokeWidth={9} />
                    <circle
                      cx={40} cy={40} r={gaugeR} fill="none" stroke={scoreColor(seo.score)} strokeWidth={9} strokeLinecap="round"
                      strokeDasharray={gaugeC} strokeDashoffset={gaugeC * (1 - seo.score / 100)}
                      transform="rotate(-90 40 40)"
                    />
                    <text x={40} y={48} textAnchor="middle" fontSize={27} fontWeight={800} fill="#111827">{seo.score}</text>
                  </svg>
                  <div className="min-w-0">
                    <div className="aa-seo-t">{seo.passed ? "Well optimized" : `${seo.issues.length} issue${seo.issues.length === 1 ? "" : "s"} to look at`}</div>
                    <div className="aa-seo-s">Mr. SEO · {seo.serpCompared ? "SERP compared" : "no SERP comparison"}</div>
                  </div>
                </div>

                <div className="aa-checks">
                  {categories.map((c) => (
                    <div key={c.label} className="aa-check">
                      {c.status === "pass" ? <CheckCircle2 size={14} style={{ color: "#16a34a" }} />
                        : c.status === "issue" ? <XCircle size={14} style={{ color: "#dc2626" }} />
                        : <MinusCircle size={14} style={{ color: "#c8ced6" }} />}
                      <span style={{ color: c.status === "unmeasured" ? "#9aa2ad" : "#3f4756" }}>{c.label}</span>
                    </div>
                  ))}
                </div>

                <button className="aa-linkbtn aa-report" onClick={() => setSeoReportOpen((o) => !o)}>
                  {seoReportOpen ? "Hide full report" : "View full report"}
                </button>
                {seoReportOpen && (
                  <div className="aa-issues">
                    {seo.issues.length ? seo.issues.map((iss) => (
                      <div key={iss.id} className="aa-issue">
                        <div className="aa-issue-t" style={{ color: iss.severity === "block" ? "#dc2626" : "#b45309" }}>
                          {iss.severity === "block" ? "Blocker" : "Warning"} · {iss.what}
                        </div>
                        {iss.fix && <div className="aa-issue-f">{iss.fix}</div>}
                      </div>
                    )) : <p className="aa-muted">No open issues — every measured check passed.</p>}
                  </div>
                )}
              </>
            ) : (
              <p className="aa-muted">Mr. SEO hasn&apos;t checked this draft yet.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** One formatting button. onMouseDown is swallowed so clicking it never drops the selection
 *  inside the editable article — without that, execCommand has nothing to format. */
function Tool({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="aa-tool" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

/** One rail fact. Label above, value below and free to wrap onto as many lines as it needs —
 *  the old right-aligned single line truncated real values ("ISO 9001 Consultancy Ed...") with
 *  no way to read the rest. */
function F({ label, value }: { label: string; value: string }) {
  return (
    <div className="aa-f">
      <div className="aa-k">{label}</div>
      <div className="aa-v">{value}</div>
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
/* THE WHOLE PAGE IS LIGHT (owner, 2026-09-18). It used to be the app's dark theme with a
   white article island inside a browser-chrome mock; now the reviewer itself reads like the
   published post — white sheet, grey canvas, one quiet top bar and a card-based rail.
   The dark .lx-root shell is NOT mounted here any more, so every --lx-* token this file (and
   the page's error card) still uses is redefined below with light values; the only thing that
   comes from LxGlobalStyle is the Inter webfont and the shared .lx-* utility classes.

   Breakpoints are plain media queries again — the dashboard shell used to own this page's
   width, so they had to be CONTAINER queries; now the page owns the viewport. */
.aa-wrap{
  --lx-border:#e5e7eb;
  --lx-mut:#6b7280;
  --lx-dim:#9aa2ad;
  --lx-in:#f3f4f6;
  --lx-cyan:#0e7490;
  --lx-card:#fff;
  --aa-bar-h:47px;
  min-height:100vh;background:#f2f4f7;color:#111827;
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.aa-wrap *{box-sizing:border-box}

/* ---- top bar ---- */
.aa-bar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:8px;
  padding:9px 18px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid #e5e7eb}
.aa-cbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex-shrink:0;border-radius:8px;
  background:none;border:none;color:#6b7280;cursor:pointer;transition:.15s}
.aa-cbtn:hover:not(:disabled){color:#111827;background:#eef0f4}
.aa-cbtn:disabled{opacity:.3;cursor:not-allowed}
.aa-cbtn.on{color:#4f46e5;background:#eef2ff}
.aa-url{display:flex;align-items:center;gap:6px;flex:1;min-width:0;max-width:520px;height:28px;padding:0 12px;border-radius:14px;
  background:#f3f4f6;border:1px solid #e5e7eb;font-size:11.5px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.aa-url.editing{background:#fff;border-color:#a5b4fc;box-shadow:0 0 0 3px rgba(99,102,241,.12);padding:0 4px 0 12px}
.aa-url-fixed{flex-shrink:0;color:#9aa2ad}
.aa-url input{flex:1;min-width:60px;border:none;outline:none;background:none;color:#111827;
  font-family:inherit;font-size:11.5px}
.aa-url-edit{display:none;align-items:center;justify-content:center;width:19px;height:19px;flex-shrink:0;
  margin-left:auto;border:none;border-radius:5px;background:none;color:#9aa2ad;cursor:pointer}
.aa-url:hover .aa-url-edit{display:inline-flex}
.aa-url-edit:hover{color:#4f46e5;background:#eef2ff}
.aa-url-ok,.aa-url-x{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex-shrink:0;
  border:none;border-radius:6px;background:none;cursor:pointer}
.aa-url-ok{color:#4f46e5}
.aa-url-ok:hover:not(:disabled){background:#eef2ff}
.aa-url-x{color:#9aa2ad}
.aa-url-x:hover{background:#f3f4f6;color:#111827}
.aa-chip{display:inline-flex;align-items:center;gap:5px;flex-shrink:0;font-size:11.5px;font-weight:600;white-space:nowrap}
.aa-chip i{width:6px;height:6px;border-radius:50%;display:inline-block;flex-shrink:0}
@media (max-width:760px){.aa-chip-t{display:none}.aa-bar{padding:8px 12px}}
.aa-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:40;min-width:186px;padding:6px;border-radius:12px;
  background:#fff;border:1px solid #e5e7eb;box-shadow:0 12px 32px rgba(15,23,42,.14)}
.aa-menu>*{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border-radius:8px;border:none;background:none;
  color:#374151;font-size:12.5px;cursor:pointer;text-align:left;text-decoration:none}
.aa-menu>*:hover{background:#f3f4f6;color:#111827}

/* ---- layout: the article sheet, and the rail beside it ---- */
.aa-grid{display:grid;grid-template-columns:minmax(0,1fr) 268px;gap:24px;align-items:start;
  max-width:1240px;margin:0 auto;padding:24px 20px 72px}
@media (max-width:1000px){.aa-grid{grid-template-columns:minmax(0,1fr);gap:18px;padding:18px 12px 48px}}
.aa-sheet{background:#fff;border:1px solid #e8eaee;border-radius:12px;
  box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.05)}
/* NOT overflow:hidden. A sticky child cannot stick past a clipping ancestor, and that is
   exactly what overflow:hidden here made the sheet — the editor toolbar scrolled away with
   the text. The sheet only ever clipped to round its corners, so the corners are rounded on
   the edge children instead and the sheet clips nothing. */
.aa-sheet>*:first-child{border-top-left-radius:11px;border-top-right-radius:11px}
.aa-sheet>*:last-child{border-bottom-left-radius:11px;border-bottom-right-radius:11px}

/* ---- the article itself ---- */
.aa-hero{padding:44px 48px 26px}
@media (max-width:640px){.aa-hero{padding:28px 20px 18px}}
.aa-hero-title{margin:0;font-size:34px;font-weight:800;line-height:1.2;color:#0f172a;letter-spacing:-.022em;max-width:680px}
@media (max-width:640px){.aa-hero-title{font-size:26px}}
.aa-hero-sub{margin:14px 0 0;max-width:620px;font-size:15px;line-height:1.6;color:#4b5563}
.aa-hero-meta{margin-top:18px;font-size:12.5px;color:#8b93a1}
.aa-page{background:#fff}
.lxpv-article{max-width:720px;margin:0 auto;padding:22px 48px 52px}
@media (max-width:640px){.lxpv-article{padding:16px 20px 36px}}
.aa-empty{padding:40px;text-align:center;font-size:13px;color:#6b7280}

/* ---- pictures. Real media rows only — this page never renders a placeholder. ---- */
.aa-lead{margin:0;padding:0 48px}
@media (max-width:640px){.aa-lead{padding:0 20px}}
.aa-lead img{display:block;width:100%;border-radius:10px;background:#f3f4f6}
.aa-lead figcaption{margin-top:8px;font-size:11.5px;color:#8b93a1;line-height:1.5}
.aa-fig{margin:24px 0}
.aa-fig img{display:block;width:100%;border-radius:10px;background:#f3f4f6}
.aa-fig figcaption{margin-top:7px;font-size:11.5px;color:#8b93a1;line-height:1.5}

/* ---- edit mode. The toolbar sticks under the top bar so Save and every control stay
       reachable no matter how far down the article you are typing (owner, 2026-09-18). ---- */
.aa-tools{position:sticky;top:var(--aa-bar-h);z-index:20;display:flex;flex-wrap:wrap;align-items:center;gap:4px;
  padding:8px 12px;background:#fbfcfd;border-bottom:1px solid #eef0f3}
.aa-tool{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;
  background:none;border:none;color:#5b6472;cursor:pointer;transition:.15s}
.aa-tool:hover{color:#111827;background:#eceff3}
.aa-tool-sep{width:1px;height:18px;margin:0 4px;background:#e2e5ea}
.aa-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;white-space:nowrap;
  background:#fff;border:1px solid #dfe3e8;color:#374151;font-size:12.5px;font-weight:600;cursor:pointer;
  transition:.15s;text-decoration:none}
.aa-btn:hover:not(:disabled){color:#111827;border-color:#c7cdd6;background:#f7f8fa}
.aa-btn:disabled{opacity:.45;cursor:not-allowed}
.aa-btn.on{color:#4f46e5;border-color:#c7d2fe;background:#eef2ff}
.aa-primary{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 16px;border-radius:8px;
  background:#4f46e5;border:none;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.aa-primary:hover:not(:disabled){background:#4338ca}
.aa-primary:disabled{opacity:.45;cursor:not-allowed}
.aa-linkbar{position:sticky;top:calc(var(--aa-bar-h) + 45px);z-index:19;display:flex;align-items:center;gap:6px;
  padding:8px 12px;background:#fbfcfd;border-bottom:1px solid #eef0f3}
.aa-linkbar input{flex:1;min-width:0;height:30px;padding:0 10px;border-radius:8px;background:#fff;
  border:1px solid #dfe3e8;color:#111827;font-size:12px;outline:none}
.aa-linkbar input:focus{border-color:#a5b4fc}
.aa-hero-input{display:block;width:100%;max-width:680px;background:none;border:none;outline:none;overflow:hidden;
  resize:none;color:#0f172a;letter-spacing:-.022em;font-family:inherit;
  font-size:34px;font-weight:800;line-height:1.2;border-bottom:1px dashed #d4d8de;padding:0 0 4px}
@media (max-width:640px){.aa-hero-input{font-size:26px}}
.aa-hero-input:focus{border-bottom-color:#818cf8}
.aa-editable{outline:none;min-height:40vh}
.aa-source{display:block;width:100%;min-height:60vh;padding:20px 48px 40px;border:none;outline:none;resize:vertical;
  color:#1f2937;font-size:13.5px;line-height:1.7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

/* ---- Web Story, under the article ---- */
.aa-story{margin-top:18px;padding:16px 18px;background:#fff;border:1px solid #e8eaee;border-radius:12px;
  box-shadow:0 1px 2px rgba(15,23,42,.04);transition:box-shadow .3s,border-color .3s;scroll-margin-top:72px}
.aa-story.glow{border-color:#a5b4fc;box-shadow:0 0 0 4px rgba(99,102,241,.16)}
.aa-story-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.aa-story-t{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:700;color:#111827}
.aa-story-s{margin-top:3px;font-size:11.5px;color:#8b93a1}
.aa-story-strip{display:flex;gap:10px;overflow-x:auto;padding:14px 2px 4px;scrollbar-width:thin}
.aa-story-card{position:relative;flex:0 0 132px;height:234px;border-radius:10px;overflow:hidden;background:#111827;
  border:1px solid #e2e5ea}
.aa-story-card img{width:100%;height:100%;object-fit:cover;display:block}
.aa-story-noimg{display:flex;align-items:center;justify-content:center;height:100%;font-size:11px;color:#9aa2ad;background:#f3f4f6}
.aa-story-scrim{position:absolute;inset:auto 0 0 0;padding:26px 9px 9px;
  background:linear-gradient(transparent,rgba(0,0,0,.82))}
.aa-story-h{font-size:11.5px;font-weight:700;color:#fff;line-height:1.3}
.aa-story-b{margin-top:3px;font-size:10px;color:rgba(255,255,255,.78);line-height:1.4;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.aa-story-n{position:absolute;top:7px;left:7px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;
  display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;background:rgba(0,0,0,.55)}
.aa-story-empty{margin-top:10px;font-size:12px;color:#8b93a1;line-height:1.55}

/* ---- right rail: cards, not one long list ---- */
.aa-rail{position:sticky;top:calc(var(--aa-bar-h) + 16px);display:flex;flex-direction:column;gap:12px;min-width:0;
  max-height:calc(100vh - var(--aa-bar-h) - 32px);overflow-y:auto;scrollbar-width:thin}
@media (max-width:1000px){.aa-rail{position:static;max-height:none;overflow:visible}}
.aa-box{display:flex;flex-direction:column;gap:9px;padding:13px;background:#fff;border:1px solid #e8eaee;
  border-radius:12px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.aa-box-h{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9aa2ad}
.aa-rail-btn,.aa-live-btn{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;height:38px;
  border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:#4f46e5;color:#fff;
  text-decoration:none;transition:.15s}
.aa-rail-btn:hover:not(:disabled){background:#4338ca}
.aa-rail-btn:disabled{opacity:.4;cursor:not-allowed}
.aa-live-btn{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0}
.aa-live-btn:hover{background:#d1fae5}
.aa-acts{display:flex;align-items:center;justify-content:center;gap:10px}
.aa-actsep{width:1px;height:12px;background:#dfe3e8}
.aa-linkbtn{padding:0;background:none;border:none;color:#4f46e5;font-size:11.5px;font-weight:600;cursor:pointer}
.aa-linkbtn:hover:not(:disabled){text-decoration:underline}
.aa-linkbtn:disabled{opacity:.45;cursor:not-allowed}
.aa-linkbtn.danger{color:#dc2626}
.aa-ask{display:flex;flex-direction:column;gap:7px}
.aa-ask textarea{width:100%;min-height:74px;padding:9px 10px;border-radius:9px;background:#fff;border:1px solid #dfe3e8;
  color:#111827;font-size:12px;line-height:1.55;outline:none;resize:vertical;font-family:inherit}
.aa-ask textarea:focus{border-color:#a5b4fc}
.aa-ask textarea::placeholder{color:#9aa2ad}
.aa-ask-send{width:100%}

/* assets */
.aa-asset{display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;border-radius:9px;
  background:#f7f8fa;border:1px solid #e8eaee;color:#9aa2ad;font-size:12.5px;font-weight:600;
  cursor:default;text-align:left;transition:.15s}
.aa-asset.on{background:#eef2ff;border-color:#c7d2fe;color:#4338ca;cursor:pointer}
.aa-asset.on:hover{background:#e0e7ff}
.aa-asset-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aa-asset-n{flex-shrink:0;min-width:19px;height:19px;padding:0 6px;border-radius:10px;display:inline-flex;
  align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:#fff;background:#4f46e5}
.aa-asset-lbl{font-size:11px;color:#8b93a1}
.aa-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.aa-thumb{position:relative;display:block;aspect-ratio:16/10;border-radius:7px;overflow:hidden;
  border:1px solid #e8eaee;background:#f3f4f6;text-decoration:none}
.aa-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.aa-thumb span{position:absolute;inset:auto 0 0 0;padding:8px 4px 2px;font-size:8.5px;font-weight:700;color:#fff;
  text-align:center;background:linear-gradient(transparent,rgba(0,0,0,.7));
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* details */
.aa-badge{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;padding:4px 9px;border-radius:7px;
  font-size:11.5px;font-weight:700}
.aa-badge i{width:6px;height:6px;border-radius:50%;display:inline-block}
.aa-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:9px 0;
  border-top:1px solid #eef0f3;border-bottom:1px solid #eef0f3}
.aa-stats>div{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:0}
.aa-stats b{font-size:14px;font-weight:700;color:#111827;line-height:1.1}
.aa-stats span{font-size:9.5px;color:#9aa2ad;text-align:center}
.aa-f{display:flex;flex-direction:column;gap:3px;min-width:0}
.aa-k{font-size:10.5px;font-weight:600;letter-spacing:.02em;color:#9aa2ad}
.aa-v{font-size:12.5px;font-weight:600;color:#1f2937;line-height:1.45;overflow-wrap:anywhere}
.aa-tags{display:flex;flex-wrap:wrap;gap:4px}
.aa-tag{display:inline-flex;align-items:center;padding:2px 7px;border-radius:5px;font-size:10.5px;font-weight:600;
  color:#4b5563;background:#f3f4f6;border:1px solid #e8eaee}
.aa-url-btn{display:flex;align-items:center;gap:6px;width:100%;height:29px;padding:0 9px;border-radius:8px;
  background:#f7f8fa;border:1px solid #e8eaee;color:#6b7280;font-size:10.5px;text-decoration:none;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.aa-url-btn.live{color:#047857;border-color:#a7f3d0;background:#ecfdf5}
.aa-url-btn.live:hover{background:#d1fae5}
.aa-url-tag{margin-left:auto;flex-shrink:0;padding:1px 5px;border-radius:5px;font-family:inherit;font-size:9px;
  font-weight:700;color:#b45309;background:#fef3c7}
.aa-dates{display:flex;flex-direction:column;gap:2px;padding-top:8px;border-top:1px solid #eef0f3;
  font-size:10.5px;color:#9aa2ad}

/* seo */
.aa-seo-head{display:flex;align-items:center;gap:10px}
.aa-seo-t{font-size:12.5px;font-weight:700;color:#111827;line-height:1.35}
.aa-seo-s{margin-top:2px;font-size:10.5px;color:#9aa2ad}
.aa-checks{display:flex;flex-direction:column;gap:6px;padding-top:9px;border-top:1px solid #eef0f3}
.aa-check{display:flex;align-items:center;gap:7px;font-size:12px}
.aa-report{align-self:flex-start}
.aa-issues{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto}
.aa-issue{padding:9px;border-radius:8px;background:#fafbfc;border:1px solid #eef0f3}
.aa-issue-t{font-size:11px;font-weight:700;line-height:1.4}
.aa-issue-f{margin-top:3px;font-size:10.5px;color:#6b7280;line-height:1.45}
.aa-muted{font-size:11.5px;color:#9aa2ad;line-height:1.5}

/* ---- article typography (palette was already written for a white page) ---- */
.lxpv-article h1{display:none}
.lxpv-article h2{font-size:22px;font-weight:800;margin:32px 0 12px;color:#111827;letter-spacing:-.01em}
.lxpv-article h3{font-size:17px;font-weight:700;margin:22px 0 8px;color:#111827}
.lxpv-article p{color:#33333f;line-height:1.8;margin:0 0 18px;font-size:16px}
.lxpv-article ul{margin:0 0 18px;padding:0;list-style:none}
.lxpv-article li{position:relative;padding-left:26px;margin-bottom:12px;color:#33333f;font-size:16px;line-height:1.7}
.lxpv-article li::before{content:"";position:absolute;left:6px;top:10px;width:6px;height:6px;border-radius:50%;background:#7c3aed}
.lxpv-article a{color:#4f46e5;text-decoration:underline}
.lxpv-article strong{color:#0c0c15}
.lxpv-article img{max-width:100%;border-radius:10px;margin:18px 0}
.lxpv-article table{width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14.5px}
.lxpv-article th,.lxpv-article td{border:1px solid #e5e7eb;padding:9px 12px;text-align:left;color:#33333f}
.lxpv-article th{background:#f8f9fb;font-weight:700;color:#111827}
.lxpv-article blockquote{margin:0 0 18px;padding:2px 0 2px 16px;border-left:3px solid #ddd;color:#4b5563}
`;
