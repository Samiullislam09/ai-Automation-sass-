"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity, ArrowRight, Brain, Check, ChevronLeft, ChevronRight, Loader2, PlugZap, Plus, RotateCw, Search,
  Sparkles, X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import SiteBrainField, { SiteBrainFieldStyles } from "@/components/SiteBrainField";
import {
  FIELD_META,
  FRIENDLY_LABEL,
  isFieldRelevant,
  previewOf,
  SITE_TYPE_LABEL,
  USER_ONLY_FIELDS,
  isFieldEmpty,
  normalizeProfile,
  PROFILE_FIELDS,
  type BuiltFrom,
  type ProfileField,
  type ProfileVersion,
  type SiteProfile,
} from "@/components/SiteBrainModel";

/** /dashboard/site-brain — page chrome rebuilt 2026-09-05 on the same quiet theme as Memory:
 *  one panel, a header with the two real actions, a plain summary line, and the field groups as
 *  neutral cards. Neutral surfaces, one indigo accent — the colour on this page should come
 *  from the content, not the chrome.
 *
 *  Logic and API calls are unchanged: /api/site-brain GET/PATCH and /api/agents/trigger. The
 *  field editor (components/SiteBrainField.tsx — offerings, proof, topic clusters,
 *  voice, goals, RepeatRows) is reused unmodified: real, complex, tested logic, and
 *  MrLxwaDashboard remaps the old theme's CSS tokens so it renders in-theme (see the "legacy
 *  /app/** theme bridge" comment there). */

type Payload = {
  ok: boolean;
  error?: string;
  schemaReady: boolean;
  pagesCrawled: number;
  profile: SiteProfile | null;
  version: number | null;
  builtAt: string | null;
  builtBy: string | null;
  builtFrom: BuiltFrom;
  history: ProfileVersion[];
};

/** One jobs_log row as /api/site-brain/status hands it over. */
type BrainJob = {
  id: string;
  status: "queued" | "running" | "success" | "error" | "skipped" | string;
  action: string;
  createdAt: string;
  stalled: boolean;
  progress: { phase: string | null; label: string | null; done: number | null; total: number | null; current: string | null; at: string | null };
  error: { message: string; cause: string | null; hint: string | null; attempt: number | null; attempts: number | null; durationMs: number | null } | null;
};
type BrainJobs = { crawler: BrainJob | null; analyst: BrainJob | null };

const POLL_MS = 3000;
// A crawl of a normal site plus six LLM calls is two to six minutes. Twelve is "something
// else is wrong" — and /api/site-brain/status's own `stalled` usually says so first.
const POLL_TIMEOUT_MS = 12 * 60_000;

/** Filling the brain is two jobs in a row — the crawler reads the pages and then enqueues the
 *  analyst (agent-server/src/agents/crawler.ts) — so the bar runs across both. The phase ids
 *  are the ones those two agents actually report to `ctx.onProgress`; the fractions are how
 *  much of the bar each stage owns, and inside a phase with done/total the bar moves with the
 *  real count. Nothing here is a timer pretending to be progress. */
const BRAIN_PHASES: { id: string; agent: "crawler" | "analyst"; label: string; from: number; to: number }[] = [
  { id: "discovering", agent: "crawler", label: "Finding your pages", from: 0, to: 0.06 },
  { id: "reading", agent: "crawler", label: "Reading them", from: 0.06, to: 0.3 },
  { id: "summarising", agent: "crawler", label: "Working out the business", from: 0.3, to: 0.36 },
  { id: "loading", agent: "analyst", label: "Opening what we know", from: 0.36, to: 0.4 },
  { id: "reading", agent: "analyst", label: "What they do", from: 0.4, to: 0.46 },
  { id: "offerings", agent: "analyst", label: "What they sell", from: 0.46, to: 0.54 },
  { id: "proof", agent: "analyst", label: "What they can prove", from: 0.54, to: 0.62 },
  { id: "voice", agent: "analyst", label: "How they write", from: 0.62, to: 0.7 },
  { id: "commerce", agent: "analyst", label: "How they sell and charge", from: 0.7, to: 0.78 },
  { id: "place", agent: "analyst", label: "Where they work", from: 0.78, to: 0.84 },
  { id: "clustering", agent: "analyst", label: "Grouping the topics", from: 0.84, to: 0.9 },
  { id: "gaps", agent: "analyst", label: "Checking Search Console", from: 0.9, to: 0.97 },
  { id: "saving", agent: "analyst", label: "Writing the profile", from: 0.97, to: 1 },
];
// "reading" is a phase id both agents use, so a phase is only ever looked up together with
// the agent whose row it came from.
function phaseIndex(agent: "crawler" | "analyst", phase: string | null): number {
  if (!phase) return -1;
  return BRAIN_PHASES.findIndex((p) => p.agent === agent && p.id === phase);
}
/** The live stage: the analyst's row wins once it exists and is running, because by then the
 *  crawler is finished and its row is only history. */
function liveStage(jobs: BrainJobs | null, sinceCrawler: string | null, sinceAnalyst: string | null):
  { agent: "crawler" | "analyst"; job: BrainJob } | null {
  const a = jobs?.analyst;
  if (a && a.id !== sinceAnalyst && (a.status === "running" || a.status === "queued")) return { agent: "analyst", job: a };
  const c = jobs?.crawler;
  if (c && c.id !== sinceCrawler && (c.status === "running" || c.status === "queued")) return { agent: "crawler", job: c };
  if (a && a.id !== sinceAnalyst) return { agent: "analyst", job: a };
  if (c && c.id !== sinceCrawler) return { agent: "crawler", job: c };
  return null;
}

export default function SiteBrainSection() {
  const { toast, report } = useStore();
  const [state, setState] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ProfileField | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [openField, setOpenField] = useState<ProfileField | null>(null);
  const [jobs, setJobs] = useState<BrainJobs | null>(null);
  // `since*`: the rows that already existed when we started watching (the previous run's), so
  // a finished older run is never mistaken for this one — and `sinceVersion` is the profile
  // version we are waiting to see change.
  const [polling, setPolling] = useState<{ sinceCrawler: string | null; sinceAnalyst: string | null; sinceVersion: number | null; startedAt: number } | null>(null);

  const load = useCallback(async (): Promise<Payload | null> => {
    setLoading(true);
    try {
      const data: Payload = await fetch("/api/site-brain").then((r) => r.json());
      if (data.ok) {
        setState({ ...data, profile: data.profile ? normalizeProfile(data.profile) : null });
        return data;
      }
      toast(data.error || "Couldn't load your Site Brain.", "error");
    } catch {
      toast("Couldn't load your Site Brain — try refreshing.", "error");
    } finally {
      setLoading(false);
    }
    return null;
  }, [toast]);

  /** The two jobs as jobs_log has them right now. Null when the endpoint could not be read —
   *  never a guess. */
  const fetchStatus = useCallback(async (): Promise<BrainJobs | null> => {
    try {
      const d = await fetch("/api/site-brain/status").then((r) => r.json());
      if (d.ok) {
        setJobs(d.jobs ?? null);
        return d.jobs ?? null;
      }
    } catch {
      /* the next poll tries again */
    }
    return null;
  }, []);

  useEffect(() => {
    // A run started elsewhere — the weekly schedule, another tab, the chat — is followed the
    // same way as one started from this button.
    load().then(async (d) => {
      const j = await fetchStatus();
      const live = liveStage(j, null, null);
      if (live && (live.job.status === "running" || live.job.status === "queued") && !live.job.stalled) {
        setPolling({
          sinceCrawler: null,
          sinceAnalyst: null,
          sinceVersion: d?.version ?? null,
          startedAt: Date.parse(live.job.createdAt) || Date.now(),
        });
      }
    });
  }, [load, fetchStatus]);

  // Real progress: poll jobs_log until the analyst writes a new profile version, or a row
  // fails, or a run goes quiet, or we hit the ceiling — each with its own sentence.
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(async () => {
      const j = await fetchStatus();
      const live = liveStage(j, polling.sinceCrawler, polling.sinceAnalyst);
      if (live && (live.job.status === "error" || live.job.status === "skipped")) {
        setPolling(null);
        await load();
        toast("The run failed — the reason is on the page.", "error");
        return;
      }
      if (live && live.job.stalled) {
        setPolling(null);
        await load();
        toast("The run stopped responding — details on the page.", "error");
        return;
      }
      // Finished means a NEW profile version is on file: the analyst's last act is saving it,
      // so this is the only honest "done".
      if (live && live.agent === "analyst" && live.job.status === "success") {
        const d = await load();
        if (d && d.version !== polling.sinceVersion) {
          setPolling(null);
          toast("Done — your Site Brain has been rebuilt.");
          return;
        }
      }
      if (Date.now() - polling.startedAt > POLL_TIMEOUT_MS) {
        setPolling(null);
        toast("This is taking far longer than it should — the last thing it reported is on the page.", "error");
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling?.startedAt]);

  const save = async (field: ProfileField, value: unknown): Promise<boolean> => {
    setBusy(field);
    try {
      const res = await fetch("/api/site-brain", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || "Couldn't save that change.", "error");
        return false;
      }
      if (data.unchanged) {
        toast("Nothing changed.");
        return true;
      }
      setState((prev) =>
        prev ? { ...prev, profile: normalizeProfile(data.profile), version: data.version, builtAt: data.builtAt, builtBy: "user" } : prev
      );
      report(`You corrected the Site Brain: ${field.replace(/_/g, " ")} (now v${data.version}).`);
      toast("Saved — the team will use your version from now on.");
      return true;
    } catch {
      toast("Couldn't save — network error.", "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (type: "crawler" | "analyst") => {
    setRefreshing(true);
    // Whatever is in jobs_log right now is the PREVIOUS run; remember it before the trigger so
    // the progress bar never reads the old run's finished row as this one's.
    const before = await fetchStatus();
    try {
      const res = await fetch("/api/agents/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || "Couldn't start the refresh.", "error");
        return;
      }
      toast(
        type === "crawler"
          ? "Reading your site — the progress is on this page."
          : "Rebuilding the profile from the pages we already have."
      );
      setPolling({
        sinceCrawler: before?.crawler?.id ?? null,
        // A crawler run chains into the analyst, so the analyst's current row is also "before".
        sinceAnalyst: before?.analyst?.id ?? null,
        sinceVersion: state?.version ?? null,
        startedAt: Date.now(),
      });
    } catch {
      toast("Couldn't start the refresh — network error.", "error");
    } finally {
      setRefreshing(false);
    }
  };

  // What to show above the page: the live bar while a run is being watched, or — when nothing
  // is running — the last run's failure, if it failed after the profile we are looking at was
  // written (an older failure is history, not news).
  const live = liveStage(jobs, polling?.sinceCrawler ?? null, polling?.sinceAnalyst ?? null);
  const running = live && (live.job.status === "running" || live.job.status === "queued") && !live.job.stalled ? live : null;
  const newest = [jobs?.crawler, jobs?.analyst]
    .filter(Boolean)
    .sort((a, b) => Date.parse(b!.createdAt) - Date.parse(a!.createdAt))[0] as BrainJob | undefined;
  const failed =
    !polling &&
    newest &&
    (newest.status === "error" || newest.status === "skipped" || newest.stalled) &&
    (!state?.builtAt || Date.parse(newest.createdAt) > Date.parse(state.builtAt))
      ? newest
      : null;
  const banner = (
    <>
      {polling && <BrainProgress stage={running} startedAt={polling.startedAt} />}
      {failed && <BrainFailure job={failed} busy={refreshing} onRetry={() => refresh("crawler")} />}
    </>
  );

  if (loading && !state) {
    return (
      <Shell>
        <div className="sb-loading"><Loader2 size={16} className="sb-spin lx-mut" /><span className="lx-11 lx-mut">Loading…</span></div>
      </Shell>
    );
  }

  const s = state;
  if (!s) {
    return (
      <Shell>
        <Empty Icon={Brain} title="Couldn't load it" body="Something went wrong reading your Site Brain. Refresh the page to try again." />
      </Shell>
    );
  }

  if (!s.schemaReady) {
    return (
      <Shell>
        <Empty
          Icon={Brain}
          title="Not set up on this database yet"
          body="The Site Brain tables (migration 019) haven't been applied here. Nothing you can do from this screen — this one is for whoever runs the database."
        />
      </Shell>
    );
  }

  if (!s.pagesCrawled) {
    return (
      <Shell banner={banner}>
        <Empty
          Icon={PlugZap}
          title="We haven't read your site yet"
          body="The Site Brain is built from your own pages. Connect your website and we'll read it — then this page fills itself in."
          action={<Link href="/dashboard/connect" className="sb-primary">Connect your website</Link>}
        />
      </Shell>
    );
  }

  if (!s.profile) {
    return (
      <Shell banner={banner}>
        <Empty
          Icon={Search}
          title={`${s.pagesCrawled} pages read — nothing understood yet`}
          body="Mr. Analyst turns those pages into the profile every other agent reads. He may still be working; if not, start him here."
          action={
            <button className="sb-primary" disabled={refreshing || !!polling} onClick={() => refresh("analyst")}>
              {refreshing ? "Starting…" : polling ? "Working…" : "Understand my site"}
            </button>
          }
        />
      </Shell>
    );
  }

  const profile = s.profile;
  const filled = (f: ProfileField) => !isFieldEmpty(profile, f);
  // Only what actually applies to this kind of site is counted — a blog is not "missing" a
  // price list. See NOT_APPLICABLE in SiteBrainModel.
  const applies = PROFILE_FIELDS.filter((f) => isFieldRelevant(profile, f));
  const skipped = PROFILE_FIELDS.filter((f) => !isFieldRelevant(profile, f));
  const known = applies.filter(filled).length;
  const missing = applies.length - known;
  const pct = Math.round((known / applies.length) * 100);
  // The team fills what it can read off the site; only the owner can answer the rest, so the
  // "next gap" points at the ones a human actually has to answer.
  const firstGap = applies.find((f) => !filled(f) && USER_ONLY_FIELDS.includes(f))
    ?? applies.find((f) => !filled(f))
    ?? null;
  const typeLabel = profile.site_type ? SITE_TYPE_LABEL[profile.site_type] : null;

  return (
    <Shell
      banner={banner}
      right={
        <>
          {/* the whole point: the customer shouldn't fill anything in. This runs Mr. Analyst
              over the pages already crawled and writes every field it finds evidence for. */}
          {/* ONE button. It enqueues the crawler, which chains into the analyst itself
              (agent-server/src/agents/crawler.ts), so a single click re-reads the site and
              rewrites every field from it. */}
          <button className="sb-primary" disabled={refreshing || !!polling} onClick={() => refresh("crawler")} title="Read my site and fill all of this in">
            {refreshing || polling ? <Loader2 size={14} className="sb-spin" /> : <Sparkles size={14} />}
            {refreshing ? "Starting…" : polling ? "Working…" : "Fill it in for me"}
          </button>
          <Link href="/dashboard/workspace" className="sb-btn"><Activity size={14} /> Watch</Link>
        </>
      }
    >
      {/* overview — cards, the same shape the Memory page's fact cards use */}
      <div className="sb-sec">Overview</div>
      <div className="sb-cards">
        <div className="sb-card">
          <div className="sb-card-k">What we know</div>
          <div className="sb-card-v">{known} of {applies.length} things</div>
          <div className="sb-bar"><i style={{ width: `${pct}%` }} /></div>
          {firstGap ? (
            <button className="sb-card-a" onClick={() => setOpenField(firstGap)}>Fill the next gap <ArrowRight size={12} /></button>
          ) : (
            <span className="sb-card-done">Nothing missing</span>
          )}
        </div>

        <div className="sb-card">
          <div className="sb-card-k">Kind of site</div>
          <div className="sb-card-v">{typeLabel ?? "Not worked out yet"}</div>
          <div className="sb-card-s">{typeLabel && skipped.length ? `${skipped.length} skipped` : " "}</div>
          <button className="sb-card-a" onClick={() => setOpenField("site_type")}>
            {typeLabel ? "Change it" : "Set it"}
          </button>
        </div>

        <div className="sb-card">
          <div className="sb-card-k">Read from your site</div>
          <div className="sb-card-v">{s.builtFrom?.pages ?? s.pagesCrawled} pages</div>
          <div className="sb-card-s">&nbsp;</div>
          <button className="sb-card-a" disabled={refreshing || !!polling} onClick={() => refresh("crawler")}>
            {refreshing ? "Starting…" : polling ? "Working…" : "Read again"}
          </button>
        </div>

        <div className="sb-card">
          <div className="sb-card-k">Version</div>
          <div className="sb-card-v">v{s.version} {s.builtBy === "user" ? "· your edit" : "· by the team"}</div>
          <div className="sb-card-s">
            {s.builtAt ? new Date(s.builtAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Never built"}
          </div>
          {s.history.length > 1 && (
            <button className="sb-card-a" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Hide history" : `${s.history.length} versions`}
            </button>
          )}
        </div>
      </div>

      <div className="sb-sec">What your team knows</div>
      <p className="sb-note">Read off your site automatically. Only the <span className="sb-only">Needs you</span> ones can&rsquo;t be.</p>

      {/* the whole brain as one plain checklist — each line opens a popup to read, add or
          correct that one fact (owner, 2026-09-05: popup, not a separate page) */}
      <div className="sb-list">
        {applies.map((f) => {
          const has = filled(f);
          const userOnly = USER_ONLY_FIELDS.includes(f);
          return (
            <button key={f} className={`sb-item ${has ? "" : "gap"}`} onClick={() => setOpenField(f)}>
              <span className={`sb-mark ${has ? "ok" : ""}`}>{has ? <Check size={12} /> : <Plus size={12} />}</span>
              <span className="min-w-0 flex-1">
                <span className="sb-item-t">
                  {FRIENDLY_LABEL[f] ?? FIELD_META[f].label}
                  {userOnly && !has && <span className="sb-only">Needs you</span>}
                </span>
                <span className="sb-item-p">
                  {has ? previewOf(profile, f) : userOnly ? "Tell the team once" : "Not found yet"}
                </span>
              </span>
              <span className="sb-go">{has ? "View" : "Add"} <ChevronRight size={14} /></span>
            </button>
          );
        })}
      </div>

      {skipped.length > 0 && (
        <>
          <div className="sb-sec">Not needed here</div>
          <div className="sb-skipped">
            {skipped.map((f) => (
              <button key={f} className="sb-skip" onClick={() => setOpenField(f)} title="Open it anyway">
                {FRIENDLY_LABEL[f] ?? FIELD_META[f].label}
              </button>
            ))}
          </div>
        </>
      )}

      {openField && (
        <FieldPopup
          field={openField}
          profile={profile}
          busy={busy === openField}
          onSave={save}
          onClose={() => setOpenField(null)}
          onGo={setOpenField}
        />
      )}

      <SiteBrainFieldStyles />
    </Shell>
  );
}

/* ---------------------------------------------------------------------------------------- */

/** The run in progress, as a real bar: which of the two agents is working, the step it is on,
 *  how far through that step (done of total, straight from jobs_log), and the clock. `stage` is
 *  null while pg-boss is still handing the job to a worker — said as "Queued", not faked as
 *  progress. */
function BrainProgress({ stage, startedAt }: { stage: { agent: "crawler" | "analyst"; job: BrainJob } | null; startedAt: number }) {
  const p = stage?.job.progress ?? null;
  const idx = stage ? phaseIndex(stage.agent, p?.phase ?? null) : -1;
  const ph = idx >= 0 ? BRAIN_PHASES[idx] : null;
  const inner = ph && p?.total && p.done != null ? Math.min(1, p.done / p.total) : 0;
  const pct = Math.max(1, Math.round((ph ? ph.from + (ph.to - ph.from) * inner : 0.01) * 100));
  const label = !stage
    ? "Queued — waiting for a worker to pick it up"
    : p?.label ?? (stage.agent === "crawler" ? "Reading your site…" : "Understanding your site…");
  const detail = p?.total && p.done != null ? `${p.done} of ${p.total}` : null;
  return (
    <div className="sb-prog" role="status" aria-live="polite">
      <div className="sb-prog-h">
        <span className="sb-dot" />
        <b className="sb-prog-l">{label}</b>
        {detail && <span className="sb-prog-d">{detail}</span>}
        <b className="sb-prog-p">{pct}%</b>
        <BrainElapsed startedAt={startedAt} />
      </div>
      <div className="sb-prog-bar"><i style={{ width: `${pct}%` }} /></div>
      <ol className="sb-steps">
        {BRAIN_PHASES.map((x, i) => {
          const st = idx < 0 ? "next" : i < idx ? "done" : i === idx ? "now" : "next";
          return (
            <li key={`${x.agent}-${x.id}`} className={`sb-step sb-step-${st}`}>
              <span className="sb-step-n">{st === "done" ? "✓" : i + 1}</span>
              {x.label}
            </li>
          );
        })}
      </ol>
      {p?.current && <div className="sb-prog-c">{p.current}</div>}
    </div>
  );
}

/** The last run's failure, readable on the page: what failed, the raw cause, what to do next.
 *  Every field is jobs_log's own (workers.ts's explainAgentError) — nothing is composed here. A
 *  run that went quiet shows what it last reported and when. */
function BrainFailure({ job, onRetry, busy }: { job: BrainJob; onRetry: () => void; busy: boolean }) {
  const stalled = job.status !== "error" && job.status !== "skipped" && job.stalled;
  const e = job.error;
  const mins = e?.durationMs != null ? Math.round(e.durationMs / 60000) : null;
  return (
    <div className="sb-fail" role="alert">
      <div className="sb-fail-b">
        <b className="sb-fail-t">{stalled ? "The last run stopped responding" : "The last run failed"}</b>
        <p className="sb-fail-p">
          {stalled
            ? `It last reported "${job.progress.label ?? job.progress.phase ?? "starting"}"${job.progress.at ? ` at ${new Date(job.progress.at).toLocaleTimeString()}` : ""} and has written nothing since.`
            : e?.message ?? "No reason was recorded."}
        </p>
        {!stalled && e?.cause && <pre className="sb-fail-c">{e.cause}</pre>}
        <p className="sb-fail-h">{stalled ? "Start it again — a fresh run is not affected by the one that hung." : e?.hint ?? "Run it again. If it fails the same way twice, the cause above is what to send to support."}</p>
        <p className="sb-fail-m">
          {job.action}
          {e?.attempt != null && e?.attempts != null && ` · attempt ${e.attempt} of ${e.attempts}`}
          {mins != null && ` · ran ${mins || "<1"} min`}
          {` · ${new Date(job.createdAt).toLocaleString()}`}
        </p>
      </div>
      <button className="sb-primary" disabled={busy} onClick={onRetry}>{busy ? "Starting…" : "Try again"}</button>
    </div>
  );
}

function BrainElapsed({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return <span className="sb-prog-d">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>;
}

function Shell({ children, right, banner }: { children: React.ReactNode; right?: React.ReactNode; banner?: React.ReactNode }) {
  return (
    <div className="sb-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <section className="sb-panel flex min-w-0 flex-1 flex-col">
        <header className="sb-head">
          <div className="min-w-0 flex-1">
            <h1 className="sb-h1">Site Brain</h1>
            <p className="sb-sub">What your team knows about your business.</p>
          </div>
          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </header>
        <div className="lx-scroll flex-1 overflow-y-auto px-5 pb-6 pt-4">
          {banner}
          {children}
        </div>
      </section>
    </div>
  );
}

/** One fact, in a popup: its name, what it is for, the answer with its sources, and the editor.
 *  An empty field opens straight into the editor — adding it is the only reason to be here.
 *  Escape and the backdrop close it; the arrows walk the twelve without closing. */
function FieldPopup({ field, profile, busy, onSave, onClose, onGo }: {
  field: ProfileField;
  profile: SiteProfile;
  busy: boolean;
  onSave: (f: ProfileField, v: unknown) => Promise<boolean>;
  onClose: () => void;
  onGo: (f: ProfileField) => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onClose]);

  const i = PROFILE_FIELDS.indexOf(field);
  const prev = i > 0 ? PROFILE_FIELDS[i - 1] : null;
  const next = i < PROFILE_FIELDS.length - 1 ? PROFILE_FIELDS[i + 1] : null;
  const empty = isFieldEmpty(profile, field);

  return (
    <div className="sb-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sb-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sb-sheet-h">
          <div className="min-w-0 flex-1">
            <div className="sb-sheet-t">{FRIENDLY_LABEL[field] ?? FIELD_META[field].label}</div>
            <div className="sb-sheet-s">{FIELD_META[field].hint}</div>
          </div>
          <button className="sb-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="lx-scroll sb-sheet-b">
          <SiteBrainField
            key={field}
            bare
            autoEdit={empty}
            meta={FIELD_META[field]}
            profile={profile}
            busy={busy}
            onSave={onSave}
          />
        </div>

        <footer className="sb-sheet-f">
          {prev ? (
            <button className="sb-navbtn" onClick={() => onGo(prev)}>
              <ChevronLeft size={14} /> <span className="truncate">{FRIENDLY_LABEL[prev]}</span>
            </button>
          ) : <span />}
          {next && (
            <button className="sb-navbtn ml-auto" onClick={() => onGo(next)}>
              <span className="truncate">{FRIENDLY_LABEL[next]}</span> <ChevronRight size={14} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Empty({ Icon, title, body, action }: { Icon: React.ElementType; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="sb-empty">
      <Icon size={20} className="lx-mut" />
      <b className="lx-12 mt-2">{title}</b>
      <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 440 }}>{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* Neutral surfaces, one indigo accent — same quiet language as the Memory page. Injected with
   dangerouslySetInnerHTML: React escapes ">" inside a <style> text child, which turns every
   child selector into a hydration mismatch. */
const CSS = `
.sb-wrap{display:flex;height:100%;min-height:0;container-type:inline-size;container-name:sb}
.sb-panel{background:#0a0a11;border:1px solid var(--lx-border);border-radius:16px;min-width:0;width:100%}
.sb-head{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:18px 20px 16px;border-bottom:1px solid var(--lx-border)}
.sb-h1{font-size:20px;font-weight:700;letter-spacing:-.01em;color:#f5f5fa;line-height:1.15}
.sb-sub{margin-top:3px;max-width:560px;font-size:12.5px;color:#8b8ba0;line-height:1.5}
.sb-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;border-radius:9px;white-space:nowrap;
  background:#191925;border:1px solid #262636;color:#d6d6e4;font-size:12.5px;font-weight:600;cursor:pointer;
  text-decoration:none;transition:.15s}
.sb-btn:hover:not(:disabled){color:#fff;border-color:#3a3a52}
.sb-btn:disabled{opacity:.5;cursor:not-allowed}
.sb-primary{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:9px;white-space:nowrap;
  background:#4f46e5;border:1px solid #6366f1;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;
  text-decoration:none;transition:.15s}
.sb-primary:hover:not(:disabled){background:#5b52ea}
.sb-primary:disabled{opacity:.55;cursor:not-allowed}
.sb-sec{font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#6f6f85}
.sb-list+.sb-sec,.sb-cards+.sb-sec,.sb-hist+.sb-sec{margin-top:22px}
.sb-working{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-bottom:12px;padding:11px 13px;border-radius:11px;
  background:rgba(79,70,229,.12);border:1px solid rgba(99,102,241,.4);color:#c7c7f0;font-size:12.5px}
.sb-note{margin-top:8px;font-size:11.5px;color:#7c7c95;line-height:1.6}
.sb-only{display:inline-flex;align-items:center;margin-left:8px;padding:2px 7px;border-radius:6px;font-size:9.5px;
  font-weight:700;letter-spacing:.03em;color:#a5b4fc;background:rgba(99,102,241,.14);border:1px solid rgba(99,102,241,.35)}
.sb-skipped{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.sb-skip{padding:6px 11px;border-radius:8px;background:#0d0d15;border:1px dashed #232332;color:#6f6f85;
  font-size:11.5px;cursor:pointer;transition:.15s}
.sb-skip:hover{color:#a8a8bd;border-color:#3a3a52}
.sb-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:10px}
@container sb (max-width:560px){.sb-cards{grid-template-columns:1fr}}
.sb-card{display:flex;flex-direction:column;padding:13px 14px;border-radius:12px;background:#101018;border:1px solid #1e1e2b}
.sb-card-k{font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#7c7c95}
.sb-card-v{margin-top:5px;font-size:13.5px;font-weight:600;color:#e9e9f2;line-height:1.45}
.sb-card-s{margin-top:4px;font-size:11px;color:#7c7c95;line-height:1.45}
.sb-card-a{align-self:flex-start;display:inline-flex;align-items:center;gap:4px;margin-top:10px;padding:0;background:none;
  border:none;font-size:11.5px;font-weight:600;color:#8f95ff;cursor:pointer}
.sb-card-a:hover:not(:disabled){text-decoration:underline}
.sb-card-a:disabled{opacity:.5;cursor:not-allowed}
.sb-card-done{margin-top:10px;font-size:11.5px;font-weight:600;color:#4ade80}
.sb-bar{display:block;height:5px;margin-top:9px;border-radius:999px;background:#1c1c29;overflow:hidden}
.sb-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#4f46e5,#8b5cf6)}
.sb-list{margin-top:10px;border-radius:12px;background:#101018;border:1px solid #1e1e2b;overflow:hidden}
.sb-item{display:flex;align-items:center;gap:12px;width:100%;padding:13px 15px;text-align:left;background:none;
  border:none;color:inherit;cursor:pointer;transition:.15s}
.sb-item+.sb-item{border-top:1px solid #1a1a26}
.sb-item:hover{background:#151520}
.sb-item:hover .sb-go{color:#fff;border-color:#3a3a52}
.sb-mark{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex-shrink:0;border-radius:50%;
  color:#f59e0b;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4)}
.sb-mark.ok{color:#4ade80;background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.35)}
.sb-item-t{display:block;font-size:13.5px;font-weight:600;color:#f0f0f7}
.sb-item-p{display:block;margin-top:2px;font-size:11.5px;color:#7c7c95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-item.gap .sb-item-p{color:#c08a2e}
.sb-go{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;height:28px;padding:0 10px;border-radius:8px;
  background:#191925;border:1px solid #262636;color:#9a9ab2;font-size:11.5px;font-weight:600;transition:.15s}
.sb-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(4,4,10,.72);backdrop-filter:blur(3px);animation:sbFade .12s ease-out}
@keyframes sbFade{from{opacity:0}to{opacity:1}}
.sb-sheet{display:flex;flex-direction:column;width:min(680px,100%);max-height:min(88vh,760px);border-radius:16px;
  background:#0c0c14;border:1px solid #26263a;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden;
  animation:sbUp .16s ease-out}
@keyframes sbUp{from{transform:translateY(8px);opacity:.6}to{transform:none;opacity:1}}
.sb-sheet-h{display:flex;align-items:flex-start;gap:12px;padding:15px 16px;border-bottom:1px solid #1e1e2b}
.sb-sheet-t{font-size:17px;font-weight:700;color:#f5f5fa;line-height:1.25}
.sb-sheet-s{margin-top:3px;font-size:11.5px;color:#8b8ba0;line-height:1.5}
.sb-x{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border-radius:8px;
  background:#191925;border:1px solid #262636;color:#b6b6c8;cursor:pointer;transition:.15s}
.sb-x:hover{color:#fff;border-color:#3a3a52}
.sb-sheet-b{flex:1;min-height:0;overflow-y:auto;padding:15px 16px}
.sb-sheet-f{display:flex;align-items:center;gap:8px;padding:11px 16px;border-top:1px solid #1e1e2b;background:#0a0a11}
.sb-navbtn{display:inline-flex;align-items:center;gap:6px;max-width:48%;height:32px;padding:0 12px;border-radius:9px;
  background:#101018;border:1px solid #1e1e2b;color:#a8a8bd;font-size:11.5px;font-weight:600;cursor:pointer;transition:.15s}
.sb-navbtn:hover{color:#fff;border-color:#3a3a52}
.sb-hist{margin-top:10px;border-radius:12px;background:#101018;border:1px solid #1e1e2b;overflow:hidden}
.sb-hist-r{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;padding:9px 13px}
.sb-hist-r+.sb-hist-r{border-top:1px solid #1a1a26}
.sb-now{padding:2px 7px;border-radius:6px;font-size:9.5px;font-weight:700;color:#a5b4fc;background:rgba(99,102,241,.14);
  border:1px solid rgba(99,102,241,.35)}
.sb-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px;border-radius:12px;
  background:#101018;border:1px dashed #232332}
.sb-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:26px;border-radius:12px;background:#101018;
  border:1px solid #1e1e2b}
.sb-prog{margin-bottom:14px;padding:13px 14px;border-radius:12px;background:#101018;border:1px solid rgba(99,102,241,.45)}
.sb-prog-h{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.sb-prog-l{flex:1;min-width:160px;font-size:12.5px;color:#e6e6f0;font-weight:650}
.sb-prog-d{font-size:11px;color:#7c7c95;font-variant-numeric:tabular-nums}
.sb-prog-p{font-size:12.5px;color:#a5b4fc;font-variant-numeric:tabular-nums}
.sb-dot{width:8px;height:8px;border-radius:999px;background:#818cf8;flex-shrink:0;animation:sbPulse 1.4s ease-in-out infinite}
@keyframes sbPulse{0%,100%{opacity:1}50%{opacity:.25}}
.sb-prog-bar{margin-top:10px;height:7px;border-radius:999px;background:#1e1e2b;overflow:hidden}
.sb-prog-bar>i{display:block;height:100%;border-radius:999px;transition:width .6s ease;
  background:linear-gradient(90deg,#4f46e5,#7c3aed,#8b5cf6)}
.sb-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px;margin-top:11px;list-style:none;padding:0}
@container sb (min-width:640px){.sb-steps{grid-template-columns:repeat(4,minmax(0,1fr))}}
.sb-step{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#e6e6f0}
.sb-step-next{color:#5f5f78}
.sb-step-now{font-weight:700}
.sb-step-n{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;border-radius:999px;
  font-size:8.5px;border:1px solid #818cf8;color:#a5b4fc}
.sb-step-next .sb-step-n{border-color:#2a2a3d;color:#5f5f78}
.sb-step-done .sb-step-n{background:#6366f1;border-color:#6366f1;color:#fff}
.sb-prog-c{margin-top:8px;font-size:10.5px;color:#6f6f85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-fail{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;margin-bottom:14px;padding:13px 14px;border-radius:12px;
  background:#101018;border:1px solid rgba(248,113,113,.5)}
.sb-fail-b{flex:1;min-width:200px}
.sb-fail-t{font-size:12.5px;color:#f87171}
.sb-fail-p{margin-top:5px;font-size:11.5px;color:#c3c3d4;line-height:1.6}
.sb-fail-c{margin-top:8px;padding:8px;border-radius:8px;background:rgba(0,0,0,.35);border:1px solid #1e1e2b;color:#8a8aa3;
  font-size:10.5px;white-space:pre-wrap;word-break:break-word;overflow-x:auto}
.sb-fail-h{margin-top:8px;font-size:11.5px;color:#e6e6f0;line-height:1.6}
.sb-fail-m{margin-top:7px;font-size:10.5px;color:#6f6f85}
.sb-spin{animation:sbSpin 1s linear infinite}
@keyframes sbSpin{to{transform:rotate(360deg)}}
`;
