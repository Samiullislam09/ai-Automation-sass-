import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWebsiteUrl } from "./website-url";
import { DAYS, agoPhrase, humanTime, localParts, nextRunAt, untilPhrase } from "./schedule-time";
// Re-exported, not redefined: lib/schedule-time.ts is the copy a client component can
// safely import (see its header). Server callers of this module are unaffected.
export { DAYS, agoPhrase, humanTime, localParts, nextRunAt, untilPhrase };

/** Everything the chat needs to know before it can answer, gathered in PARALLEL.
 *
 *  This file exists because of a stopwatch. Asking Mr Lxwa "hi hello" took 6-7 seconds, and
 *  almost none of that was the model: the route made seven Supabase round trips one after the
 *  other — auth.getUser, memberships, tenants, site_pages, the conversation row, the message
 *  history, the job log — and only then started thinking. Each hop is a few hundred
 *  milliseconds to a hosted Postgres; strung end to end they are most of the wait.
 *
 *  Nothing here is new work. It is the same queries, started together, on one client, with
 *  one auth check instead of two.
 */

export type Turn = { role: "user" | "assistant"; content: string };

export type ChatContext = {
  business: string | null;
  recentWork: string | null;
  schedule: string | null;
  history: Turn[];
};

/** The tenant's saved profile plus a few real page titles — what "what do you know about my
 *  business?" has to be answered from.
 *
 *  PREFERS `site_profiles` (Mr. Analyst's real output, migration 019 — the same table the Site
 *  Brain page reads) over the older `tenants.niche`/`tone_profile` fields. Found live 2026-08-29:
 *  a tenant's Site Brain page showed a full, HIGH-CONFIDENCE profile ("ISO certification &
 *  compliance...") while chat still answered "I don't know anything about your site" — because
 *  this function had never been pointed at `site_profiles` at all. `tenants.niche` stays as the
 *  fallback for a tenant that onboarded but whose analyst hasn't produced a profile yet (table
 *  missing migration 019, or no active row) — better a thin answer than none. */
export async function loadBusiness(supabase: SupabaseClient, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const [{ data: tenant }, { data: profileRow }, { data: samplePages }, { count: pageCount }, resolvedUrl] = await Promise.all([
      supabase.from("tenants").select("website_url, name, niche, tone_profile, icp_profile, onboarded, memory_facts").eq("id", tenantId).single(),
      supabase.from("site_profiles").select("profile").eq("tenant_id", tenantId).eq("active", true).maybeSingle(),
      // 6 → 40. "Mera company ka details do" has to be answerable from what the crawler
      // actually read, and six titles is not a description of a site — the owner's own words
      // (2026-08-31): "user sirf bolega mera company ka details do, har details all crawl page
      // etc se usko answer dena hai".
      supabase.from("site_pages").select("title").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(40),
      supabase.from("site_pages").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
      // Not `tenant.website_url` raw: a connected integration outranks whatever was typed into
      // onboarding, and this self-heals the column the first time it disagrees. See
      // lib/website-url.ts — chat answering questions about the wrong site is the bug it fixes.
      resolveWebsiteUrl(supabase, tenantId),
    ]);
    if (!tenant) return null;
    const profile = (profileRow?.profile as Record<string, any> | undefined) ?? null;
    // `onboarded` used to gate this whole function, on the assumption that nothing worth
    // saying could exist before the onboarding wizard finished. Found live 2026-08-29: a
    // tenant who connected WordPress from the Connect page (skipping the wizard) had a real,
    // full Mr. Analyst profile — and still got "I don't know anything about your site",
    // because this return happened before the profile was ever looked at. A real profile is
    // real regardless of how the site got connected; the flag only still matters for the
    // OLDER, thinner tenants.niche fallback below, which has nothing to say without it.
    if (!tenant.onboarded && !profile) return null;

    const facts: string[] = [];
    // `tenants.name` is whatever the account was signed up as — often a username ("heysamiul09"),
    // not a business. Labelled `business name`, it got reported as one: "Site ka naam
    // heysamiul09 hai" in a live conversation, contradicting the same chat's own correct answer
    // a minute earlier. The field is unchanged; only the label is now honest about what it is,
    // because the model can only be as accurate as the name it is given for a value.
    if (tenant.name) facts.push(`account/login name (NOT necessarily the business or site name)=${tenant.name}`);
    const website = resolvedUrl ?? (tenant.website_url as string | null);
    if (website) facts.push(`website=${website}`);

    if (profile) {
      if (profile.what_they_do) facts.push(`what they do=${profile.what_they_do}`);
      if (profile.audience) facts.push(`audience=${profile.audience}`);
      if (Array.isArray(profile.offerings) && profile.offerings.length) {
        // With URLs: "kaunsi service ka page kahan hai" is a normal question and the answer is
        // already on file — dropping the URL made the model say it did not know.
        facts.push(
          `offerings=${profile.offerings
            .map((o: any) => (o?.url ? `${o?.name} (${o.url})` : o?.name))
            .filter(Boolean)
            .slice(0, 20)
            .join(", ")}`,
        );
      }
      if (profile.geo) facts.push(`location/service area=${profile.geo}`);
      if (profile.voice?.tone) facts.push(`brand tone=${profile.voice.tone}`);
      if (Array.isArray(profile.topic_clusters) && profile.topic_clusters.length) {
        facts.push(`content topics=${profile.topic_clusters.map((t: any) => t?.name).filter(Boolean).slice(0, 12).join(", ")}`);
      }
      // The three fields below were built by Mr. Analyst and then never shown to anyone. They
      // are exactly what "which topic will actually grow my traffic" needs.
      if (Array.isArray(profile.proof) && profile.proof.length) {
        facts.push(`verified claims we may state=${profile.proof.map((p: any) => p?.claim).filter(Boolean).slice(0, 8).join("; ")}`);
      }
      if (Array.isArray(profile.content_gaps) && profile.content_gaps.length) {
        facts.push(
          `search demand with NO page answering it (best growth opportunities)=${profile.content_gaps
            .slice(0, 8)
            .map((g: any) => `${g?.query}${typeof g?.impressions === "number" ? ` (${g.impressions} impressions)` : ""}`)
            .filter(Boolean)
            .join("; ")}`,
        );
      }
      if (Array.isArray(profile.competitors) && profile.competitors.length) {
        facts.push(`competitors=${profile.competitors.map((c: any) => c?.name ?? c).filter(Boolean).slice(0, 6).join(", ")}`);
      }
      if (profile.buyer_intent) facts.push(`what their buyers are trying to do=${profile.buyer_intent}`);
      if (profile.goals?.primary) facts.push(`their goal for content=${profile.goals.primary}`);
    } else {
      // No Mr. Analyst profile yet — the same fields chat always fell back to.
      const tone = (tenant.tone_profile as any) ?? {};
      const icp = (tenant.icp_profile as any) ?? {};
      if (tenant.niche) facts.push(`niche=${tenant.niche}`);
      if (icp.businessType) facts.push(`business type=${icp.businessType}`);
      if (tone.audience) facts.push(`audience=${tone.audience}`);
      if (tone.tone) facts.push(`brand tone=${tone.tone}`);
      if (Array.isArray(tone.topics) && tone.topics.length) facts.push(`content topics=${tone.topics.join(", ")}`);
    }
    // THE MEMORY PAGE'S OWN FACTS. `tenants.memory_facts` is what the owner curates by hand on
    // /dashboard/memory — and until 2026-08-31 the ONLY reader was app/api/memory/route.ts, so
    // everything typed there was invisible to the chat that is supposed to know it. Put last of
    // the profile block but before the page list, and labelled as owner-stated, because a fact
    // the human wrote down beats anything inferred from a crawl.
    const memoryFacts = Array.isArray(tenant.memory_facts) ? (tenant.memory_facts as any[]) : [];
    if (memoryFacts.length) {
      facts.push(
        `facts the owner told us directly=${memoryFacts
          .map((f) => (f?.k && f?.v ? `${f.k}: ${f.v}` : null))
          .filter(Boolean)
          .slice(0, 25)
          .join("; ")}`,
      );
    }

    if (typeof pageCount === "number" && pageCount > 0) {
      facts.push(`pages we have crawled and read=${pageCount}`);
    }
    if (samplePages?.length) {
      facts.push(`page titles from their site=${samplePages.map((p) => p.title).filter(Boolean).join(" | ")}`);
    }

    return facts.length ? facts.join(" · ") : null;
  } catch (e: any) {
    console.error("[chat] business context failed:", e?.message);
    return null;
  }
}

/** The last few real jobs, one line each. Without this Mr Lxwa could only invent an answer to
 *  "what did the team do?" — and invention is the one thing he must not do. */
export async function loadRecentWork(supabase: SupabaseClient, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const { data } = await supabase
      .from("jobs_log")
      .select("agent, action, status, detail, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      // Five, not eight. Eight rows of raw log line is more text than the rest of the prompt
      // put together, and the model answered "kya update hai" by pasting all of it back.
      .limit(5);
    if (!data?.length) return null;
    return data
      .map((j: any) => {
        const when = new Date(j.created_at).toLocaleString();
        // Job labels carry the full article title, which can run past a hundred characters
        // and drowns the outcome that actually answers the question.
        const raw = j.action && j.action !== j.agent ? j.action : j.agent;
        const what = raw.length > 70 ? raw.slice(0, 70).trimEnd() + "…" : raw;
        const hint = j.detail?.hint ? ` (${String(j.detail.hint).slice(0, 120)})` : "";
        const outcome =
          j.status === "error" ? `FAILED: ${String(j.detail?.message ?? "unknown error").slice(0, 120)}${hint}`
          : j.status === "success" ? "done"
          : j.status;
        return `- ${when} · ${j.agent} · ${what} — ${outcome}`;
      })
      .join("\n");
  } catch (e: any) {
    console.error("[chat] recent work failed:", e?.message);
    return null;
  }
}

/** What the team is doing RIGHT NOW — the one thing Mr Lxwa could never see.
 *
 *  `loadRecentWork` above reads `jobs_log`, and a row only lands there once a job has finished.
 *  So every "kya chal raha hai" was answered from history, and the FACTS block had to carry an
 *  explicit warning not to describe finished rows as in-progress (see the WORK section in
 *  app/api/chat/route.ts) — a warning that exists because the model kept doing it anyway. The
 *  `tasks` table held the real answer the whole time and nothing in the chat ever read it.
 *
 *  Non-terminal statuses only, and TERMINAL_TASK in lib/live.ts is the definition of terminal —
 *  including `awaiting_approval`, which reads like "not finished" but is that file's own success
 *  state (the work is done, a human just has not looked yet). Getting that wrong in the other
 *  direction would have Mr Lxwa reporting 50 finished articles as still being written. */
const LIVE_TASK_LIMIT = 8;

export async function loadLiveWork(supabase: SupabaseClient, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const { data } = await supabase
      .from("tasks")
      .select("kind, status, params, run_at, created_at, updated_at, error")
      .eq("tenant_id", tenantId)
      .in("status", ["queued", "running", "scheduled", "awaiting_confirm"])
      .order("created_at", { ascending: false })
      .limit(LIVE_TASK_LIMIT);
    if (!data?.length) return null;

    return data
      .map((t: any) => {
        const subject = pickSubject(t.params);
        const what = `${String(t.kind ?? "task")}${subject ? ` "${subject.slice(0, 70)}"` : ""}`;
        const since = t.updated_at ?? t.created_at;
        const detail =
          t.status === "running" ? `running${since ? `, started ${agoPhrase(new Date(since))}` : ""}`
          : t.status === "scheduled" ? `scheduled for ${t.run_at ? new Date(t.run_at).toISOString() : "an unspecified time"}`
          : t.status === "awaiting_confirm" ? "waiting for the customer to say yes — NOT started"
          : "queued, not started yet";
        return `- ${what} — ${detail}${t.error ? ` (last error: ${String(t.error).slice(0, 80)})` : ""}`;
      })
      .join("\n");
  } catch (e: any) {
    // The `tasks` table arrives with migration 017. Say nothing rather than have the model guess.
    console.error("[chat] live work failed:", e?.message);
    return null;
  }
}

/** Whatever the params call the thing being worked on. Every agent names it differently and a
 *  task with no subject is normal (an audit has none), so this returns null rather than
 *  inventing a label. */
function pickSubject(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  for (const k of ["topic", "title", "seed", "keyword", "query", "subject", "which"]) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** The site's real problems, from the last audit Mr. Audit actually ran.
 *
 *  "mere site pe kya issue hai" is one of the most common questions in the chat history, and
 *  until now the brain answered it from the Site Brain profile — which describes what the site
 *  IS, not what is wrong with it. `site_audits` has carried the findings (a score, block/warn
 *  counts, and an issue list where every entry already has both a plain-English `what` and a
 *  `fix`) and no chat path read the table.
 *
 *  The score's own history is included because "is it getting better" is the follow-up, and
 *  `previous_score` is right there on the row. */
const AUDIT_ISSUE_LIMIT = 10;

export async function loadSiteIssues(supabase: SupabaseClient, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const { data } = await supabase
      .from("site_audits")
      .select("score, previous_score, pages_checked, blocks, warns, issues, summary, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;

    const when = data.created_at ? agoPhrase(new Date(data.created_at)) : "at an unknown time";
    const head = [
      `Last site audit ran ${when}: score ${data.score ?? "?"}/100`,
      typeof data.previous_score === "number" ? `(previous score ${data.previous_score})` : null,
      `across ${data.pages_checked ?? "?"} page(s)`,
      `${data.blocks ?? 0} serious problem(s) and ${data.warns ?? 0} warning(s).`,
    ]
      .filter(Boolean)
      .join(" ");

    const list = Array.isArray(data.issues)
      ? (data.issues as any[])
          .slice(0, AUDIT_ISSUE_LIMIT)
          .map((i) => {
            const what = String(i?.what ?? i?.id ?? "").trim();
            if (!what) return null;
            const fix = i?.fix ? ` → fix: ${String(i.fix).slice(0, 160)}` : "";
            return `- ${what.slice(0, 160)}${fix}`;
          })
          .filter(Boolean)
          .join("\n")
      : "";

    return [head, list || "No individual issues were recorded on this run."].filter(Boolean).join("\n");
  } catch (e: any) {
    console.error("[chat] site issues failed:", e?.message);
    return null;
  }
}

/** The automation calendar, in the same words the Schedule page uses.
 *
 *  Mr Lxwa used to be blind to this: asked "kaunsa task schedule pe hai aur kitne baje?" he
 *  had nothing to read, so he changed the subject. The schedules table was right there. */
export async function loadSchedule(supabase: SupabaseClient, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    // select("*") on purpose: auto_publish arrives with migration 014, and naming it in the
    // column list would make this whole block fail on a database that hasn't run it yet —
    // costing Mr Lxwa every other schedule fact over one missing column.
    // Both halves, read together. The recurring timetable and the one-off orders placed in the
    // chat live in two different tables, and answering from only one of them is how "kya
    // schedule pe hai" came back missing the thing the customer had booked ninety seconds ago.
    const [{ data }, oneOffs] = await Promise.all([
      supabase.from("schedules").select("*").eq("tenant_id", tenantId),
      loadPendingOrders(supabase, tenantId),
    ]);
    if (!data?.length) {
      return [oneOffs, "No recurring automatic schedule has been set up yet."].filter(Boolean).join("\n");
    }

    const recurring = data
      .map((s: any) => {
        if (!s.enabled) return `- ${s.kind}: automation is OFF.`;
        const next = nextRunAt(s);
        const when =
          s.frequency === "weekly" ? `every ${DAYS[s.day_of_week] ?? "Monday"}`
          : s.frequency === "weekdays" ? "every weekday (Mon-Fri)"
          : "every day";
        return [
          `- ${s.kind}: ON, ${when} at ${s.time_of_day} ${s.timezone}, ${s.count} per run`,
          s.auto_publish ? "publishes straight to the site with no review" : "lands in Approvals for review",
          // Written out in the tenant's own timezone rather than as an ISO instant. Asked
          // "schedule kab chalta hai", the model answered "2026-08-26T03:30:00.833Z" — it had
          // been told to convert and simply pasted. A time nobody can read is not a fact the
          // model should be trusted to reformat; it is a fact this function should format.
          next ? `next run ${humanTime(next, s.timezone)} (${untilPhrase(next)})` : null,
          s.last_run_at ? `last ran ${humanTime(new Date(s.last_run_at), s.timezone)}` : "has not run yet",
        ].filter(Boolean).join(" · ");
      })
      .join("\n");

    return [recurring, oneOffs].filter(Boolean).join("\n");
  } catch (e: any) {
    // Before migration 014 the auto_publish column doesn't exist. Say nothing rather than
    // making the model guess.
    console.error("[chat] schedule context failed:", e?.message);
    return null;
  }
}

/** One-off orders placed in the chat that have not fired yet — "30 min baad publish kar do".
 *
 *  Read from the ROW, never from the sentence that created it. The row is what the scheduler
 *  will act on, so if the two ever disagree the row is the one that is true — and this is the
 *  reference Mr Lxwa answers "kya schedule pe hai" from.
 *
 *  Returns null rather than throwing when migration 015 has not been run, so the rest of the
 *  schedule answer survives a database that is one file behind. */
export async function loadPendingOrders(supabase: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("scheduled_orders")
    .select("kind, topic, auto_publish, run_at")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .order("run_at", { ascending: true })
    .limit(10);
  if (error || !data?.length) return null;

  const tzRow = await supabase.from("schedules").select("timezone").eq("tenant_id", tenantId).limit(1);
  const tz = tzRow.data?.[0]?.timezone ?? "UTC";

  const lines = (data as any[]).map((o) => {
    const what =
      o.kind === "publish" ? "publish an article that is already written"
      : o.kind === "research" ? `research keywords${o.topic ? ` for "${o.topic}"` : ""}`
      : o.kind === "plan" ? "pick this week's topics and write them"
      : `write an article${o.topic ? ` about "${o.topic}"` : ""}`;
    const lands =
      o.kind === "research" ? "nothing published"
      : o.auto_publish ? "publishes straight to the site" : "lands in Approvals";
    const at = new Date(o.run_at);
    return `- ONE-OFF: ${what} at ${humanTime(at, tz)} (${untilPhrase(at)}) · ${lands}`;
  });

  return `One-off orders the user booked in this chat, not yet fired (${lines.length}):\n${lines.join("\n")}`;
}

const GREETING_KIND_LABEL: Record<string, string> = {
  article: "article",
  publish: "article",
  write: "article",
  plan: "content plan",
  research: "keyword research",
  social: "social media post",
};

export type GreetingFacts = {
  name: string | null;
  website: string | null;
  next: { when: string; what: string; lands: string } | null;
};

/** "https://www.example.com/anything" → "Example". `tenants.name` can't be used for this: it
 *  is set once, at signup, to the user's OWN email prefix (lib/supabase/tenant.ts) and nothing
 *  in the app ever changes it afterwards — so every tenant's "business name" was really just
 *  whoever happened to sign up. The site's own domain is the one name on file that is actually
 *  about the site. */
function siteLabelFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const base = host.split(".")[0];
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : null;
  } catch {
    return null;
  }
}

/** What the very first chat bubble greets you with: your own site's name and, if one is
 *  coming, the next thing the team will do — instead of the same fixed sentence for every
 *  tenant. Kept separate from loadBusiness/loadSchedule (which answer real questions with the
 *  full reference block) because a greeting needs one short clause, not a page of facts. */
export async function loadGreetingFacts(supabase: SupabaseClient, tenantId: string | null): Promise<GreetingFacts | null> {
  if (!tenantId) return null;
  try {
    const [{ data: tenant }, { data: schedules }, { data: oneOffs }] = await Promise.all([
      supabase.from("tenants").select("website_url").eq("id", tenantId).maybeSingle(),
      supabase.from("schedules").select("*").eq("tenant_id", tenantId).eq("enabled", true),
      supabase
        .from("scheduled_orders")
        .select("kind, run_at, auto_publish")
        .eq("tenant_id", tenantId)
        .eq("status", "pending")
        .order("run_at", { ascending: true })
        .limit(5),
    ]);

    type Candidate = { at: Date; kind: string; lands: string };
    const candidates: Candidate[] = [];
    for (const s of schedules ?? []) {
      const at = nextRunAt(s);
      if (at) candidates.push({ at, kind: s.kind, lands: s.auto_publish ? "publishes straight to the site" : "lands in Approvals for review" });
    }
    for (const o of oneOffs ?? []) {
      candidates.push({
        at: new Date(o.run_at),
        kind: o.kind,
        lands: o.kind === "research" ? "nothing published" : o.auto_publish ? "publishes straight to the site" : "lands in Approvals for review",
      });
    }
    candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
    const soonest = candidates[0] ?? null;
    // Two automations booked for the exact same slot (e.g. an article and a social post both
    // at 9am) read as one line — "1 article and 1 social media post" — not two greetings.
    const sameSlot = soonest ? candidates.filter((c) => c.at.getTime() === soonest.at.getTime()) : [];

    const website = tenant?.website_url ?? null;
    return {
      name: website ? siteLabelFromUrl(website) : null,
      website,
      next: soonest
        ? {
            when: untilPhrase(soonest.at),
            what: Array.from(new Set(sameSlot.map((c) => GREETING_KIND_LABEL[c.kind] ?? c.kind)))
              .map((label) => `1 ${label}`)
              .join(" and "),
            lands: soonest.lands,
          }
        : null,
    };
  } catch (e: any) {
    console.error("[chat] greeting facts failed:", e?.message);
    return null;
  }
}


/** "Wednesday 26 August, 09:00 Asia/Calcutta" — a time a person can repeat out loud. */

/** "in 16 hours", "in 12 minutes" — the part people actually want when they ask "kab". */
/** The past-tense counterpart. `untilPhrase` below reads a FUTURE instant and collapses
 *  anything already past to "any moment now" — correct for a next-run time, actively wrong for
 *  "when did this start", where it would describe a three-hour-old job as about to happen. */


/** How much has actually been produced, counted rather than estimated.
 *
 *  "kitne article ban chuke hain" was being answered off the last five job-log rows, which
 *  cannot possibly know the total — it replied "3" from a window that held two. A count is a
 *  count; it should come from a COUNT. */
export type Counts = { lines: string; awaiting: number; total: number };

export async function loadCounts(supabase: SupabaseClient, tenantId: string | null): Promise<Counts | null> {
  if (!tenantId) return null;
  try {
    const head = (status: string) =>
      supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("type", "article")
        .eq("status", status);

    const [published, awaiting, failed, draft] = await Promise.all([
      head("published"), head("awaiting_approval"), head("failed"), head("draft"),
    ]);
    const total = (published.count ?? 0) + (awaiting.count ?? 0) + (failed.count ?? 0) + (draft.count ?? 0);
    // One number per line, as key = value. Written as a sentence with the figures in
    // parentheses, the model read "total 8 (published 1, awaiting 6, failed 1)" and answered
    // "3 articles completed". A 30B model with reasoning off parses a table; it does not
    // reliably parse prose full of digits.
    return {
      total,
      awaiting: awaiting.count ?? 0,
      lines: [
        `TOTAL ARTICLES WRITTEN = ${total}`,
        `PUBLISHED = ${published.count ?? 0}`,
        `AWAITING YOUR APPROVAL = ${awaiting.count ?? 0}`,
        `FAILED = ${failed.count ?? 0}`,
        `STILL DRAFT = ${draft.count ?? 0}`,
      ].join("\n"),
    };
  } catch (e: any) {
    console.error("[chat] counts failed:", e?.message);
    return null;
  }
}

/** THE one implementation of "when does this fire next".
 *
 *  It used to exist twice — once in the scheduler that actually fires, once in the page that
 *  tells you when it will — and two copies of a timezone calculation is two answers waiting to
 *  disagree. The API now serves this to the page, and the agent-server's isDue() checks the
 *  same fields.
 */

