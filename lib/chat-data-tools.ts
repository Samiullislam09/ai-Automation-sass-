/** lib/chat-data-tools.ts — the tools Mr Lxwa calls to LOOK THINGS UP.
 *
 *  WHY THIS EXISTS. Until 2026-09-19 this product's chat could order work but could not read
 *  anything. lib/chat-tools.ts built one tool per agent action (write_article, audit_site,
 *  find_leads…) plus a single catch-all, `answer_question`, whose own description says it
 *  "starts nothing and costs nothing". So a question fell through to a free-form model call
 *  carrying a fixed, pre-baked context blob, and the model was trusted to find the right fact
 *  inside it. Four real replies from that day, with the correct numbers already in the blob:
 *
 *      "kitne post ha"        → "PUBLISHED = 0"                    (a raw context line, echoed)
 *      "pura details do"      → "Published posts: 0: 0 / Drafts: 0 /
 *                                Total tokens used this cycle: 0"  (a format it invented; there
 *                                                                   is no token counter here)
 *      "kiya status ha"       → "Abhi 2 articles ready hain"       (14 were awaiting approval)
 *      "site pe koi error ha" → "audit aaj hi ho chuka hai"        (18 issues sat unread)
 *
 *  THE FIX THAT WAS TRIED FIRST, AND WHY IT WAS WRONG. The first attempt matched these
 *  questions with regexes and wrote the answers in code. It made the numbers right and
 *  everything else worse: "pura details do yar" matched nothing, every new phrasing needed a
 *  new pattern, and "draft pe approval pe kitna ha" — a narrow question — got a fixed
 *  full-report blob back because the wording was frozen in a template. The owner's objection
 *  was the correct one: hardcoding answers is not how an assistant should work.
 *
 *  SO: TOOLS. The model keeps the language — understanding a Hinglish question, deciding what
 *  it needs, phrasing the reply — and loses the ability to invent a number, because the numbers
 *  arrive as a tool result it did not write. This is the same split the rest of the file tree
 *  already uses for actions; it was simply never extended to reading.
 *
 *  WHAT STAYS DETERMINISTIC, AND WHY THAT IS NOT A CONTRADICTION. lib/chat-no-data.ts still
 *  refuses, in code, to answer a metric we have no source for, and lib/chat-intent.ts still
 *  guards publishing. Those are safety properties: the cost of being wrong is unbounded and
 *  the right answer is a refusal, not a sentence. Answering a question we CAN answer is a
 *  phrasing problem, and phrasing belongs to the model.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatTool } from "@/lib/chat-tools";

/* ── The tools, as the model sees them ───────────────────────────────────────────────────── */

/** Read tools are prefixed so `isReadTool` never has to know the list, and so an agent action
 *  can never collide with one. Nothing here writes, enqueues, or spends money — which is why
 *  none of them need the confirmation machinery an action carries. */
export const READ_PREFIX = "lookup_";

export const LOOKUP_CONTENT = "lookup_content";
export const LOOKUP_AUDIT = "lookup_site_audit";
export const LOOKUP_PAGES = "lookup_site_pages";
export const LOOKUP_ANALYTICS = "lookup_analytics";
export const LOOKUP_SCHEDULE = "lookup_schedule";
export const LOOKUP_BUSINESS = "lookup_business_profile";

export function isReadTool(name: string | null | undefined): boolean {
  return typeof name === "string" && name.startsWith(READ_PREFIX);
}

/** Every read tool, with the shared "never for orders" rule welded on. Exported as READ_TOOLS
 *  below so callers cannot get the raw list by accident. */
function withOrderGuard(tools: ChatTool[]): ChatTool[] {
  return tools.map((t) => ({
    ...t,
    function: { ...t.function, description: t.function.description + NEVER_FOR_ORDERS },
  }));
}

/** Appended to EVERY read tool's description.
 *
 *  Measured 2026-09-19, and the reason this is a shared constant rather than a sentence in one
 *  description: once read tools existed, explicit ORDERS started landing on them. "isko publish
 *  kar do" — an unambiguous instruction to publish — chose `lookup_content` twice out of three
 *  runs, because that tool's description contains the word "published". A lookup that swallows
 *  an order is worse than a lookup that is never called: the customer is told what exists and
 *  the thing they asked for never happens.
 *
 *  Per-tool wording could not carry this. The audit tool got its own version of the rule first
 *  and it worked there, which is exactly why it belongs on all six rather than on whichever one
 *  happened to be noticed. */
const NEVER_FOR_ORDERS =
  " THIS TOOL ONLY READS. If the customer is TELLING you to do something — write, publish, " +
  "approve, reject, run, re-run, schedule, delete, fix — call the matching ACTION tool instead, " +
  "even when the words overlap with this one. Reading is for questions; orders are work.";

/** Descriptions are written for a model reading Hinglish, so each one carries the customer's
 *  own words. "kitne post ha" matches nothing English-shaped, and that gap is exactly how these
 *  questions ended up being answered from imagination. */
const RAW_READ_TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: LOOKUP_CONTENT,
      description:
        "Look up the articles and other content this workspace has produced: how many exist, what state each is in " +
        "(published, awaiting the customer's approval, failed the quality gate, still a draft), and their titles. " +
        'Call this for "kitne article/post likhe", "kitne publish hue", "draft pe kitne hain", "approval pe kya hai", ' +
        '"kya status hai", "how many posts do we have". Always call it instead of guessing a number.',
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["all", "published", "awaiting_approval", "failed", "draft"],
            description: "Narrow to one state, or 'all' for the full picture. Default 'all'.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_AUDIT,
      description:
        "Look up the most recent SEO/health audit ALREADY STORED for the customer's website: the score, how it " +
        "moved, how many pages were checked, and the list of problems found with their fixes. Call this when they " +
        'ASK what is wrong — "site pe koi issue/error hai", "audit me kya nikla", "site ki health kaisi hai", ' +
        '"seo score kya hai", "what is wrong with my site". ' +
        'DO NOT call this when they are TELLING you to run a new audit ("site audit karo", "phir se audit chalao", ' +
        '"re-run the audit") — that is work, and the audit ACTION must be called instead. This tool only reads what ' +
        "is already saved; it starts nothing.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_PAGES,
      description:
        "Search the customer's own website pages that have been crawled and read. Use `query` to find what their site " +
        'actually says about something ("hamari site pe ISO 27001 ke baare me kya likha hai", "do we have a pricing ' +
        'page"), or call it with no query to report how many pages are known and how fresh that crawl is. This is the ' +
        "only way to know what is really on their site — never describe their site from memory.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words to search their pages for. Omit to get coverage and freshness only." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_ANALYTICS,
      description:
        "Look up real traffic and search performance from the customer's connected Google account: Analytics (GA4) " +
        "sessions and users, and Search Console clicks, impressions and positions, including their top queries and " +
        'pages. Call this for "kitne visitor aaye", "traffic kaisa hai", "kaunse keyword pe rank kar rahe hain", ' +
        '"impressions kitne hain". If Google is not connected the tool says so — report that, never a number.',
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["all", "ga4", "gsc"], description: "Default 'all'." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_SCHEDULE,
      description:
        "Look up the customer's automation schedule: what runs, how often, at what time, and when it next fires. " +
        'Call this for "schedule kya hai", "agla article kab aayega", "kab chalega", "when is the next run".',
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_BUSINESS,
      description:
        "Look up what this product has learned about the customer's business from their own website — what they do, " +
        "who they sell to, their offerings, proof, tone and topic clusters (the Site Brain). Call this for " +
        '"mera business kya hai", "aapko mere baare me kya pata hai", "what do you know about us", and before giving ' +
        "any advice that depends on who they are.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
];

/** What every caller gets: the six lookups, each carrying NEVER_FOR_ORDERS. */
export const READ_TOOLS: ChatTool[] = withOrderGuard(RAW_READ_TOOLS);

/* ── Running one ─────────────────────────────────────────────────────────────────────────── */

/** What a tool hands back. `ok:false` is a normal outcome, not an error to hide: "Google is not
 *  connected" is the true answer to a traffic question, and the model must be able to say it. */
export type ReadResult = { ok: boolean; tool: string; data?: unknown; note?: string };

const CONTENT_TITLES = 8;
const AUDIT_ISSUES = 12;
const PAGE_HITS = 8;
const INSIGHT_ROWS = 10;

export async function runReadTool(
  name: string,
  args: Record<string, unknown>,
  supabase: SupabaseClient,
  tenantId: string | null
): Promise<ReadResult> {
  if (!tenantId) return { ok: false, tool: name, note: "No workspace is attached to this conversation." };
  try {
    switch (name) {
      case LOOKUP_CONTENT: return await lookupContent(supabase, tenantId, String(args?.status ?? "all"));
      case LOOKUP_AUDIT: return await lookupAudit(supabase, tenantId);
      case LOOKUP_PAGES: return await lookupPages(supabase, tenantId, typeof args?.query === "string" ? args.query : "");
      case LOOKUP_ANALYTICS: return await lookupAnalytics(supabase, tenantId, String(args?.source ?? "all"));
      case LOOKUP_SCHEDULE: return await lookupSchedule(supabase, tenantId);
      case LOOKUP_BUSINESS: return await lookupBusiness(supabase, tenantId);
      default: return { ok: false, tool: name, note: "No such lookup." };
    }
  } catch (e: any) {
    // Surfaced rather than swallowed: a model told "the lookup failed" says so, where a model
    // handed silence fills the gap with a number.
    console.error(`[chat-tools] ${name} failed:`, e?.message);
    return { ok: false, tool: name, note: `That lookup failed: ${String(e?.message ?? "unknown error")}` };
  }
}

async function lookupContent(supabase: SupabaseClient, tenantId: string, status: string): Promise<ReadResult> {
  // One read that yields every number, rather than one HEAD request per status. The table is
  // per-tenant and small (96 rows on the workspace this was written against).
  const { data, error } = await supabase
    .from("content_items")
    .select("type, status, title, updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  return { ok: true, tool: LOOKUP_CONTENT, data: lookupContentShape(data ?? [], status) };
}

/** The row-to-answer half of `lookup_content`, split out so the shape can be tested against the
 *  exact counts that have misfired in production without standing up a database. Pure: rows in,
 *  the object the model will read out. */
export function lookupContentShape(
  rows: { type?: string | null; status?: string | null; title?: string | null }[],
  status = "all"
) {
  const articles = rows.filter((r) => r.type === "article");
  const count = (s: string) => articles.filter((r) => r.status === s).length;

  // The Approvals badge counts every reviewable kind, not just articles — without this the
  // dashboard's "55" and an article count look like they disagree when both are right.
  const others: Record<string, number> = {};
  for (const r of rows) {
    if (r.type === "article" || r.status !== "awaiting_approval") continue;
    others[String(r.type)] = (others[String(r.type)] ?? 0) + 1;
  }

  const wanted = status === "all" ? null : status;
  const titles = articles
    .filter((r) => (wanted ? r.status === wanted : r.status === "awaiting_approval"))
    .slice(0, CONTENT_TITLES)
    .map((r) => ({ title: r.title, status: r.status }));

  const published = count("published");
  const unpublished = articles.length - published;

  // THE ZERO THAT IS TRUE AND USELESS. Reported live 2026-09-28: "kitna draft ha?" was answered
  // "Aapke articles ka draft count 0 hai" while 55 articles sat in awaiting_approval and the
  // dashboard's own Approvals badge read 55. Nothing lied — `draft` is a real status (001_init's
  // default, written in a dozen places) and it genuinely held no rows — but a customer saying
  // "draft" means "written and not live yet", and this product moves an article straight from
  // the writer to awaiting_approval, so the literal bucket is usually the empty one.
  //
  // The fix belongs here rather than in the prompt for the reason the top of this file gives:
  // the model owns the phrasing, the tool owns the numbers, and "which number answers this" is a
  // property of the data. So the result now SAYS when a zero is hiding a bigger number, using the
  // counts themselves. No question text is matched and no answer is written here — the model
  // still decides what to say, it just can no longer read `draft: 0` as the whole story.
  const emptyButNotNothing = (["draft", "published", "approved"] as const).filter(
    (bucket) => count(bucket) === 0 && unpublished > 0
  );
  const where = [
    count("awaiting_approval") ? `${count("awaiting_approval")} awaiting the customer's approval` : "",
    count("failed") ? `${count("failed")} failed the quality gate` : "",
    count("draft") ? `${count("draft")} still drafting` : "",
  ].filter(Boolean);

  const misleadingZero = emptyButNotNothing.length
    ? `${emptyButNotNothing.map((b) => `\`${b}\` is 0`).join(", ")} — but ${articles.length} articles exist and ` +
      `${unpublished} of them are not live: ${where.join(", ")}. In everyday language "draft" means any article ` +
      `that is not published yet, so answering with the literal zero alone would be accurate and still wrong. ` +
      `Give the figure they named AND where the rest actually are, in one sentence.`
    : null;

  return {
    articles: {
      total: articles.length,
      published,
      awaiting_approval: count("awaiting_approval"),
      failed_quality_gate: count("failed"),
      draft: count("draft"),
    },
    unpublished_total: unpublished,
    titles_shown: titles,
    also_awaiting_approval_not_articles: others,
    nothing_is_live: published === 0,
    ...(misleadingZero ? { read_before_answering: misleadingZero } : {}),
  };
}

async function lookupAudit(supabase: SupabaseClient, tenantId: string): Promise<ReadResult> {
  const { data, error } = await supabase
    .from("site_audits")
    .select("score, previous_score, pages_checked, blocks, warns, issues, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, tool: LOOKUP_AUDIT, note: "This site has never been audited." };

  const issues = Array.isArray(data.issues)
    ? (data.issues as any[])
        .map((i) => ({ problem: String(i?.what ?? "").trim(), fix: i?.fix ? String(i.fix).trim() : null }))
        .filter((i) => i.problem)
    : [];

  return {
    ok: true,
    tool: LOOKUP_AUDIT,
    data: {
      score_out_of_100: data.score ?? null,
      previous_score: data.previous_score ?? null,
      pages_checked: data.pages_checked ?? null,
      serious_problems: data.blocks ?? 0,
      warnings: data.warns ?? 0,
      ran_at: data.created_at ?? null,
      total_issues: issues.length,
      issues: issues.slice(0, AUDIT_ISSUES),
    },
  };
}

async function lookupPages(supabase: SupabaseClient, tenantId: string, query: string): Promise<ReadResult> {
  const { count, error } = await supabase
    .from("site_pages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);

  const { data: newest } = await supabase
    .from("site_pages")
    .select("created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const base = {
    pages_crawled: count ?? 0,
    last_crawl: newest?.created_at ?? null,
    // A crawl that stopped moving is a brain quietly going stale. Saying so in the tool result
    // is cheaper than being confidently wrong about their site for another week.
    crawl_age_days: newest?.created_at
      ? Math.floor((Date.now() - new Date(newest.created_at).getTime()) / 86_400_000)
      : null,
  };

  const q = query.trim();
  if (!q) return { ok: true, tool: LOOKUP_PAGES, data: base };

  // Keyword search over the stored text. This is the honest version of retrieval for today:
  // site_pages.embedding exists but nothing searches it, and knowledge_chunks is empty, so a
  // claim of semantic search here would be a lie. Replace the body of this branch when the
  // retrieval layer lands — the tool's contract does not change.
  const { data: hits, error: searchErr } = await supabase
    .from("site_pages")
    .select("url, title, content_text")
    .eq("tenant_id", tenantId)
    .or(`title.ilike.%${q.replace(/[%,()]/g, " ")}%,content_text.ilike.%${q.replace(/[%,()]/g, " ")}%`)
    .limit(PAGE_HITS);
  if (searchErr) throw new Error(searchErr.message);

  return {
    ok: true,
    tool: LOOKUP_PAGES,
    data: {
      ...base,
      query: q,
      matches: (hits ?? []).map((h) => ({
        url: h.url,
        title: h.title,
        // Enough to quote from, not so much that six hits blow the context window.
        excerpt: String(h.content_text ?? "").slice(0, 600),
      })),
      match_count: (hits ?? []).length,
    },
  };
}

async function lookupAnalytics(supabase: SupabaseClient, tenantId: string, source: string): Promise<ReadResult> {
  const { data, error } = await supabase
    .from("site_insights")
    .select("source, kind, key, metrics, period_start, period_end, captured_at")
    .eq("tenant_id", tenantId)
    .order("captured_at", { ascending: false })
    .limit(400);
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((r) => source === "all" || r.source === source);
  if (!rows.length) {
    // The true answer, and the one lib/chat-no-data.ts exists to protect: no rows means Google
    // was never connected (or never synced), NOT that the site has no traffic. A model told
    // "zero" would report zero visitors, which is a different and much worse claim.
    return {
      ok: false,
      tool: LOOKUP_ANALYTICS,
      note:
        "No analytics data is stored for this workspace, which means Google has not been connected yet (or has " +
        "never synced). This is NOT the same as zero traffic — the real number is unknown until the customer " +
        "connects Google Analytics / Search Console on the Connect page. Say that; never report a figure.",
    };
  }

  const pick = (src: string, kind: string) =>
    rows.filter((r) => r.source === src && r.kind === kind).slice(0, INSIGHT_ROWS)
      .map((r) => ({ key: r.key, ...(r.metrics as Record<string, unknown>) }));

  return {
    ok: true,
    tool: LOOKUP_ANALYTICS,
    data: {
      captured_at: rows[0]?.captured_at ?? null,
      period: { start: rows[0]?.period_start ?? null, end: rows[0]?.period_end ?? null },
      ga4_site_totals: pick("ga4", "summary"),
      ga4_top_pages: pick("ga4", "page"),
      search_console_top_queries: pick("gsc", "query"),
      search_console_top_pages: pick("gsc", "page"),
    },
  };
}

async function lookupSchedule(supabase: SupabaseClient, tenantId: string): Promise<ReadResult> {
  const { data, error } = await supabase.from("schedules").select("*").eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  if (!data?.length) return { ok: false, tool: LOOKUP_SCHEDULE, note: "Nothing is scheduled for this workspace yet." };
  return { ok: true, tool: LOOKUP_SCHEDULE, data: { schedules: data } };
}

async function lookupBusiness(supabase: SupabaseClient, tenantId: string): Promise<ReadResult> {
  const [{ data: tenant }, { data: profile }] = await Promise.all([
    supabase.from("tenants").select("name, website_url, niche, tone_profile, icp_profile").eq("id", tenantId).maybeSingle(),
    supabase
      .from("site_profiles")
      .select("version, profile, built_from, created_at")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .maybeSingle(),
  ]);

  if (!tenant && !profile) return { ok: false, tool: LOOKUP_BUSINESS, note: "Nothing has been learned about this business yet." };

  return {
    ok: true,
    tool: LOOKUP_BUSINESS,
    data: {
      name: tenant?.name ?? null,
      website: tenant?.website_url ?? null,
      niche: tenant?.niche ?? null,
      site_brain: profile
        ? { version: profile.version, learned_at: profile.created_at, built_from: profile.built_from, profile: profile.profile }
        : null,
      // Without this the model cannot tell "we studied the whole site" from "we read a dozen
      // pages once", and it has been claiming the former.
      site_brain_missing: !profile,
    },
  };
}

/* ── Handing the result to the model ─────────────────────────────────────────────────────── */

/** The block appended to the conversation before the model writes its reply.
 *
 *  JSON, not prose, and labelled as a tool result rather than as background: the failure this
 *  replaces was a model reading `PUBLISHED = 0` out of a prose context block and repeating it
 *  as an answer. A result it is told it just fetched gets used as data.
 */
export function toolResultBlock(result: ReadResult): string {
  const head = `TOOL RESULT — you called ${result.tool} and this is what came back. These are real, current values from this customer's own database.`;
  if (!result.ok) {
    return [
      head,
      `The lookup did not return data. Reason: ${result.note ?? "unknown"}`,
      "Tell the customer exactly this, in their own language. Do NOT substitute a number, an estimate, or a zero.",
    ].join("\n");
  }
  return [
    head,
    JSON.stringify(result.data, null, 1),
    "Answer the question that was actually asked using these values. Quote only figures that appear above — if the " +
      "customer asked for something not in here, say you looked and it is not there. Never print a raw key = value " +
      "line as your reply; write a sentence a person would say.",
    // Added 2026-09-28 after "kitna draft ha?" was answered "draft count 0 hai" with 55 articles
    // sitting in awaiting_approval. The zero was real; the answer was still wrong, because the
    // customer's word and the column's name are not the same vocabulary. The rule is general on
    // purpose — the same trap exists for "kitne lead", "kitne issue", any count with siblings.
    "A ZERO IS ONLY AN ANSWER IF IT IS THE WHOLE ANSWER. If a figure the customer named is zero while a related " +
      "figure above is not, give both in one sentence. A bare zero that hides a larger number is a wrong answer " +
      "even when the zero itself is accurate. If a `read_before_answering` field is present above, it is telling " +
      "you exactly that — follow it.",
    // THIS LINE IS NOT OPTIONAL. Caught in testing 2026-09-19: handed a stored audit, the model
    // opened with "Site audit dobara chala diya" — it announced running work that had not run.
    // A lookup is a READ; claiming it was an action is the most expensive lie this product can
    // tell, and it is the same failure the announced-work stripper in app/api/chat/route.ts
    // exists to catch after the fact. Better to never say it in the first place.
    "You only LOOKED THIS UP. Nothing was run, started, refreshed, rewritten or published to produce it. Never say " +
      'or imply that you did — no "chala diya", "kar diya", "I have run", "I just refreshed". If they were asking ' +
      "for work to be done, report what you can see and ask whether they want it started.",
  ].join("\n");
}
