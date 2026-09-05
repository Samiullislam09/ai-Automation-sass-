"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { startPolling } from "@/lib/poll";
import { PIPELINE, WRITING_RULES, QUALITY_GATE } from "@/lib/pipeline";
import { AGENT_PROFILES } from "@/lib/agents-data";

/** The "TV": click a room in the office and the whole scene hands over to one agent.
 *
 *  The screen on the left is a picture of what that agent's job actually is — Mr. Keyword gets
 *  a search window, Mr. Writer a document, Mr Lxwa a planning board — and it is filled with the
 *  REAL row from jobs_log: the topic he was given, the keywords he came back with (and their
 *  real volumes), the article he wrote and whether it passed the gate, or the exact error.
 *  While a job is running the screen animates; it never animates a step we cannot see.
 *
 *  Everything comes from /api/dashboard/agent/[id], re-polled every 3s. */

type Job = { id: string; task: string; status: string; at: string; summary: string; items: string[] };
type Content = { id: string; title: string; status: string; words: number | null; at: string };
type Detail = {
  ok: boolean;
  agent: { id: string; name: string; role: string; ico: string; color: string; live: boolean };
  jobAgent: string | null;
  state: { state: string; task: string };
  jobs: Job[];
  content: Content[];
  counts: { total: number; success: number; error: number; running: number };
  usage?: { used: number; cap: number | null; plan?: string; known?: boolean } | null;
};

const STATE_LABEL: Record<string, string> = {
  working: "Working now", waiting: "Waiting on you", error: "Last job failed", off: "Asleep",
};
const STATE_COLOR: Record<string, string> = {
  working: "var(--grn)", waiting: "var(--amb)", error: "var(--red)", off: "var(--mut2)",
};
const time = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
};

export default function AgentStage({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/dashboard/agent/${id}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Failed (status ${res.status})`);
      setD(body); setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? "Could not load this agent.");
    } finally { inFlight.current = false; }
  }, [id]);

  useEffect(() => { setD(null); load(); return startPolling(load, 3000); }, [load]);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const stage = PIPELINE.find((p) => p.id === id);
  const profile = AGENT_PROFILES[id];
  const state = d?.state?.state ?? "off";
  const working = state === "working";
  const latest = d?.jobs?.[0] ?? null;

  return (
    <div className="stage" onClick={(e) => e.stopPropagation()}>
      <header className="st-head">
        <span className="st-ico" style={{ background: `color-mix(in srgb, ${d?.agent.color ?? "var(--ac)"} 20%, transparent)` }}>
          {d?.agent.ico ?? "🤖"}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="st-name">{d?.agent.name ?? "…"}</div>
          {/* The job title, not the queue name. "Keyword Research" describes a queue; "Search
              Analyst" describes who is answerable for it, which is what a team roster is for. */}
          <div className="st-role">{profile?.title ?? d?.agent.role ?? ""}</div>
        </div>
        <span className="st-chip" style={{ color: STATE_COLOR[state], borderColor: STATE_COLOR[state] }}>
          <i style={{ background: STATE_COLOR[state] }} className={working ? "beat" : ""} />
          {STATE_LABEL[state] ?? "Asleep"}
        </span>
        <div style={{ flex: 1 }} />
        <button className="st-x" onClick={onClose}>✕ Back to the office</button>
      </header>

      <div className="st-body">
        <section className="st-screen-wrap">
          <div className={"st-screen" + (working ? " is-live" : "")}>
            <div className="st-screen-bar">
              <i /><i /><i />
              <span>{d?.agent.name ?? ""} · {working ? "live" : latest ? `last run ${time(latest.at)}` : "idle"}</span>
            </div>
            <div className="st-screen-in">
              <Screen id={id} working={working} task={d?.state?.task ?? ""} latest={latest} live={d?.agent.live ?? false} />
            </div>
          </div>

          {(profile || stage) && (
            <div className="st-note">
              {profile && <><b>{profile.title}.</b> {profile.brief}<br /></>}
              {stage && <>{stage.what}<div className="st-from">Works from: {stage.from}</div></>}
            </div>
          )}
        </section>

        <aside className="st-side">
          {err && <div className="st-err">{err}</div>}

          <h4>What it actually did{d?.counts?.total ? <span>{d.counts.success} ok · {d.counts.error} failed</span> : null}</h4>

          {/* The daily cap used to be invisible until you hit it, at which point jobs simply
              stopped happening with no explanation anywhere. Show it before that. */}
          {d?.usage && (
            <div className={"st-cap" + (d.usage.cap != null && d.usage.used >= d.usage.cap ? " is-full" : "")}>
              {d.usage.cap != null
                ? d.usage.used >= d.usage.cap
                  ? `Daily limit reached — ${d.usage.used} of ${d.usage.cap} runs used today. Nothing new will start until tomorrow.`
                  : `Today: ${d.usage.used} of ${d.usage.cap} runs used`
                : d.usage.known
                  // The top plan (or a custom contract): no rationing at all. Say it, so
                  // nobody wonders whether they're about to hit something.
                  ? `Today: ${d.usage.used} run(s) · no daily limit on your plan`
                  : `Today: ${d.usage.used} run(s)`}
            </div>
          )}

          {!d && !err && <p className="st-p">Loading…</p>}
          {d && !d.jobAgent && <p className="st-p">No queue of its own yet — this one is a stage inside the writing job, so its work shows below as content.</p>}
          {d && d.jobAgent && !d.jobs.length && <p className="st-p">Nothing yet. Press “Run the team” and its jobs will appear here.</p>}

          <ul className="st-jobs">
            {(d?.jobs ?? []).map((j) => (
              <li key={j.id} className={"st-job is-" + j.status}>
                <div className="st-job-top">
                  <span className="st-badge">{j.status}</span>
                  <span className="st-job-task">{j.task}</span>
                  <span className="st-time">{time(j.at)}</span>
                </div>
                <div className="st-sum">{j.summary}</div>
                {j.items.length > 0 && (
                  <ul className="st-items">{j.items.slice(0, 5).map((it, i) => <li key={i}>{it}</li>)}</ul>
                )}
              </li>
            ))}
          </ul>

          {!!d?.content?.length && (
            <>
              <h4>What came out of it</h4>
              <ul className="st-content">
                {d.content.map((c) => (
                  <li key={c.id}>
                    <span className={"st-cstatus is-" + c.status}>{c.status.replace(/_/g, " ")}</span>
                    <span className="st-ctitle">{c.title}</span>
                    {c.words ? <span className="st-time">{c.words}w</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}

          {id === "writer" && (<><h4>The rules it writes to</h4><ul className="st-rules">{WRITING_RULES.map((r, i) => <li key={i}>{r}</li>)}</ul></>)}
          {id === "qa" && (<><h4>What the gate measures</h4><ul className="st-rules">{QUALITY_GATE.map((r, i) => <li key={i}>{r}</li>)}</ul></>)}
        </aside>
      </div>

      <style jsx>{`
        .stage { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column;
                 background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: blur(10px);
                 animation: st-in .34s cubic-bezier(.2,.7,.3,1); }
        @keyframes st-in { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }

        .st-head { display: flex; align-items: center; gap: 11px; padding: 12px 16px;
                   border-bottom: 1px solid var(--line); flex: none; }
        .st-ico { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-size: 18px; flex: none; }
        .st-name { font-size: 14.5px; font-weight: 800; color: var(--ink); }
        .st-role { font-size: 11px; color: var(--mut); }
        .st-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid; border-radius: 999px;
                   padding: 4px 10px; font-size: 10.5px; font-weight: 700; margin-left: 6px; }
        .st-chip i { width: 6px; height: 6px; border-radius: 50%; display: block; }
        .st-chip i.beat { animation: st-beat 1.3s infinite; }
        @keyframes st-beat { 50% { opacity: .3; } }
        .st-x { background: var(--panel); border: 1px solid var(--line2); color: var(--mut); font-size: 11.5px;
                font-weight: 700; padding: 7px 12px; border-radius: 9px; cursor: pointer; flex: none; }
        .st-x:hover { color: var(--ink); border-color: var(--ac); }

        .st-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr minmax(280px, 360px); }
        .st-screen-wrap { padding: 16px; min-width: 0; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }
        .st-screen { flex: 1; min-height: 0; border: 1px solid var(--line2); border-radius: 14px; overflow: hidden;
                     background: var(--panel); display: flex; flex-direction: column; }
        .st-screen.is-live { box-shadow: 0 0 0 1px color-mix(in srgb, var(--grn) 40%, transparent), 0 18px 50px #00000055; }
        .st-screen-bar { display: flex; align-items: center; gap: 6px; padding: 9px 12px; flex: none;
                         border-bottom: 1px solid var(--line); background: var(--panel2); }
        .st-screen-bar i { width: 8px; height: 8px; border-radius: 50%; background: var(--line2); display: block; }
        .st-screen-bar span { margin-left: 8px; font-size: 10.5px; color: var(--mut2); font-weight: 600; }
        .st-screen-in { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px; }

        .st-note { flex: none; font-size: 11.5px; color: var(--mut); line-height: 1.55; }
        .st-note b { color: var(--ink); }
        .st-from { font-size: 11px; color: var(--mut2); margin-top: 3px; }

        .st-side { border-left: 1px solid var(--line); padding: 14px 15px 20px; overflow-y: auto; background: var(--bg2); }
        .st-side h4 { font-size: 10.5px; letter-spacing: .7px; text-transform: uppercase; color: var(--mut2);
                      font-weight: 800; margin: 16px 0 8px; display: flex; gap: 8px; align-items: center; }
        .st-side h4:first-child { margin-top: 0; }
        .st-side h4 span { font-weight: 600; letter-spacing: 0; text-transform: none; font-size: 10.5px; color: var(--mut); }
        .st-p { font-size: 12px; color: var(--mut); line-height: 1.55; }
        .st-err { font-size: 12px; color: var(--amb); margin-bottom: 10px; }

        .st-jobs, .st-content, .st-rules, .st-items { list-style: none; }
        .st-jobs { display: flex; flex-direction: column; gap: 8px; }
        .st-job { border: 1px solid var(--line); border-left: 3px solid var(--mut2); border-radius: 10px;
                  padding: 9px 11px; background: var(--panel); }
        .st-job.is-success { border-left-color: var(--grn); }
        .st-job.is-error { border-left-color: var(--red); }
        .st-job.is-skipped { border-left-color: var(--amb); }
        .st-cap { font-size: 11px; color: var(--mut2); background: var(--panel2); border-radius: 8px;
                  padding: 6px 9px; margin-bottom: 9px; line-height: 1.45; }
        .st-cap.is-full { color: var(--amb); }
        .st-job.is-running, .st-job.is-queued { border-left-color: var(--blu); }
        .st-job-top { display: flex; align-items: center; gap: 8px; }
        .st-badge { font-size: 9px; font-weight: 800; text-transform: uppercase; color: var(--mut); }
        .st-job-task { font-size: 12px; font-weight: 700; color: var(--ink); flex: 1; min-width: 0;
                       overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .st-time { font-size: 10px; color: var(--mut2); flex: none; }
        .st-sum { font-size: 11.5px; color: var(--mut); line-height: 1.5; margin-top: 5px; }
        .st-items { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
        .st-items li { font-size: 10.5px; color: var(--mut2); padding-left: 9px; border-left: 1px solid var(--line2); }

        .st-content { display: flex; flex-direction: column; gap: 7px; }
        .st-content li { display: flex; align-items: center; gap: 8px; font-size: 11.5px; }
        .st-ctitle { color: var(--ink); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .st-cstatus { font-size: 9px; font-weight: 800; text-transform: uppercase; border-radius: 6px;
                      padding: 3px 6px; background: var(--line); color: var(--mut); flex: none; }
        .st-cstatus.is-awaiting_approval { background: color-mix(in srgb, var(--amb) 18%, transparent); color: var(--amb); }
        .st-cstatus.is-published { background: color-mix(in srgb, var(--grn) 18%, transparent); color: var(--grn); }
        .st-cstatus.is-failed { background: color-mix(in srgb, var(--red) 18%, transparent); color: var(--red); }

        .st-rules { display: flex; flex-direction: column; gap: 6px; }
        .st-rules li { font-size: 11.5px; color: var(--mut); line-height: 1.5; padding-left: 14px; position: relative; }
        .st-rules li::before { content: "✓"; position: absolute; left: 0; color: var(--ac); font-weight: 800; }

        @media (max-width: 1100px) {
          .st-body { grid-template-columns: 1fr; grid-template-rows: minmax(220px, 1fr) auto; overflow-y: auto; }
          .st-side { border-left: none; border-top: 1px solid var(--line); }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------ the screen itself ------------------------------ */

function Screen({ id, working, task, latest, live }: {
  id: string; working: boolean; task: string; latest: Job | null; live: boolean;
}) {
  if (!live) {
    return (
      <div className="scr-off">
        <div className="scr-off-ico">🌙</div>
        <b>Not built yet</b>
        <p>This desk is part of the roadmap. Its room stays dark rather than pretending to work.</p>
        <style jsx>{`
          .scr-off { height: 100%; display: grid; place-content: center; justify-items: center; gap: 6px; text-align: center; }
          .scr-off-ico { font-size: 30px; }
          b { font-size: 13px; color: var(--ink); }
          p { font-size: 11.5px; color: var(--mut); max-width: 280px; line-height: 1.55; }
        `}</style>
      </div>
    );
  }

  const failed = latest?.status === "error";
  const topic = extractTopic(working ? task : latest?.task ?? "");

  return (
    <div className="scr">
      {id === "kw" && <KeywordScreen working={working} topic={topic} latest={latest} />}
      {id === "writer" && <WriterScreen working={working} topic={topic} latest={latest} />}
      {id === "boss" && <BossScreen working={working} latest={latest} />}
      {!["kw", "writer", "boss"].includes(id) && (
        <div className="scr-generic">
          <b>{working ? task : latest?.summary ?? "Nothing has run yet."}</b>
        </div>
      )}

      {failed && !working && (
        <div className="scr-fail">
          <b>⚠ Last run failed</b>
          <span>{latest?.summary}</span>
        </div>
      )}

      <style jsx>{`
        .scr { display: flex; flex-direction: column; gap: 14px; min-height: 100%; }
        .scr-generic b { font-size: 13px; color: var(--ink); font-weight: 700; line-height: 1.6; }
        .scr-fail { border: 1px solid var(--red); border-radius: 10px; padding: 10px 12px;
                    background: color-mix(in srgb, var(--red) 10%, transparent); }
        .scr-fail b { display: block; font-size: 11.5px; color: var(--red); margin-bottom: 4px; }
        .scr-fail span { font-size: 11px; color: var(--mut); line-height: 1.5; }
      `}</style>
    </div>
  );
}

/** Task labels are written as: Researching "topic" / Writing "topic" (agent-server enqueuers). */
function extractTopic(task: string): string {
  const m = task.match(/[“"](.+?)[”"]/);
  return m ? m[1] : task.replace(/^(Researching|Writing)\s+/i, "");
}

function KeywordScreen({ working, topic, latest }: { working: boolean; topic: string; latest: Job | null }) {
  const keywords = latest?.items ?? [];
  return (
    <div className="kw">
      <div className="kw-search">
        <span className="kw-g">🔍</span>
        <span className="kw-q">{topic || "—"}</span>
        {working && <span className="kw-caret" />}
      </div>
      {working && <div className="kw-scan"><i /></div>}
      <div className="kw-label">{working ? "Pulling real search volume + related queries…" : keywords.length ? "Queries it came back with" : "No keyword data from the last run."}</div>
      <ul className="kw-list">
        {keywords.map((k, i) => {
          const m = k.match(/^(.*?)\s+—\s+(\d+)\/mo$/);
          const word = m ? m[1] : k;
          const vol = m ? Number(m[2]) : null;
          const max = keywords.reduce((a, x) => Math.max(a, Number(x.match(/(\d+)\/mo$/)?.[1] ?? 0)), 1);
          return (
            <li key={i} style={{ animationDelay: `${i * 0.05}s` }}>
              <span className="kw-word">{word}</span>
              {vol != null && (
                <>
                  <span className="kw-bar"><i style={{ width: `${Math.max(6, (vol / max) * 100)}%` }} /></span>
                  <span className="kw-vol">{vol}/mo</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {!working && latest?.summary && <div className="kw-sum">{latest.summary}</div>}

      <style jsx>{`
        .kw { display: flex; flex-direction: column; gap: 10px; }
        .kw-search { display: flex; align-items: center; gap: 9px; border: 1px solid var(--line2);
                     border-radius: 999px; padding: 9px 14px; background: var(--panel2); }
        .kw-q { font-size: 13px; color: var(--ink); font-weight: 600; }
        .kw-caret { width: 2px; height: 14px; background: var(--ac); animation: kwb 1s steps(1) infinite; }
        @keyframes kwb { 50% { opacity: 0; } }
        .kw-scan { height: 3px; border-radius: 2px; background: var(--line); overflow: hidden; }
        .kw-scan i { display: block; height: 100%; width: 40%; border-radius: 2px;
                     background: linear-gradient(90deg, transparent, var(--ac), transparent);
                     animation: kws 1.3s ease-in-out infinite; }
        @keyframes kws { from { transform: translateX(-100%); } to { transform: translateX(320%); } }
        .kw-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .6px; color: var(--mut2); font-weight: 800; }
        .kw-list { list-style: none; display: flex; flex-direction: column; gap: 7px; }
        .kw-list li { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--ink);
                      opacity: 0; animation: kwin .4s ease forwards; }
        @keyframes kwin { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
        .kw-word { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .kw-bar { width: 96px; height: 6px; border-radius: 3px; background: var(--line); flex: none; overflow: hidden; }
        .kw-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--ac), var(--vio)); border-radius: 3px; }
        .kw-vol { font-size: 10.5px; color: var(--mut); width: 62px; text-align: right; flex: none; }
        .kw-sum { font-size: 11.5px; color: var(--mut); line-height: 1.55; margin-top: 2px; }
      `}</style>
    </div>
  );
}

function WriterScreen({ working, topic, latest }: { working: boolean; topic: string; latest: Job | null }) {
  return (
    <div className="wr">
      <div className="wr-doc">
        <div className="wr-title">{topic || "Untitled"}</div>
        <div className="wr-lines">
          {[92, 78, 86, 64, 88, 71].map((w, i) => (
            <span key={i} style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} className={working ? "is-typing" : ""} />
          ))}
        </div>
        {working && <span className="wr-caret" />}
      </div>
      <div className="wr-state">
        {working
          ? "Drafting to the blueprint — one section per researched query, in your tone."
          : latest?.summary ?? "Nothing written yet."}
      </div>

      <style jsx>{`
        .wr { display: flex; flex-direction: column; gap: 12px; }
        .wr-doc { border: 1px solid var(--line); border-radius: 10px; background: var(--panel2); padding: 16px 18px; position: relative; }
        .wr-title { font-size: 15px; font-weight: 800; color: var(--ink); margin-bottom: 12px; line-height: 1.35; }
        .wr-lines { display: flex; flex-direction: column; gap: 8px; }
        .wr-lines span { height: 7px; border-radius: 4px; background: var(--line2); display: block; }
        .wr-lines span.is-typing { animation: wrp 1.6s ease-in-out infinite; }
        @keyframes wrp { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
        .wr-caret { position: absolute; right: 18px; bottom: 16px; width: 2px; height: 13px;
                    background: var(--ac); animation: wrb 1s steps(1) infinite; }
        @keyframes wrb { 50% { opacity: 0; } }
        .wr-state { font-size: 11.5px; color: var(--mut); line-height: 1.55; }
      `}</style>
    </div>
  );
}

function BossScreen({ working, latest }: { working: boolean; latest: Job | null }) {
  const topics = latest?.items ?? [];
  return (
    <div className="bs">
      <div className="bs-label">{working ? "Reading your niche, your crawled pages and everything already written…" : topics.length ? "Topics it chose, and why" : latest?.summary ?? "No plan yet."}</div>
      <div className="bs-cards">
        {topics.map((t, i) => {
          const [head, ...rest] = t.split(" — ");
          return (
            <div className="bs-card" key={i} style={{ animationDelay: `${i * 0.08}s` }}>
              <b>{head}</b>
              {rest.length ? <span>{rest.join(" — ")}</span> : null}
            </div>
          );
        })}
        {working && !topics.length && [0, 1, 2].map((i) => (
          <div className="bs-card is-ghost" key={i} style={{ animationDelay: `${i * 0.15}s` }}><b /><span /></div>
        ))}
      </div>

      <style jsx>{`
        .bs { display: flex; flex-direction: column; gap: 12px; }
        .bs-label { font-size: 11.5px; color: var(--mut); line-height: 1.55; }
        .bs-cards { display: flex; flex-direction: column; gap: 9px; }
        .bs-card { border: 1px solid var(--line2); border-left: 3px solid var(--ac); border-radius: 10px;
                   padding: 10px 12px; background: var(--panel2); opacity: 0; animation: bsin .45s ease forwards; }
        @keyframes bsin { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .bs-card b { display: block; font-size: 12.5px; color: var(--ink); font-weight: 700; line-height: 1.4; }
        .bs-card span { display: block; font-size: 11px; color: var(--mut); margin-top: 4px; line-height: 1.5; }
        .bs-card.is-ghost b, .bs-card.is-ghost span { background: var(--line2); border-radius: 4px; height: 9px; width: 70%; }
        .bs-card.is-ghost span { width: 45%; height: 7px; margin-top: 8px; }
        .bs-card.is-ghost { animation: bsin .45s ease forwards, wrp 1.6s ease-in-out infinite; }
        @keyframes wrp { 0%,100% { opacity: .4; } 50% { opacity: .85; } }
      `}</style>
    </div>
  );
}
