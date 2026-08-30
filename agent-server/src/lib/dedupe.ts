import { supabase } from "../supabase.js";

/** The duplicate locks (rebuild plan §25.5). Today there is nothing here at all: ask twice
 *  for "an article about ISO 9001 cost" and you get two articles, and a topic the site
 *  already has a perfectly good page for gets written again from scratch.
 *
 *  The plan has three locks. This file is Phase 1, which is locks 1 and 3:
 *
 *    1 · SLUG / TITLE EXACT — the proposed slug already exists as a content_item, or as the
 *        last segment of a crawled page's URL. Cheap, exact, no model involved.
 *    2 · SEMANTIC (embedding) — Phase 2, see the TODO at the bottom of this file.
 *    3 · QUEUE / LOCK — the same topic is already queued or running. This is the one lock
 *        the product has today, and it is expressed in two places (see findRunningTaskFor).
 *
 *  All three answer the same question — "should we start writing this?" — so they are behind
 *  one call, `checkDuplicate`, and the answer is a verdict the caller can act on rather than
 *  a boolean. "exists" is not a failure: the right response is to offer to UPDATE the page,
 *  which is what a user asking for a second article about the same thing usually wants.
 */

// A slug is a URL. 80 characters is long enough for any real title and short enough that the
// URL stays readable and quotable; WordPress's own limit (200) produces links nobody can read.
const MAX_SLUG = 80;

// jobs_log has no "this job died" state: a process killed mid-write leaves status='running'
// forever. Without a window, one crashed job would block its topic for the life of the
// database. Six hours is far longer than any real job (the longest, a 300-page crawl, is
// capped at one hour by pg-boss) and short enough that a stuck row clears the same day.
const RUNNING_WINDOW_MS = 6 * 60 * 60 * 1000;

// tasks (migration 017) states that mean "this work has not been delivered yet". awaiting_
// approval is included on purpose: the article exists and is sitting in the approval queue,
// so writing a second one is exactly the duplicate we are here to prevent.
const TASK_ACTIVE_STATUSES = ["awaiting_confirm", "queued", "scheduled", "running", "choosing", "awaiting_approval"] as const;

// ── slug ────────────────────────────────────────────────────────────────────────────────────

// Characters that JOIN the words on either side of them instead of splitting them: the ASCII
// apostrophe and the four look-alikes a word processor or a CMS will hand us. "company's
// guide" has to become "companys-guide", never "company-s-guide". Written as code points so
// this source file stays plain ASCII — a pasted U+2019 is invisible in a diff and a combining
// mark in a character class is worse.
const JOINING_MARKS = new Set([0x27, 0x60, 0x00b4, 0x2018, 0x2019, 0x02bc]);
// Combining diacritics, i.e. what NFKD leaves behind after it splits "é" into "e" + U+0301.
const COMBINING_FIRST = 0x0300;
const COMBINING_LAST = 0x036f;
// "&" and its full-width twin, both spelled out so "sales & marketing" and "sales and
// marketing" produce the same slug and therefore collide, which is the correct outcome.
const AMPERSANDS = new Set([0x26, 0xff06]);

/** A title turned into the URL segment it would be published at.
 *
 *  Deliberate choices, each one a real case:
 *   · accented Latin is folded to ASCII (NFKD, then the combining marks dropped), so "Café"
 *     and "Cafe" cannot both be published — to a reader and to Google they are one page;
 *   · "&" becomes "and" rather than vanishing, because "sales & marketing" and "sales
 *     marketing" are the same topic and must collide;
 *   · apostrophes JOIN rather than split: "company's guide" → "companys-guide", not
 *     "company-s-guide";
 *   · any other character with no ASCII equivalent becomes a separator, so a script we cannot
 *     transliterate (Devanagari, Arabic, CJK) yields "" — an honest "I cannot make a slug
 *     from this" rather than a string of hyphens. Callers must treat "" as "no slug lock
 *     available" (content_items.slug stays null, and migration 019's unique index is partial
 *     precisely so those rows do not collide with each other).
 *
 *  Stable: same title in, same slug out, no randomness and no counter. Uniqueness is the
 *  database's job (content_items_tenant_slug), not this function's. */
export function slugify(title: string | null | undefined): string {
  const raw = String(title ?? "");
  if (!raw.trim()) return "";

  const out: string[] = [];
  for (const ch of raw.normalize("NFKD")) {
    const code = ch.codePointAt(0) ?? 0;
    if (JOINING_MARKS.has(code)) continue;
    if (code >= COMBINING_FIRST && code <= COMBINING_LAST) continue;
    if (AMPERSANDS.has(code)) { out.push(" and "); continue; }
    out.push(code < 128 ? ch : " ");
  }
  const folded = out.join("").toLowerCase();

  const hyphenated = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (hyphenated.length <= MAX_SLUG) return hyphenated;

  // Cut at a word boundary, never mid-word: "…-certificati" reads like a bug in the URL bar.
  const window = hyphenated.slice(0, MAX_SLUG + 1);
  const lastDash = window.lastIndexOf("-");
  const cut = lastDash > 0 ? window.slice(0, lastDash) : hyphenated.slice(0, MAX_SLUG);
  return cut.replace(/-+$/, "");
}

/** The slug a URL is published at: last path segment, extension and trailing slash removed.
 *  Exported because the site_pages half of lock 1 is exactly this comparison. */
export function slugOfUrl(url: string | null | undefined): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    // Not an absolute URL — treat what we were given as a path. Query/hash still have to go.
    pathname = raw.split("#")[0].split("?")[0];
  }
  const parts = pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  let segment = last;
  try {
    segment = decodeURIComponent(last);
  } catch {
    /* a stray % in the path is not worth failing over */
  }
  return slugify(segment.replace(/\.(html?|php|aspx?)$/i, ""));
}

// ── lock 1: slug already taken ──────────────────────────────────────────────────────────────

export type ExistingMatch = {
  where: "content_items" | "site_pages";
  url: string | null;
  item_id: string | null;
  title: string | null;
};

/** LOCK 1. Is this slug already ours — either as something we wrote, or as a page that was
 *  on the site before we ever arrived?
 *
 *  Both halves matter and the second is the one people forget: a business that already has
 *  /iso-9001-cost does not need us to write it a second one, it needs that page expanded.
 *
 *  content_items wins over site_pages when both match, because a content_item carries the
 *  draft we would be duplicating and gives the caller an id to offer "update this instead". */
export async function findExistingBySlug(tenantId: string, slug: string): Promise<ExistingMatch | null> {
  const wanted = slugify(slug);
  // No slug means no lock — see slugify(). Saying "free" here is correct: lock 2 (Phase 2)
  // is what catches a non-Latin title, and pretending otherwise would block every such title.
  if (!wanted) return null;

  const { data: items, error: itemsError } = await supabase
    .from("content_items")
    .select("id, title, slug, meta, status")
    .eq("tenant_id", tenantId)
    .eq("slug", wanted)
    .limit(1);

  if (itemsError) {
    // Migration 019 not applied yet (no slug column). Not fatal — fall through to site_pages
    // so the half of the lock that CAN work still works.
    console.error("[dedupe] content_items slug lookup failed:", itemsError.message);
  } else if (items?.length) {
    const it: any = items[0];
    return {
      where: "content_items",
      url: (it.meta?.url as string) ?? (it.meta?.link as string) ?? null,
      item_id: String(it.id),
      title: it.title ?? null,
    };
  }

  // site_pages stores whole URLs, so the last segment has to be compared in TypeScript. The
  // ilike list is only a prefilter to avoid pulling every crawled page; the real check is
  // slugOfUrl() below it. `wanted` is [a-z0-9-] by construction, so it cannot break out of
  // the PostgREST or() syntax.
  const patterns = [`url.ilike.%/${wanted}`, `url.ilike.%/${wanted}/`, `url.ilike.%/${wanted}.%`].join(",");
  const { data: pages, error: pagesError } = await supabase
    .from("site_pages")
    .select("id, url, title")
    .eq("tenant_id", tenantId)
    .or(patterns)
    .limit(20);

  if (pagesError) {
    console.error("[dedupe] site_pages slug lookup failed:", pagesError.message);
    return null;
  }

  const hit = (pages ?? []).find((p: any) => slugOfUrl(p.url) === wanted);
  if (!hit) return null;

  return { where: "site_pages", url: (hit as any).url ?? null, item_id: null, title: (hit as any).title ?? null };
}

// ── lock 3: already queued or running ───────────────────────────────────────────────────────

export type RunningMatch = {
  task_id: string;
  /** Which of the two systems the lock came from — the caller links to a different screen. */
  source: "tasks" | "jobs_log";
  label: string | null;
  status: string | null;
};

/** LOCK 3. Is this topic already in flight?
 *
 *  It has to look in two places, because the product is mid-rebuild and "a job is running"
 *  is currently expressed twice:
 *
 *    · `tasks` (migration 017) — the new brain's unit of work, with the topic in
 *      params.topic and an explicit status. This is where the lock belongs long term.
 *    · `jobs_log` — what actually runs today. Every agent writes a row with status='running'
 *      and the human task text in `action` ("Researching \"ISO 9001 cost\""), which is where
 *      the topic can still be recognised.
 *
 *  Matching is on the slug of the topic, not on the raw string, so "ISO 9001 Cost" and
 *  "iso-9001 cost" are the same topic — the same normalisation lock 1 uses, for the same
 *  reason. jobs_log's `action` wraps the topic in other words, so containment (either way
 *  round) is the test there; tasks.params.topic is the topic itself, so it is compared whole.
 */
export async function findRunningTaskFor(tenantId: string, topic: string, excludeTaskId?: string | null): Promise<RunningMatch | null> {
  const wanted = slugify(topic);
  if (!wanted) return null;
  const since = new Date(Date.now() - RUNNING_WINDOW_MS).toISOString();

  // 1 · tasks — the real idempotency lock (§9). Missing table = 017 not applied; not an error.
  // `excludeTaskId` is the task this very step is running inside of, via the brain: its own row
  // is already `status='running'` by the time the writer's step executes (the orchestrator
  // flips a task to "running" as soon as its first step starts), so without this exclusion
  // EVERY brain-routed article found itself "already in progress" and refused to write, 100%
  // of the time (found live 2026-08-31 — chat-ordered articles never wrote a single word,
  // Approvals only ever filled from scheduled/legacy runs that never created a `tasks` row to
  // begin with, so they never collided with themselves).
  let query = supabase
    .from("tasks")
    .select("id, kind, params, status, echo, created_at")
    .eq("tenant_id", tenantId)
    .in("status", TASK_ACTIVE_STATUSES as unknown as string[])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);
  if (excludeTaskId) query = query.neq("id", excludeTaskId);
  const { data: tasks, error: tasksError } = await query;

  if (tasksError) {
    console.error("[dedupe] tasks lookup skipped:", tasksError.message);
  } else {
    const hit = (tasks ?? []).find((t: any) => {
      const candidate = slugify(String(t?.params?.topic ?? t?.params?.keyword ?? t?.params?.title ?? ""));
      return !!candidate && candidate === wanted;
    });
    if (hit) {
      return { task_id: String((hit as any).id), source: "tasks", label: (hit as any).echo ?? null, status: (hit as any).status ?? null };
    }
  }

  // 2 · jobs_log — today's reality. Only 'queued'/'running' rows, only recent ones.
  const { data: jobs, error: jobsError } = await supabase
    .from("jobs_log")
    .select("id, agent, action, status, created_at")
    .eq("tenant_id", tenantId)
    .in("status", ["queued", "running"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);

  if (jobsError) {
    console.error("[dedupe] jobs_log lookup failed:", jobsError.message);
    return null;
  }

  const job = (jobs ?? []).find((j: any) => {
    const action = slugify(String(j?.action ?? ""));
    if (!action) return false;
    // Either direction: the label may be longer than the topic ("Researching iso-9001-cost")
    // or shorter ("iso-9001" when the topic is "iso 9001 cost in india").
    return action.includes(wanted) || wanted.includes(action);
  });
  if (!job) return null;

  return { task_id: String((job as any).id), source: "jobs_log", label: (job as any).action ?? null, status: (job as any).status ?? null };
}

// ── the one call ────────────────────────────────────────────────────────────────────────────

export type DuplicateVerdict =
  | { status: "free" }
  | { status: "exists"; where: "content_items" | "site_pages"; url: string | null; item_id: string | null; title?: string | null; slug: string }
  | { status: "in_progress"; task_id: string; source?: "tasks" | "jobs_log"; label?: string | null };

/** Should we start writing this? One call, one verdict, no LLM anywhere in it.
 *
 *  Order is deliberate. "Already in flight" is checked FIRST because it is the cheaper
 *  mistake to make loudly ("that is already running, here it is") and because a job that
 *  started thirty seconds ago has not written its content_item yet — checking slugs first
 *  would report "free" for a topic being written at that exact moment.
 *
 *  `title` is what would be published (used for the slug); `topic` is what the user asked
 *  for (used for the in-flight match). When only one is known, pass it as both. */
export async function checkDuplicate(
  tenantId: string,
  { title, topic, excludeTaskId }: { title?: string | null; topic?: string | null; excludeTaskId?: string | null }
): Promise<DuplicateVerdict> {
  const forSlug = String(title ?? topic ?? "").trim();
  const forTopic = String(topic ?? title ?? "").trim();

  if (forTopic) {
    const running = await findRunningTaskFor(tenantId, forTopic, excludeTaskId);
    if (running) return { status: "in_progress", task_id: running.task_id, source: running.source, label: running.label };
  }

  const slug = slugify(forSlug);
  if (slug) {
    const existing = await findExistingBySlug(tenantId, slug);
    if (existing) {
      return { status: "exists", where: existing.where, url: existing.url, item_id: existing.item_id, title: existing.title, slug };
    }
  }

  return { status: "free" };
}

// TODO(Phase 2) — LOCK 2, semantic duplicate (plan §25.5).
//
// Embed the proposed topic and compare it (cosine) against content_items.embedding for every
// draft/published item AND against site_pages.embedding, both added/indexed by migration 019.
// The plan's thresholds, to be used as written:
//
//     cosine ≥ 0.86          → duplicate. Do not write. Offer "update the existing page".
//     0.75 ≤ cosine < 0.86   → very close. Ask the user: expand the existing page, or write a
//                              genuinely different angle?
//     cosine < 0.75          → free.
//
// Not wired here on purpose: it costs one embedding call per check, it needs the backfill that
// fills content_items.embedding for everything written before 019, and it must run at intent-
// resolution time (in chat, before the user is told "on it") rather than inside this file's
// callers. Doing it half-way — checking only new items, or only at write time — would produce
// a lock that fires inconsistently, which is worse than one that does not fire at all.
