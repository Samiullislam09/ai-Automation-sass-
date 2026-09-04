/** The Site Brain's shape, on the web side (rebuild plan §25.2).
 *
 *  This is a deliberate MIRROR of agent-server/src/lib/siteProfile.ts, not a second source of
 *  truth. It exists because agent-server is a separate package and is excluded from this app's
 *  tsconfig ("exclude": ["node_modules", "agent-server", "packages"]), so the real type cannot
 *  be imported here without dragging its `../supabase.js` import into the Next build. Anything
 *  changed there must be changed here; the field list below is the thing to keep in step.
 *
 *  It carries three jobs, and nothing else:
 *    · the types, so the page and the route agree on what a profile is;
 *    · `coerceField`, which is the ONLY gate between a PATCH body and the jsonb column — a
 *      field the user edits must come back out the same shape the analyst put in, or the next
 *      agent run crashes on `profile.offerings.map`;
 *    · the labels and grouping the screen reads, kept beside the field list so a new field
 *      cannot be added without deciding where a human would look for it.
 *
 *  No server imports (no next/headers, no supabase) — it is imported by both the route handler
 *  and the client page.
 */

// ── the shape (mirror of siteProfile.ts) ────────────────────────────────────────────────────

export type Offering = { name: string; url: string | null; kind: "product" | "service" | "unknown" };
export type Proof = { claim: string; quote: string | null; url: string | null };
export type TopicCluster = { name: string; page_urls: string[]; centroid: number[] | null; size: number };
export type ContentGap = {
  query: string;
  impressions: number;
  position: number | null;
  nearest_similarity: number | null;
  nearest_url: string | null;
  nearest_cluster: string | null;
};
export type Voice = { tone: string | null; do: string[]; dont: string[]; samples: string[] };
/** `focus` is onboarding's "kaunse 3 offerings sabse zaroori?" (§25.7) — the offerings the
 *  business actually wants grown, which is not the same as the offerings it happens to list.
 *  The planner reads it to weight topics; without it every offering looks equally important
 *  and the team spends the month writing about the one that pays least. */
export type Goals = { primary: "leads" | "traffic" | "sales" | null; kpis: string[]; focus: string[] };
export type Confidence = "high" | "medium" | "low";

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
  confidence: Partial<Record<ProfileField, Confidence>>;
  sources: Partial<Record<ProfileField, string[]>>;
  /** Fields a human corrected by hand. analyst.ts reads `previous.profile.user_edited` and
   *  copies each named field forward untouched — a flat array of field names, nothing else. */
  user_edited?: ProfileField[];
};

export type BuiltFrom = {
  pages?: number;
  page_urls?: string[];
  gsc_period?: { start: string | null; end: string | null } | null;
  gsc_queries?: number;
  [key: string]: unknown;
};

export type ProfileVersion = {
  id: string;
  version: number;
  created_at: string;
  created_by: string;
  active: boolean;
  pages?: number | null;
};

export function isProfileField(v: unknown): v is ProfileField {
  return typeof v === "string" && (PROFILE_FIELDS as readonly string[]).includes(v);
}

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

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Same defensive merge as the agent's normalizeProfile: a row written by an older build, or
 *  hand-edited in the SQL editor, must not be able to crash a render with "not iterable". */
export function normalizeProfile(raw: unknown): SiteProfile {
  const base = emptyProfile();
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Partial<SiteProfile>;
  return {
    ...base,
    ...p,
    offerings: asArray<Offering>(p.offerings),
    buyer_intent: asArray<string>(p.buyer_intent),
    proof: asArray<Proof>(p.proof),
    topic_clusters: asArray<TopicCluster>(p.topic_clusters),
    content_gaps: asArray<ContentGap>(p.content_gaps),
    competitors: asArray<string>(p.competitors),
    confidence: (p.confidence && typeof p.confidence === "object" ? p.confidence : {}) as SiteProfile["confidence"],
    sources: (p.sources && typeof p.sources === "object" ? p.sources : {}) as SiteProfile["sources"],
    user_edited: asArray<ProfileField>(p.user_edited).filter(isProfileField),
  };
}

// ── validation: the only gate between a PATCH body and the jsonb column ──────────────────────

// Flat, not a discriminated union, for the same reason lib/agent-jobs.ts is: this repo
// compiles with strict:false, where TS cannot narrow `ok: true | false` unions at all — the
// union version type-checks in isolation and then fails at the one call site that reads
// `.error` after checking `.ok`.
export type CoerceResult = { ok: boolean; value?: unknown; error?: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const nullableStr = (v: unknown): string | null => (str(v) ? str(v) : null);

/** A URL we are willing to print as a link. Anything else becomes null rather than being
 *  rendered — §25.2's "nothing on this page fabricates a source link" has a twin obligation:
 *  nothing on this page renders a link it cannot vouch for either (a `javascript:` href typed
 *  into an offering URL would otherwise be stored and clicked). */
export function safeHttpUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split("\n")).map((x) => str(x)).filter(Boolean).slice(0, 60);

const num = (v: unknown, fallback: number | null = null): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Turn whatever the browser sent for one field into exactly the shape the agent expects.
 *  Returns an error string (never throws) so the route can answer 400 with the reason. */
export function coerceField(field: ProfileField, raw: unknown): CoerceResult {
  switch (field) {
    case "what_they_do":
    case "audience":
    case "geo":
    case "language":
      if (raw !== null && typeof raw !== "string") return { ok: false, error: `"${field}" must be text.` };
      return { ok: true, value: nullableStr(raw) };

    case "buyer_intent":
    case "competitors":
      return { ok: true, value: strList(raw) };

    case "offerings": {
      if (!Array.isArray(raw)) return { ok: false, error: `"offerings" must be a list.` };
      const out: Offering[] = [];
      for (const item of raw.slice(0, 100)) {
        const o = (item ?? {}) as Partial<Offering>;
        const name = str(o.name);
        if (!name) continue; // a nameless offering is not an offering — drop, don't error
        const kind = o.kind === "product" || o.kind === "service" ? o.kind : "unknown";
        out.push({ name, url: safeHttpUrl(o.url), kind });
      }
      return { ok: true, value: out };
    }

    case "proof": {
      if (!Array.isArray(raw)) return { ok: false, error: `"proof" must be a list.` };
      const out: Proof[] = [];
      for (const item of raw.slice(0, 100)) {
        const p = (item ?? {}) as Partial<Proof>;
        const claim = str(p.claim);
        if (!claim) continue;
        out.push({ claim, quote: nullableStr(p.quote), url: safeHttpUrl(p.url) });
      }
      return { ok: true, value: out };
    }

    case "topic_clusters": {
      if (!Array.isArray(raw)) return { ok: false, error: `"topic_clusters" must be a list.` };
      const out: TopicCluster[] = [];
      for (const item of raw.slice(0, 60)) {
        const c = (item ?? {}) as Partial<TopicCluster>;
        const name = str(c.name);
        if (!name) continue;
        const page_urls = (Array.isArray(c.page_urls) ? c.page_urls : []).map((u) => str(u)).filter(Boolean);
        // The centroid is 1024 floats the clustering wrote. It is carried through untouched:
        // a renamed cluster is still the same cluster, and Mr. Keyword's fit score depends on
        // this vector. Nothing in the UI ever produces or edits it.
        const centroid = Array.isArray(c.centroid) ? (c.centroid as unknown[]).map((n) => Number(n) || 0) : null;
        out.push({ name, page_urls, centroid, size: num(c.size, page_urls.length) ?? page_urls.length });
      }
      return { ok: true, value: out };
    }

    case "content_gaps": {
      if (!Array.isArray(raw)) return { ok: false, error: `"content_gaps" must be a list.` };
      const out: ContentGap[] = [];
      for (const item of raw.slice(0, 100)) {
        const g = (item ?? {}) as Partial<ContentGap>;
        const query = str(g.query);
        if (!query) continue;
        out.push({
          query,
          impressions: num(g.impressions, 0) ?? 0,
          position: num(g.position, null),
          nearest_similarity: num(g.nearest_similarity, null),
          nearest_url: safeHttpUrl(g.nearest_url),
          nearest_cluster: nullableStr(g.nearest_cluster),
        });
      }
      return { ok: true, value: out };
    }

    case "voice": {
      if (raw === null) return { ok: true, value: null };
      if (typeof raw !== "object") return { ok: false, error: `"voice" must be an object.` };
      const v = raw as Partial<Voice>;
      const value: Voice = { tone: nullableStr(v.tone), do: strList(v.do), dont: strList(v.dont), samples: strList(v.samples) };
      const empty = !value.tone && !value.do.length && !value.dont.length && !value.samples.length;
      return { ok: true, value: empty ? null : value };
    }

    case "goals": {
      if (raw === null) return { ok: true, value: null };
      if (typeof raw !== "object") return { ok: false, error: `"goals" must be an object.` };
      const g = raw as Partial<Goals>;
      const primary = g.primary === "leads" || g.primary === "traffic" || g.primary === "sales" ? g.primary : null;
      const kpis = strList(g.kpis);
      // Three, because the screen asks for three. A "priority" list of eight is a list.
      const focus = strList(g.focus).slice(0, 3);
      return { ok: true, value: primary || kpis.length || focus.length ? { primary, kpis, focus } : null };
    }

    default:
      return { ok: false, error: `Unknown field "${field}".` };
  }
}

/** True when a field holds nothing we can honestly show. Drives the "pata nahi" state — a
 *  field with no evidence is printed as a blank to fill in, never as invented prose. */
export function isFieldEmpty(profile: SiteProfile, field: ProfileField): boolean {
  const v = (profile as any)[field];
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (field === "voice") return !v.tone && !v.do?.length && !v.dont?.length;
  if (field === "goals") return !v.primary && !v.kpis?.length && !v.focus?.length;
  if (typeof v === "string") return !v.trim();
  return false;
}

// ── how a person reads this ─────────────────────────────────────────────────────────────────

export type FieldMeta = {
  field: ProfileField;
  /** The heading, in the words the owner would use. */
  label: string;
  /** One line under it, saying what the agents do with this field. */
  hint: string;
  /** Placeholder shown when the field is empty and the user is about to fill it in. */
  prompt: string;
  /** Derived fields are computed from crawl + Search Console. They are still editable, but the
   *  editor warns that an edit freezes them, because that is what §25.9 promises. */
  derived?: boolean;
};

export type FieldGroup = { title: string; sub: string; fields: FieldMeta[] };

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: "What you do",
    sub: "The one paragraph every agent reads before it writes a word.",
    fields: [
      {
        field: "what_they_do",
        label: "What this business does",
        hint: "Read off your homepage, about and services pages.",
        prompt: "e.g. ISO certification consultancy — 9001/14001/27001 audits, documentation and training, India and UAE.",
      },
    ],
  },
  {
    title: "Who you serve",
    sub: "Who the writing is aimed at, and what they are actually trying to find out.",
    fields: [
      { field: "audience", label: "Who you sell to", hint: "Used for tone, examples and Mr. Lead's ICP.", prompt: "e.g. SME owners and quality managers" },
      {
        field: "buyer_intent",
        label: "What those buyers want to know",
        hint: "One question per line. These become article angles.",
        prompt: "e.g. how long does it take\ne.g. what does it cost",
      },
    ],
  },
  {
    title: "What you sell",
    sub: "Every call to action comes from this list. Without it the writer falls back to “contact us”.",
    fields: [
      {
        field: "offerings",
        label: "Offerings",
        hint: "An offering keeps its page link so an article can point at the real thing.",
        prompt: "Add the services or products you actually sell.",
      },
    ],
  },
  {
    title: "What you can prove",
    sub: "The only facts about your business an article is allowed to state.",
    fields: [
      {
        field: "proof",
        label: "Proven facts",
        hint: "Each one survives only if its exact words appear on a page we read.",
        prompt: "e.g. IRCA-registered lead auditors",
      },
    ],
  },
  {
    title: "The subjects you cover",
    sub: "Your pages, grouped. Mr. Keyword scores every suggestion against these, which is why it stops proposing off-topic work.",
    fields: [
      {
        field: "topic_clusters",
        label: "Topic clusters",
        hint: "Grouped from your pages by meaning, not by keyword.",
        prompt: "Nothing clustered yet — the crawl has to run first.",
        derived: true,
      },
    ],
  },
  {
    title: "What people search that you do not answer",
    sub: "Measured from Search Console: searches you already appear for, with no page of yours answering them.",
    fields: [
      {
        field: "content_gaps",
        label: "Content gaps",
        hint: "The planner's first priority — these are the cheapest wins you have.",
        prompt: "Connect Google Search Console and these fill themselves in.",
        derived: true,
      },
    ],
  },
  {
    title: "Your voice",
    sub: "How the writing should sound, and what it must never do.",
    fields: [{ field: "voice", label: "House voice", hint: "Tone plus the do / do-not list handed to every writer.", prompt: "e.g. formal, no hype, “we” voice, numbers with sources" }],
  },
  {
    title: "Where you work",
    sub: "Location, language and the competitors you named.",
    fields: [
      { field: "geo", label: "Location / service area", hint: "Puts your city or region into titles and schema.", prompt: "e.g. India and UAE" },
      { field: "language", label: "Language", hint: "The language articles are written in.", prompt: "e.g. en" },
      { field: "competitors", label: "Competitors", hint: "One domain per line. Only ever what you tell us.", prompt: "e.g. competitor.com" },
    ],
  },
  {
    title: "What you are aiming for",
    sub: "Set during onboarding. It decides what the planner optimises for.",
    fields: [{ field: "goals", label: "Goal", hint: "Leads, traffic or sales — plus how you will measure it.", prompt: "Pick a primary goal so the planner has something to aim at." }],
  },
];

export const FIELD_META: Record<ProfileField, FieldMeta> = FIELD_GROUPS.reduce((acc, g) => {
  for (const f of g.fields) acc[f.field] = f;
  return acc;
}, {} as Record<ProfileField, FieldMeta>);

/** "Where did this come from" — the source list turned into things a person can click.
 *  A source that is not a URL ("onboarding", "google-search-console", "user") is returned as a
 *  plain label, never dressed up as a link. Nothing is invented: an empty list stays empty. */
export function describeSources(sources: string[] | undefined): { label: string; href: string | null }[] {
  if (!Array.isArray(sources)) return [];
  const seen = new Set<string>();
  const out: { label: string; href: string | null }[] = [];
  for (const raw of sources) {
    const s = String(raw ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const href = safeHttpUrl(s);
    if (href) {
      let label = href;
      try {
        const u = new URL(href);
        label = (u.pathname === "/" ? u.hostname : u.pathname) + (u.search || "");
      } catch {
        /* keep the full string */
      }
      out.push({ label, href });
    } else {
      out.push({ label: SOURCE_LABELS[s] ?? s, href: null });
    }
  }
  return out;
}

const SOURCE_LABELS: Record<string, string> = {
  user: "you told us",
  onboarding: "your onboarding answers",
  "google-search-console": "Google Search Console",
};

/** Plain-English names for the twelve fields. FIELD_META's labels are written for the editor;
 *  these are what a business owner would call the same thing, and they are what the Site Brain
 *  list and the per-field page show. */
export const FRIENDLY_LABEL: Record<ProfileField, string> = {
  what_they_do: "What your business does",
  offerings: "What you sell",
  audience: "Who you sell to",
  buyer_intent: "What buyers ask before they buy",
  proof: "Facts we are allowed to claim",
  topic_clusters: "Subjects your site covers",
  content_gaps: "Questions your site doesn't answer",
  voice: "How your writing should sound",
  geo: "Where you work",
  language: "Language you publish in",
  competitors: "Your competitors",
  goals: "What you want from this",
};

/** One line of an answer, for a closed list row — never the whole thing. */
export function previewOf(profile: SiteProfile, field: ProfileField): string {
  const v: any = (profile as any)[field];
  const cut = (t: string) => (t.length > 110 ? t.slice(0, 110).trimEnd() + "…" : t);
  if (typeof v === "string") return cut(v);
  if (Array.isArray(v)) {
    const names = v
      .map((x: any) => (typeof x === "string" ? x : x?.name ?? x?.claim ?? x?.query ?? ""))
      .filter(Boolean);
    const head = names.slice(0, 3).join(" · ");
    return cut(`${v.length} — ${head}${names.length > 3 ? " …" : ""}`);
  }
  if (field === "voice" && v) {
    const parts = [v.tone, v.do?.length ? `${v.do.length} do` : "", v.dont?.length ? `${v.dont.length} never` : ""].filter(Boolean);
    return cut(parts.join(" · ") || "Set");
  }
  if (field === "goals" && v) {
    const parts = [v.primary, v.focus?.length ? `${v.focus.length} focus areas` : ""].filter(Boolean);
    return cut(parts.join(" · ") || "Set");
  }
  return "Added";
}

export const CONFIDENCE_COPY: Record<Confidence, { label: string; tone: "ok" | "warn" | "low"; note: string }> = {
  high: { label: "High confidence", tone: "ok", note: "Stated plainly on the pages linked beside it." },
  medium: { label: "Medium confidence", tone: "warn", note: "Read off your site, but worth a glance." },
  low: { label: "Low confidence — a guess, please confirm", tone: "low", note: "We inferred this. Confirm or correct it before it ends up in an article." },
};
