"use client";
import { AlertTriangle, Check, Clock, Loader2, Radio, X } from "lucide-react";
import { elapsedMs, clock, isTerminalStep, type StepState, type TaskState } from "@/lib/live";

/** The run, while it runs — the panel a Vercel deployment shows you.
 *
 *  Owner, 2026-09-05, after ordering an article and watching every card sit on "Waiting":
 *  "har hal main ye primary ha ki ham user ko live progress dikhaye — andar kya chal raha ha,
 *  kitne task chal rahe hain, current working, sab kuch." So this panel exists to make sure
 *  that between "the team is on it" and the article appearing in Approvals there is never a
 *  silent gap.
 *
 *  It is fed, in order of preference:
 *   1. the brain's own task (lib/live.ts TaskState) — real steps, real per-step progress and
 *      the sentences the agents themselves wrote;
 *   2. failing that, the agent whose jobs_log row says it is working right now, plus the
 *      crawl's own phase counter — the legacy path, which writes no task rows;
 *   3. failing that, the order the chat has just accepted, shown as "Queued", so the panel
 *      appears the instant a person asks for something rather than up to four seconds later.
 *
 *  It never invents a step, a percentage or a sentence. When nothing is running it renders
 *  nothing at all — a spinner with no run behind it is worse than an empty space, because the
 *  person then waits for something that is not coming.
 */

export type LiveRunCrawl = { phase: string; done: number; total: number; current: string | null; label: string | null } | null;

/** The pipeline in the order it actually runs, for the legacy (non-brain) path where there are
 *  no step rows to read. Ids are the store's own agent ids. */
const FALLBACK_PIPELINE: { id: string; label: string }[] = [
  { id: "boss", label: "Planning" },
  { id: "kw", label: "Keyword research" },
  { id: "writer", label: "Writing" },
  { id: "seo", label: "SEO check" },
  { id: "image", label: "Images" },
  { id: "publish", label: "Publishing" },
];

const STATUS_TONE: Record<string, string> = {
  running: "#818cf8", queued: "#818cf8", scheduled: "#818cf8",
  done: "#34d399", succeeded: "#34d399",
  failed: "#f87171", cancelled: "#f87171", error: "#f87171",
};

export default function LiveRunPanel({
  task, workingAgentId, workingAgentTask, crawl, pendingOrder, now, connected, onOpen,
}: {
  task: TaskState | null;
  workingAgentId: string | null;
  /** The agent's own task line from jobs_log, e.g. `Writing "how to..." - 12/40`. */
  workingAgentTask: string | null;
  crawl: LiveRunCrawl;
  /** An order the chat has accepted whose task rows have not arrived yet. */
  pendingOrder: string | null;
  now: number;
  connected: string;
  onOpen?: () => void;
}) {
  const taskRunning = !!task && (task.status === "running" || task.status === "queued" || task.status === "scheduled");
  const legacyRunning = !!workingAgentId || !!crawl;
  if (!taskRunning && !legacyRunning && !pendingOrder) return null;

  const steps: StepState[] = task?.steps ?? [];
  const currentStep = steps.find((s) => s.status === "running") ?? null;
  const doneCount = steps.filter((s) => isTerminalStep(s.status)).length;
  const total = task?.totalSteps ?? (steps.length || null);

  // The headline. `echo` is the one line the person themselves confirmed.
  const heading = task?.echo ?? pendingOrder ?? workingAgentTask ?? "Your team is working";
  const status: string = task?.status ?? (legacyRunning ? "running" : "queued");
  const tone = STATUS_TONE[status] ?? "#818cf8";
  const startedAt = task?.startedAt ?? task?.createdAt ?? null;

  // What is happening RIGHT NOW, in this order of truthfulness: the step's own progress label,
  // the crawl's real counter, the agent's own jobs_log line.
  const crawlLine = crawl
    ? crawl.total
      ? `${crawl.done} of ${crawl.total} pages read${crawl.current ? ` — ${crawl.current.replace(/^https?:\/\//, "")}` : ""}`
      : crawl.label ?? crawl.phase
    : null;
  const nowLine = currentStep?.progressLabel ?? currentStep?.label ?? crawlLine ?? workingAgentTask ?? null;

  const lines = (task?.lines ?? []).slice(-5);
  const failedStep = steps.find((s) => s.status === "failed") ?? null;
  const failure = failedStep?.reason ?? (task?.status === "failed" ? task.reason : null);

  return (
    <div className="lx-card2 mt-3 p-3.5" role="status" aria-live="polite">
      <style dangerouslySetInnerHTML={{ __html: RUN_CSS }} />

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="lr-dot" style={{ background: tone, boxShadow: `0 0 8px ${tone}` }} />
        <b className="lx-12 min-w-0 flex-1 truncate">{heading}</b>

        {total != null && <span className="lx-10 lx-mut">{doneCount} of {total} steps</span>}
        {task && startedAt && (
          <span className="lx-10 lx-mut lr-num"><Clock size={10} /> {clock(elapsedMs(task, now))}</span>
        )}
        <span className="lr-pill" style={{ color: tone, borderColor: `${tone}55`, background: `${tone}18` }}>
          {status === "running" ? <Loader2 size={10} className="lr-spin" /> : status === "failed" ? <X size={10} /> : <Radio size={10} />}
          {status === "queued" || status === "scheduled" ? "Queued" : status === "running" ? "Running" : status}
        </span>
        {onOpen && <button className="lr-open" onClick={onOpen}>Open</button>}
      </div>

      {nowLine && (
        <div className="lr-now">
          <Loader2 size={11} className="lr-spin" style={{ color: tone }} />
          <span className="truncate">{nowLine}</span>
          {currentStep?.fraction != null && (
            <span className="lx-10 lx-mut lr-num">{Math.round(currentStep.fraction * 100)}%</span>
          )}
        </div>
      )}
      {currentStep?.fraction != null && (
        <div className="lr-bar"><i style={{ width: `${Math.max(2, Math.round(currentStep.fraction * 100))}%` }} /></div>
      )}

      {/* The steps. Real ones when the brain gave us rows; otherwise the pipeline with the
          agent jobs_log says is working lit, and nothing claimed about the others. */}
      <ol className="lr-steps">
        {steps.length
          ? steps.map((s) => (
              <StepRow
                key={s.key}
                label={s.label ?? s.action ?? s.agent_id}
                state={s.status === "running" ? "now" : s.status === "failed" ? "failed" : isTerminalStep(s.status) ? "done" : "next"}
                ms={s.ms}
                note={s.status === "failed" ? s.reason : null}
              />
            ))
          : FALLBACK_PIPELINE.map((p) => (
              <StepRow key={p.id} label={p.label} state={workingAgentId === p.id ? "now" : "next"} ms={null} note={null} />
            ))}
      </ol>

      {lines.length > 0 && (
        <div className="lr-log">
          {lines.map((l, i) => (
            <div key={i} className="lr-logline">
              <span className="lr-logt">{new Date(l.at).toLocaleTimeString()}</span>
              <span className="truncate">{l.text}</span>
            </div>
          ))}
        </div>
      )}

      {failure && (
        <div className="lr-fail">
          <AlertTriangle size={12} className="mt-px shrink-0" />
          <span>{failure}</span>
        </div>
      )}

      {connected === "polling" && (
        <div className="lx-10 lx-mut mt-2">Live connection dropped — still checking every few seconds.</div>
      )}
    </div>
  );
}

function StepRow({ label, state, ms, note }: { label: string; state: "done" | "now" | "next" | "failed"; ms: number | null; note: string | null }) {
  return (
    <li className={`lr-step lr-${state}`}>
      <span className="lr-mark">
        {state === "done" ? <Check size={9} /> : state === "failed" ? <X size={9} /> : state === "now" ? <Loader2 size={9} className="lr-spin" /> : null}
      </span>
      <span className="truncate">{label}</span>
      {ms != null && state === "done" && <span className="lx-10 lx-mut lr-num">{clock(ms)}</span>}
      {note && <span className="lr-note truncate">{note}</span>}
    </li>
  );
}

const RUN_CSS = `
.lr-dot{width:8px;height:8px;border-radius:999px;flex-shrink:0;animation:lrPulse 1.4s ease-in-out infinite}
@keyframes lrPulse{0%,100%{opacity:1}50%{opacity:.3}}
.lr-spin{animation:lrSpin 1s linear infinite}
@keyframes lrSpin{to{transform:rotate(360deg)}}
.lr-num{font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;gap:3px}
.lr-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;border:1px solid;
  font-size:10px;font-weight:700;text-transform:capitalize}
.lr-open{padding:2px 9px;border-radius:999px;border:1px solid var(--lx-border);background:transparent;
  color:var(--lx-mut);font-size:10px;font-weight:600;cursor:pointer;transition:.15s}
.lr-open:hover{color:var(--lx-text);border-color:#3a3a52}
.lr-now{display:flex;align-items:center;gap:7px;margin-top:9px;font-size:11.5px;color:var(--lx-text)}
.lr-bar{margin-top:7px;height:5px;border-radius:999px;background:var(--lx-border);overflow:hidden}
.lr-bar>i{display:block;height:100%;border-radius:999px;transition:width .6s ease;
  background:linear-gradient(90deg,#4f46e5,#7c3aed,#8b5cf6)}
.lr-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px 12px;margin-top:10px;
  list-style:none;padding:0}
.lr-step{display:flex;align-items:center;gap:6px;font-size:10.5px;min-width:0;color:var(--lx-mut)}
.lr-mark{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;
  border-radius:999px;border:1px solid var(--lx-border);color:#fff}
.lr-step.lr-now{font-weight:700;color:var(--lx-text)}
.lr-step.lr-now .lr-mark{border-color:#818cf8;color:#a5b4fc}
.lr-step.lr-done{color:var(--lx-text)}
.lr-step.lr-done .lr-mark{background:#6366f1;border-color:#6366f1}
.lr-step.lr-failed{color:#f87171}
.lr-step.lr-failed .lr-mark{background:#f87171;border-color:#f87171}
.lr-note{color:#f87171;font-size:10px}
.lr-log{margin-top:10px;padding-top:9px;border-top:1px solid var(--lx-border);display:flex;flex-direction:column;gap:3px}
.lr-logline{display:flex;align-items:baseline;gap:8px;font-size:10.5px;color:var(--lx-mut);min-width:0}
.lr-logt{font-variant-numeric:tabular-nums;flex-shrink:0;opacity:.7}
.lr-fail{display:flex;align-items:flex-start;gap:7px;margin-top:9px;padding:8px 10px;border-radius:9px;
  font-size:11px;color:#fca5a5;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.35)}
`;
