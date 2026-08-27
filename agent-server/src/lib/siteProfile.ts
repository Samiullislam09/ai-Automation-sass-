import { supabase } from "../supabase.js";

/** The Site Brain — one tenant's website, written down (rebuild plan §25.2).
 *
 *  Every agent reads this FIRST. Mr. Keyword stops suggesting "crypto tax" on a hospital
 *  site because a candidate now gets scored against the site's own topic clusters; Mr. Writer
 *  stops writing "contact us" because it knows the offering to point at; Mr. Lead knows the
 *  ICP without being told it again.
 *
 *  The one rule that makes this trustworthy rather than another layer of guessing:
 *
 *      A field is EVIDENCE or it is absent.
 *
 *  If the site does not say it and the user did not tell us, the field stays null/empty —
 *  it is never filled with something plausible. That is the same rule Mr. Writer already
 *  lives under ("no invented facts"), applied one level earlier, where the invention would
 *  otherwise be copied into every article afterwards. Hence `sources` beside every field:
 *  a claim with no source URL is a claim we cannot make.
 *
 *  Versioning: a profile is never edited in place. `saveProfile` writes version N+1 and moves
 *  the `active` flag; the old row keeps its jsonb forever, so Settings → Site Brain can show
 *  a diff and roll back with one click (§25.9), and a user's correction can never be silently
 *  overwritten by next week's re-crawl.
 */

// ── the shape ───────────────────────────────────────────────────────────────────────────────

export type Offering = {
  name: string;
  /** The page that sells it. Null only when the user typed the offering in by hand. */
  url: string | null;
  kind: "product" | "service" | "unknown";
};

/** A verifiable claim: a certification, an award, a years-in-business or client count.
 *  `quote` is the words as they appear on the page, so the writer can reuse them verbatim
 *  and a human can check them in one click. */
export type Proof = { claim: string; quote: string | null; url: string | null };

export type TopicCluster = {
  name: string;
  page_urls: string[];
  /** Mean of the member pages' embeddings, unit length. Used for Mr. Keyword's fit score
   *  and for the content-gap search. Kept out of prompt text — it is 1024 numbers. */
  centroid: number[] | null;
  size: number;
};

/** A search real people make, that this site is seen for, with no page answering it. */
export type ContentGap = {
  query: string;
  impressions: number;
  position: number | null;
  /** Cosine similarity to the closest page we have. Low by definition — that is the gap. */
  nearest_similarity: number | null;
  nearest_url: string | null;
  nearest_cluster: string | null;
};

export type Voice = {
  tone: string | null;
  do: string[];
  dont: string[];
  samples: string[];
};

export type Goals = {
  primary: "leads" | "traffic" | "sales" | null;
  kpis: string[];
};

export type Confidence = "high" | "medium" | "low";

/** The fields that carry a confidence + sources entry. Keys of the two maps below. */
export const PROFILE_FIELDS = [
  "what_they_do",
  "offerings",
  "audience",
  "buyer_intent",
  "proof",
  "topic_clusters",
  "content_gaps",
  "voice",
  "geo",
  "language",
  "competitors",
  "goals",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type SiteProfile = {
  what_they_do: string | null;
  offerings: Offering[];
  audience: string | null;
  buyer_intent: string[];
  proof: Proof[];
  topic_clusters: TopicCluster[];
  content_gaps: ContentGap[];
  voice: Voice | null;
  geo: string | null;
  language: string | null;
  competitors: string[];
  goals: Goals | null;
  /** How sure we are, per field. "low" is a real answer and is shown to the user as one. */
  confidence: Partial<Record<ProfileField, Confidence>>;
  /** Where each field came from: page URLs, "onboarding", "google-search-console", "user".
   *  A non-empty entry here is what makes the field usable; an empty one is a red flag. */
  sources: Partial<Record<ProfileField, string[]>>;
  /** Fields a human corrected by hand. The agent proposes changes to these but never
   *  applies them itself (§25.9) — this is the list it has to check. */
  user_edited?: ProfileField[];
};

export type ProfileRow = {
  id: string;
  version: number;
  profile: SiteProfile;
  sources: Partial<Record<ProfileField, string[]>>;
  built_from: BuiltFrom;
  created_by: string;
  created_at: string;
};

export type BuiltFrom = {
  pages?: number;
  page_urls?: string[];
  gsc_period?: { start: string | null; end: string | null } | null;
  gsc_queries?: number;
  [key: string]: unknown;
};

/** Every field absent — the honest starting point, and what a caller gets when nothing has
 *  been built yet. Never "unknown business" or any other placeholder prose. */
export function emptyProfile(): SiteProfile {
  return {
    what_they_do: null,
    offerings: [],
    audience: null,
    buyer_intent: [],
    proof: [],
    topic_clusters: [],
    content_gaps: [],
    voice: null,
    geo: null,
    language: null,
    competitors: [],
    goals: null,
    confidence: {},
    sources: {},
  };
}

/** Merge whatever the database happens to hold onto the full shape, so a profile written by
 *  an older version of this file (or hand-edited in the SQL editor) can never crash a caller
 *  with `profile.offerings is not iterable`. */
export function normalizeProfile(raw: unknown): SiteProfile {
  const base = emptyProfile();
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Partial<SiteProfile>;
  return {
    ...base,
    ...p,
    offerings: asArray(p.offerings),
    buyer_intent: asArray(p.buyer_intent),
    proof: asArray(p.proof),
    topic_clusters: asArray(p.topic_clusters),
    content_gaps: asArray(p.content_gaps),
    competitors: asArray(p.competitors),
    confidence: (p.confidence && typeof p.confidence === "object" ? p.confidence : {}) as SiteProfile["confidence"],
    sources: (p.sources && typeof p.sources === "object" ? p.sources : {}) as SiteProfile["sources"],
  };
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// ── read ────────────────────────────────────────────────────────────────────────────────────

/** The live Site Brain for a tenant, or null if the analyst has never run.
 *
 *  Null is a normal state, not an error: callers fall back to what they did before and say
 *  so out loud in the prompt, exactly as insights.ts does when Google isn't connected. A
 *  missing table (019 not applied yet) is treated the same way. */
export async function loadActiveProfile(tenantId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("site_profiles")
    .select("id, version, profile, sources, built_from, created_by, created_at")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("[siteProfile] read failed:", error.message);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id as string,
    version: Number(data.version) || 1,
    profile: normalizeProfile(data.profile),
    sources: (data.sources ?? {}) as Partial<Record<ProfileField, string[]>>,
    built_from: (data.built_from ?? {}) as BuiltFrom,
    created_by: String(data.created_by ?? ""),
    created_at: String(data.created_at ?? ""),
  };
}

// ── write ───────────────────────────────────────────────────────────────────────────────────

export type SaveOptions = {
  builtFrom: BuiltFrom;
  /** 'agent:analyst' | 'user:<uuid>' | 'system:recrawl' */
  createdBy: string;
};

/** Write a NEW version and make it the live one. Nothing that already exists is rewritten.
 *
 *  Order matters and is deliberate:
 *    1. insert the new row with active=false — if this fails, the tenant still has the old
 *       brain, which is the safe direction;
 *    2. clear `active` on every other row;
 *    3. set `active` on the new row.
 *
 *  Between 2 and 3 a tenant momentarily has no active profile; readers get null and fall back,
 *  which is survivable. Doing it the other way round is not: the partial unique index
 *  (site_profiles_one_active, migration 019) would reject step 3 outright and we would have
 *  written a version nobody can see.
 *
 *  The version number is read-then-inserted, so two analysts finishing at the same moment can
 *  collide on unique(tenant_id, version). That collision is the index doing its job — retry
 *  with the next number rather than inventing a scheme that pretends it can't happen. */
export async function saveProfile(
  tenantId: string,
  profile: SiteProfile,
  { builtFrom, createdBy }: SaveOptions
): Promise<ProfileRow> {
  let lastError = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: latest, error: readError } = await supabase
      .from("site_profiles")
      .select("version")
      .eq("tenant_id", tenantId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (readError) throw new Error(`site_profiles read failed: ${readError.message}`);

    const version = (Number(latest?.version) || 0) + 1 + attempt;

    const { data: inserted, error: insertError } = await supabase
      .from("site_profiles")
      .insert({
        tenant_id: tenantId,
        version,
        profile,
        // Mirrored out of the document so SQL can answer "where did this claim come from"
        // without unpacking the whole profile. Same data, indexed access.
        sources: profile.sources ?? {},
        built_from: builtFrom,
        created_by: createdBy,
        active: false,
      })
      .select("id, version, profile, sources, built_from, created_by, created_at")
      .single();

    if (insertError) {
      lastError = insertError.message;
      // 23505 = unique violation: somebody else took this version number. Loop and take the next.
      if ((insertError as any).code === "23505") continue;
      throw new Error(`site_profiles insert failed: ${insertError.message}`);
    }

    const { error: clearError } = await supabase
      .from("site_profiles")
      .update({ active: false })
      .eq("tenant_id", tenantId)
      .eq("active", true);
    if (clearError) throw new Error(`site_profiles deactivate failed: ${clearError.message}`);

    const { error: activateError } = await supabase
      .from("site_profiles")
      .update({ active: true })
      .eq("id", inserted!.id);
    if (activateError) throw new Error(`site_profiles activate failed: ${activateError.message}`);

    return {
      id: inserted!.id as string,
      version: Number(inserted!.version),
      profile: normalizeProfile(inserted!.profile),
      sources: (inserted!.sources ?? {}) as Partial<Record<ProfileField, string[]>>,
      built_from: (inserted!.built_from ?? {}) as BuiltFrom,
      created_by: String(inserted!.created_by ?? createdBy),
      created_at: String(inserted!.created_at ?? new Date().toISOString()),
    };
  }

  throw new Error(`site_profiles insert failed after 3 version attempts: ${lastError}`);
}

// ── prompt block ────────────────────────────────────────────────────────────────────────────

/** The Site Brain as plain text for a prompt — the first thing every agent is told.
 *
 *  Same discipline as insights.ts's planningBlock: an absent field prints NOTHING rather than
 *  "unknown", because "audience: unknown" invites the model to fill the blank, which is the
 *  precise failure this whole file exists to prevent. An empty profile therefore produces an
 *  empty string, and the caller keeps its old behaviour untouched.
 *
 *  Centroids and per-field confidence maps are deliberately not printed: 1024 floats and an
 *  internal quality score are for our code, not for the model. */
export function profileBlock(profile: SiteProfile | null | undefined, options?: { maxOfferings?: number; maxClusters?: number; maxGaps?: number }): string {
  if (!profile) return "";
  const p = normalizeProfile(profile);
  const maxOfferings = options?.maxOfferings ?? 12;
  const maxClusters = options?.maxClusters ?? 8;
  const maxGaps = options?.maxGaps ?? 8;

  const lines: string[] = [];

  if (p.what_they_do) lines.push(`WHAT THIS BUSINESS DOES: ${p.what_they_do}`);
  if (p.audience) lines.push(`WHO THEY SELL TO: ${p.audience}`);
  if (p.buyer_intent.length) lines.push(`WHAT THOSE BUYERS WANT TO KNOW: ${p.buyer_intent.join("; ")}`);

  const geoLang = [p.geo ? `Location/service area: ${p.geo}` : "", p.language ? `Language: ${p.language}` : ""].filter(Boolean);
  if (geoLang.length) lines.push(geoLang.join(" · "));

  if (p.offerings.length) {
    lines.push("", "WHAT THEY SELL (link and call to action must come from this list, never a generic 'contact us'):");
    for (const o of p.offerings.slice(0, maxOfferings)) {
      lines.push(`- ${o.name}${o.kind !== "unknown" ? ` (${o.kind})` : ""}${o.url ? ` — ${o.url}` : ""}`);
    }
  }

  if (p.proof.length) {
    lines.push("", "PROVEN FACTS you may state. These are the ONLY facts about this business you may use; anything else you do not know:");
    for (const f of p.proof.slice(0, 10)) {
      lines.push(`- ${f.claim}${f.url ? ` [${f.url}]` : ""}`);
    }
  }

  if (p.topic_clusters.length) {
    lines.push("", "TOPICS THIS SITE ALREADY COVERS:");
    for (const c of p.topic_clusters.slice(0, maxClusters)) {
      lines.push(`- ${c.name} (${c.size} page${c.size === 1 ? "" : "s"})${c.page_urls[0] ? ` e.g. ${c.page_urls[0]}` : ""}`);
    }
  }

  if (p.content_gaps.length) {
    lines.push("", "SEARCHES THEY ARE SEEN FOR WITH NO PAGE ANSWERING THEM (measured, from Search Console):");
    for (const g of p.content_gaps.slice(0, maxGaps)) {
      const pos = g.position != null ? `, position ${g.position.toFixed(1)}` : "";
      lines.push(`- "${g.query}" — ${g.impressions} impressions${pos}`);
    }
  }

  if (p.voice) {
    const v: string[] = [];
    if (p.voice.tone) v.push(`Tone: ${p.voice.tone}`);
    if (p.voice.do.length) v.push(`Do: ${p.voice.do.join("; ")}`);
    if (p.voice.dont.length) v.push(`Do NOT: ${p.voice.dont.join("; ")}`);
    if (v.length) lines.push("", "HOUSE VOICE:", ...v.map((s) => `- ${s}`));
  }

  if (p.goals?.primary || p.goals?.kpis.length) {
    const goal = [p.goals?.primary ? `Primary goal: ${p.goals.primary}` : "", p.goals?.kpis.length ? `Measured by: ${p.goals.kpis.join("; ")}` : ""]
      .filter(Boolean)
      .join(" · ");
    if (goal) lines.push("", goal);
  }

  if (p.competitors.length) lines.push("", `Competitors named by the owner: ${p.competitors.join(", ")}`);

  if (!lines.length) return "";

  return [
    "",
    "SITE BRAIN — what we actually know about this business, read off their own website and their Search Console.",
    "Everything below is evidence. Nothing that is not below is known: if you need a fact that is not here, leave it out rather than inventing it.",
    "",
    ...lines,
    "",
  ].join("\n");
}

// ── diff ────────────────────────────────────────────────────────────────────────────────────

export type ProfileChange = {
  field: ProfileField;
  kind: "added" | "removed" | "changed";
  /** One line, already in the words the user should see. */
  text: string;
};

/** What changed between two versions, in words a business owner can act on.
 *
 *  This is the freshness card of §25.9 — "3 new service pages found, 1 gone — update the
 *  profile?" — and the rollback screen's "what am I undoing". It is intentionally coarse: a
 *  list of names added and removed, not a character diff, because the question being answered
 *  is "is this change one I want", not "which comma moved".
 *
 *  `a` is the OLD profile, `b` the NEW one. */
export function diffProfiles(a: SiteProfile | null | undefined, b: SiteProfile | null | undefined): ProfileChange[] {
  const oldP = normalizeProfile(a);
  const newP = normalizeProfile(b);
  const changes: ProfileChange[] = [];

  // Prose fields: report that they changed, and show both, trimmed. Showing the old text is
  // what lets someone spot the agent overwriting a correction they made by hand.
  for (const field of ["what_they_do", "audience", "geo", "language"] as const) {
    const before = (oldP[field] ?? null) as string | null;
    const after = (newP[field] ?? null) as string | null;
    if (norm(before) === norm(after)) continue;
    if (!before && after) changes.push({ field, kind: "added", text: `${label(field)} set: ${clip(after)}` });
    else if (before && !after) changes.push({ field, kind: "removed", text: `${label(field)} is no longer stated on the site (was: ${clip(before)})` });
    else changes.push({ field, kind: "changed", text: `${label(field)} changed from "${clip(before!)}" to "${clip(after!)}"` });
  }

  pushSetDiff(changes, "offerings", oldP.offerings.map((o) => o.name), newP.offerings.map((o) => o.name), "offering");
  pushSetDiff(changes, "proof", oldP.proof.map((p) => p.claim), newP.proof.map((p) => p.claim), "proven fact");
  pushSetDiff(changes, "topic_clusters", oldP.topic_clusters.map((c) => c.name), newP.topic_clusters.map((c) => c.name), "topic cluster");
  pushSetDiff(changes, "content_gaps", oldP.content_gaps.map((g) => g.query), newP.content_gaps.map((g) => g.query), "content gap");
  pushSetDiff(changes, "competitors", oldP.competitors, newP.competitors, "competitor");
  pushSetDiff(changes, "buyer_intent", oldP.buyer_intent, newP.buyer_intent, "buyer question");

  // Voice and goals are small objects; compare them as a whole and say so once.
  if (JSON.stringify(oldP.voice ?? null) !== JSON.stringify(newP.voice ?? null)) {
    const tone = newP.voice?.tone;
    changes.push({
      field: "voice",
      kind: oldP.voice ? (newP.voice ? "changed" : "removed") : "added",
      text: tone ? `House voice updated (tone: ${tone})` : "House voice updated",
    });
  }
  if (JSON.stringify(oldP.goals ?? null) !== JSON.stringify(newP.goals ?? null)) {
    const primary = newP.goals?.primary;
    changes.push({
      field: "goals",
      kind: oldP.goals ? (newP.goals ? "changed" : "removed") : "added",
      text: primary ? `Goal is now: ${primary}` : "Goal updated",
    });
  }

  return changes;
}

function pushSetDiff(out: ProfileChange[], field: ProfileField, before: string[], after: string[], noun: string) {
  const beforeSet = new Set(before.map(norm).filter(Boolean));
  const afterSet = new Set(after.map(norm).filter(Boolean));

  const added = after.filter((v) => norm(v) && !beforeSet.has(norm(v)));
  const removed = before.filter((v) => norm(v) && !afterSet.has(norm(v)));

  // `.map(clip)` here would hand clip() the ARRAY INDEX as its `max` argument, so the first
  // item lost its last character and the second became a bare ellipsis. Caught by
  // siteProfile.test.ts; the arrow is what stops it coming back.
  if (added.length) out.push({ field, kind: "added", text: `${added.length} new ${plural(noun, added.length)}: ${added.slice(0, 5).map((v) => clip(v)).join(", ")}${added.length > 5 ? ", …" : ""}` });
  if (removed.length) out.push({ field, kind: "removed", text: `${removed.length} ${plural(noun, removed.length)} gone: ${removed.slice(0, 5).map((v) => clip(v)).join(", ")}${removed.length > 5 ? ", …" : ""}` });
}

function plural(noun: string, n: number): string {
  return n === 1 ? noun : `${noun}s`;
}

function norm(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function clip(s: string, max = 90): string {
  const v = String(s ?? "").trim().replace(/\s+/g, " ");
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`;
}

function label(field: ProfileField): string {
  const LABELS: Partial<Record<ProfileField, string>> = {
    what_they_do: "What the business does",
    audience: "Who they sell to",
    geo: "Location / service area",
    language: "Language",
  };
  return LABELS[field] ?? field;
}
