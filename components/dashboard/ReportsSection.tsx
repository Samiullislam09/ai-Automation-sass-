"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, CalendarDays, ChevronRight, Clock, ExternalLink,
  FileText, Globe, Loader2, Megaphone, MapPin, RotateCw, ScrollText, Sparkles, X,
} from "lucide-react";
import { useStore } from "@/lib/store";

/** /dashboard/reports — rebuilt 2026-09-05 (second pass, owner: "user friendly nahi hai… date
 *  pe click kare to full popup pe detailed details ho, clean ho").
 *
 *  The page is now just a clean list of days: one row per day, written in plain language
 *  ("3 pieces written · 1 went live · 2 need a fix"). Clicking a day opens a FULL-SCREEN
 *  report for it — the numbers, what the automatic run did, everything written, and what needs
 *  a human, each linking to the thing itself. Nothing expands inline any more.
 *
 *  All of it is real workspace data:
 *   - GET /api/content (status=all) — what was produced that day: title, type, status, words,
 *     the live URL once published and the real publish error when one failed.
 *   - GET /api/schedule/history — whether the automatic run fired that day, what it planned,
 *     and any failure agent-server recorded.
 *  The current tab's in-memory log (lib/store.tsx `s.reports`, written by manual actions in
 *  this session) is shown inside that day's report, labelled as such, never mixed into counts.
 */

type Item = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  cluster?: string | null;
  meta: { wordCount?: number; publishedUrl?: string | null; publishError?: string; seo?: { score?: number } } | null;
  created_at: string;
  updated_at?: string;
};

type Run = {
  id: string;
  firedAt: string;
  status: "running" | "finished" | "partial" | "failed";
  planned: number | null;
  reason: string | null;
  bossError: string | null;
  failures: { agent: string; task: string; message: string; at: string }[];
};

const TYPE_ICON: Record<string, React.ElementType> = { article: FileText, social: Megaphone, gbp: MapPin };
const TYPE_LABEL: Record<string, string> = { article: "Article", social: "Social post", gbp: "GBP post" };

const STATUS: Record<string, { label: string; pill: string }> = {
  published: { label: "Live", pill: "green" },
  approved: { label: "Approved", pill: "blue" },
  awaiting_approval: { label: "Needs your OK", pill: "amber" },
  rejected: { label: "Rejected", pill: "red" },
  failed: { label: "Publish failed", pill: "red" },
  draft: { label: "Draft", pill: "mut" },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s, pill: "mut" };

const dayKey = (iso: string) => new Date(iso).toDateString();
const dayName = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long" });
};
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

type Day = {
  key: string; iso: string; items: Item[]; runs: Run[];
  published: number; waiting: number; problems: number; drafts: number; words: number;
};

/** One plain-English line for a day — the thing someone actually wants to read in a list. */
function summarise(d: Day): string {
  if (!d.items.length) return d.runs.length ? "The automatic run fired but nothing came out of it." : "Nothing was written.";
  const bits: string[] = [`${d.items.length} piece${d.items.length === 1 ? "" : "s"} written`];
  if (d.published) bits.push(`${d.published} went live`);
  if (d.waiting) bits.push(`${d.waiting} waiting for you`);
  if (d.problems) bits.push(`${d.problems} need${d.problems === 1 ? "s" : ""} a fix`);
  return bits.join(" · ");
}

export default function ReportsSection() {
  const { s } = useStore();
  const [items, setItems] = useState<Item[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [c, h] = await Promise.all([
        fetch("/api/content?status=all", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/schedule/history", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      if (!c.ok) { setError(c.error ?? "Could not load your content."); setItems([]); return; }
      setError("");
      setItems(c.items ?? []);
      setRuns(h?.ok ? (h.runs ?? []) : []);
    } catch (e: any) {
      setError(e?.message ?? "Network error.");
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const days: Day[] = useMemo(() => {
    const map = new Map<string, Day>();
    const blank = (key: string, iso: string): Day =>
      ({ key, iso, items: [], runs: [], published: 0, waiting: 0, problems: 0, drafts: 0, words: 0 });

    for (const it of items ?? []) {
      const key = dayKey(it.created_at);
      const day = map.get(key) ?? blank(key, it.created_at);
      day.items.push(it);
      if (it.status === "published") day.published++;
      if (it.status === "awaiting_approval") day.waiting++;
      if (it.status === "failed" || it.status === "rejected") day.problems++;
      if (it.status === "draft") day.drafts++;
      day.words += typeof it.meta?.wordCount === "number" ? it.meta.wordCount : 0;
      map.set(key, day);
    }
    for (const run of runs) {
      const key = dayKey(run.firedAt);
      const day = map.get(key) ?? blank(key, run.firedAt);
      day.runs.push(run);
      map.set(key, day);
    }
    const out = Array.from(map.values());
    out.forEach((d) => d.items.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)));
    return out.sort((a, b) => +new Date(b.iso) - +new Date(a.iso));
  }, [items, runs]);

  const week = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    const recent = (items ?? []).filter((i) => +new Date(i.created_at) >= since);
    return {
      made: recent.length,
      published: recent.filter((i) => i.status === "published").length,
      waiting: recent.filter((i) => i.status === "awaiting_approval").length,
      problems: recent.filter((i) => i.status === "failed" || i.status === "rejected").length,
      words: recent.reduce((n, i) => n + (typeof i.meta?.wordCount === "number" ? i.meta.wordCount : 0), 0),
    };
  }, [items]);

  const openDay = days.find((d) => d.key === openKey) ?? null;
  const sessionLog = (s.reports ?? [])[0] as { key: string; lines: { t: string; s: string }[] } | undefined;

  return (
    <div className="rp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <section className="rp-panel flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--lx-border)" }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="rp-h1">Reports</h1>
              <ScrollText size={18} style={{ color: "#3b82f6" }} />
            </div>
            <p className="lx-mut mt-0.5" style={{ fontSize: 12 }}>Pick a day to read the full report.</p>
          </div>
          <button className="rp-icobtn" onClick={() => void load()} title="Refresh" disabled={busy}>
            {busy ? <Loader2 size={15} className="rp-spin" /> : <RotateCw size={15} />}
          </button>
        </header>

        <div className="lx-scroll flex-1 overflow-y-auto px-4 pb-4">
          {error && <p className="lx-11 mt-3" style={{ color: "#f87171" }}>{error}</p>}

          {/* this week, in five plain numbers */}
          <div className="rp-week mt-3">
            <Week n={week.made} label="written" sub="last 7 days" color="#8b5cf6" />
            <Week n={week.published} label="went live" sub="on your site" color="#22c55e" />
            <Week n={week.waiting} label="waiting for you" sub="in Approvals" color="#f59e0b" href="/dashboard/approvals" />
            <Week n={week.problems} label="need a fix" sub="failed or rejected" color="#ef4444" />
            <Week n={week.words} label="words" sub="last 7 days" color="#3b82f6" big />
          </div>

          {items === null ? (
            <div className="rp-loading mt-3"><Loader2 size={18} className="rp-spin lx-mut" /><span className="lx-11 lx-mut ml-2">Loading…</span></div>
          ) : days.length === 0 ? (
            <div className="rp-empty mt-3">
              <CalendarDays size={20} className="lx-mut" />
              <b className="lx-12 mt-2">No report yet</b>
              <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 380 }}>
                Nothing has been written yet. Start the team from the <Link href="/dashboard" className="rp-link">dashboard</Link>, or let
                it run on its own from <Link href="/dashboard/schedule" className="rp-link">Schedule</Link> — each day&apos;s report appears here by itself.
              </p>
            </div>
          ) : (
            <>
              <div className="rp-listhead mt-4">Daily reports</div>
              <div className="mt-2 space-y-1.5">
                {days.map((d) => (
                  <button key={d.key} className="rp-row" onClick={() => setOpenKey(d.key)}>
                    <span className="rp-date">
                      <b>{new Date(d.iso).getDate()}</b>
                      <i>{new Date(d.iso).toLocaleDateString("en-GB", { month: "short" })}</i>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="rp-row-t">
                        {dayName(d.iso)}
                        <em>{fmtDate(d.iso)}</em>
                      </span>
                      <span className="rp-row-s">{summarise(d)}</span>
                    </span>
                    <span className="rp-dots">
                      {d.published > 0 && <i className="green" title={`${d.published} live`} />}
                      {d.waiting > 0 && <i className="amber" title={`${d.waiting} waiting`} />}
                      {d.problems > 0 && <i className="red" title={`${d.problems} need a fix`} />}
                    </span>
                    <ChevronRight size={16} className="lx-mut rp-go" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {openDay && (
        <DayReport
          day={openDay}
          onClose={() => setOpenKey(null)}
          sessionLines={sessionLog?.key === openDay.key ? sessionLog.lines : undefined}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- */

function Week({ n, label, sub, color, href, big }: {
  n: number; label: string; sub: string; color: string; href?: string; big?: boolean;
}) {
  const inner = (
    <>
      <span className="rp-week-n" style={{ color }}>{big ? n.toLocaleString() : n}</span>
      <span className="rp-week-l">{label}</span>
      <span className="rp-week-s">{sub}</span>
    </>
  );
  return href && n > 0
    ? <Link href={href} className="rp-week-c link">{inner}<ArrowRight size={12} className="rp-week-go" /></Link>
    : <div className="rp-week-c">{inner}</div>;
}

/** The full-screen report for one day. */
function DayReport({ day, onClose, sessionLines }: {
  day: Day; onClose: () => void; sessionLines?: { t: string; s: string }[];
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onClose]);

  const live = day.items.filter((i) => i.status === "published");
  const waiting = day.items.filter((i) => i.status === "awaiting_approval");
  const problems = day.items.filter((i) => i.status === "failed" || i.status === "rejected");
  const other = day.items.filter((i) => !["published", "awaiting_approval", "failed", "rejected"].includes(i.status));
  const run = day.runs[0];

  return (
    <div className="rp-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="rp-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="rp-sheet-h">
          <div className="min-w-0">
            <div className="rp-sheet-t">{dayName(day.iso)}</div>
            <div className="rp-sheet-s">{fmtDate(day.iso)}</div>
          </div>
          <button className="rp-close" onClick={onClose} aria-label="Close report"><X size={17} /></button>
        </header>

        <div className="lx-scroll rp-sheet-b">
          {/* the whole day in one sentence */}
          <p className="rp-lead">
            {day.items.length === 0
              ? run ? "The automatic run fired, but nothing was written on this day." : "Nothing was written on this day."
              : <>
                  Your team wrote <b>{day.items.length} piece{day.items.length === 1 ? "" : "s"}</b>
                  {day.words > 0 ? <> ({day.words.toLocaleString()} words)</> : null}.{" "}
                  {day.published > 0 && <><b>{day.published}</b> went live on your site. </>}
                  {day.waiting > 0 && <><b>{day.waiting}</b> {day.waiting === 1 ? "is" : "are"} still waiting for your approval. </>}
                  {day.problems > 0 && <><b>{day.problems}</b> couldn&apos;t go out and need a look. </>}
                  {day.published === 0 && day.waiting === 0 && day.problems === 0 && "Everything is still in draft."}
                </>}
          </p>

          <div className="rp-tiles">
            <Tile n={day.items.length} label="written" color="#8b5cf6" />
            <Tile n={day.published} label="live" color="#22c55e" />
            <Tile n={day.waiting} label="waiting" color="#f59e0b" />
            <Tile n={day.problems} label="need a fix" color="#ef4444" />
            <Tile n={day.words} label="words" color="#3b82f6" />
          </div>

          {day.runs.length > 0 && (
            <Section title="The automatic run" icon={RotateCw}>
              {day.runs.map((r) => (
                <div key={r.id} className="rp-block">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={"lx-pill " + (r.status === "finished" ? "green" : r.status === "running" ? "blue" : r.status === "partial" ? "amber" : "red")}>
                      {r.status === "finished" ? "Finished" : r.status === "running" ? "Running" : r.status === "partial" ? "Partly done" : "Failed"}
                    </span>
                    <span className="lx-11">Started at {fmtTime(r.firedAt)}</span>
                    {r.planned != null && <span className="lx-11 lx-mut">· {r.planned} topic{r.planned === 1 ? "" : "s"} planned</span>}
                  </div>
                  {r.reason && <p className="lx-11 lx-mut mt-1.5">{r.reason}</p>}
                  {r.bossError && <p className="lx-11 mt-1.5" style={{ color: "#f87171" }}>{r.bossError}</p>}
                  {r.failures.map((f, i) => (
                    <p key={i} className="lx-11 mt-1.5" style={{ color: "#f87171" }}>{f.task} — {f.message}</p>
                  ))}
                </div>
              ))}
            </Section>
          )}

          {problems.length > 0 && (
            <Section title="Needs you" icon={AlertTriangle} tone="#f87171">
              {problems.map((it) => <Row key={it.id} it={it} why />)}
            </Section>
          )}

          {waiting.length > 0 && (
            <Section
              title="Waiting for your approval" icon={Clock} tone="#fbbf24"
              action={<Link href="/dashboard/approvals" className="rp-action">Open Approvals <ArrowRight size={12} /></Link>}
            >
              {waiting.map((it) => <Row key={it.id} it={it} />)}
            </Section>
          )}

          {live.length > 0 && (
            <Section title="Published to your site" icon={Globe} tone="#4ade80">
              {live.map((it) => <Row key={it.id} it={it} />)}
            </Section>
          )}

          {other.length > 0 && (
            <Section title="Still in progress" icon={FileText}>
              {other.map((it) => <Row key={it.id} it={it} />)}
            </Section>
          )}

          {sessionLines?.length ? (
            <Section title="What you did in this tab" icon={Sparkles}>
              <div className="rp-block">
                {sessionLines.map((l, i) => (
                  <div key={i} className="rp-log-l"><span className="lx-10 lx-mut">{l.t}</span><span className="lx-11">{l.s}</span></div>
                ))}
                <p className="lx-10 lx-mut mt-2">Only this browser tab remembers these lines — they aren&apos;t part of the counts above.</p>
              </div>
            </Section>
          ) : null}

          {day.items.length === 0 && day.runs.length === 0 && (
            <p className="lx-11 lx-mut">There is nothing recorded for this day.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="rp-tile" style={{ ["--c" as any]: color }}>
      <div className="rp-tile-n">{n.toLocaleString()}</div>
      <div className="rp-tile-l">{label}</div>
    </div>
  );
}

function Section({ title, icon: Icon, tone, action, children }: {
  title: string; icon: React.ElementType; tone?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rp-sec">
      <div className="rp-sec-h">
        <Icon size={14} style={{ color: tone ?? "#a78bfa" }} />
        <span>{title}</span>
        {action}
      </div>
      <div className="mt-2 space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ it, why }: { it: Item; why?: boolean }) {
  const st = statusOf(it.status);
  const Icon = TYPE_ICON[it.type] ?? FileText;
  return (
    <div className="rp-item">
      <span className="rp-item-ico"><Icon size={14} /></span>
      <span className="min-w-0 flex-1">
        <Link href={`/dashboard/content/${it.id}`} className="rp-item-t">{it.title || "Untitled"}</Link>
        <span className="rp-item-s">
          {TYPE_LABEL[it.type] ?? it.type}
          {typeof it.meta?.wordCount === "number" ? ` · ${it.meta.wordCount.toLocaleString()} words` : ""}
          {typeof it.meta?.seo?.score === "number" ? ` · SEO ${it.meta.seo.score}/100` : ""}
          {` · ${fmtTime(it.created_at)}`}
        </span>
        {why && (
          <span className="rp-item-why">
            {it.status === "failed"
              ? it.meta?.publishError
                ? `Publishing failed: ${it.meta.publishError}`
                : "It didn't pass the quality gate, so nothing was published."
              : "You rejected this one — the team can rewrite it from your notes."}
          </span>
        )}
      </span>
      {it.meta?.publishedUrl && (
        <a href={it.meta.publishedUrl} target="_blank" rel="noreferrer" className="rp-live" title={it.meta.publishedUrl}>
          <ExternalLink size={11} /> live
        </a>
      )}
      <span className={"lx-pill " + st.pill}>{st.label}</span>
      <Link href={`/dashboard/content/${it.id}`} className="rp-open" title="Open it"><ChevronRight size={15} /></Link>
    </div>
  );
}

/* Same visual language as Approvals / Content / Schedule. Injected with
   dangerouslySetInnerHTML — React escapes ">" inside a <style> text child, which turns every
   child selector into a hydration mismatch. */
const CSS = `
.rp-wrap{display:flex;height:100%;min-height:0;container-type:inline-size;container-name:rp}
.rp-panel{background:#0a0a11;border:1px solid var(--lx-border);border-radius:16px;min-width:0;width:100%}
.rp-h1{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1;color:#fff}
.rp-icobtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;
  border:1px solid var(--lx-border);background:#0d0d16;color:#9a9ab2;cursor:pointer;transition:.15s;flex-shrink:0}
.rp-icobtn:hover:not(:disabled){color:#fff;border-color:rgba(139,92,246,.55)}
.rp-week{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px}
.rp-week-c{position:relative;display:flex;flex-direction:column;gap:1px;padding:11px 12px;border-radius:11px;
  background:#0d0d16;border:1px solid var(--lx-border);text-decoration:none;min-width:0}
.rp-week-c.link{transition:.15s}
.rp-week-c.link:hover{border-color:rgba(139,92,246,.5);background:#101019}
.rp-week-n{font-size:22px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums}
.rp-week-l{font-size:11.5px;font-weight:600;color:#e8e8f2}
.rp-week-s{font-size:10px;color:var(--lx-dim)}
.rp-week-go{position:absolute;top:10px;right:10px;color:var(--lx-dim)}
.rp-listhead{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--lx-mut)}
.rp-row{display:flex;align-items:center;gap:11px;width:100%;padding:10px 12px;border-radius:12px;text-align:left;
  background:#0d0d16;border:1px solid var(--lx-border);cursor:pointer;transition:.15s}
.rp-row:hover{border-color:rgba(139,92,246,.5);background:#101019}
.rp-row:hover .rp-go{color:#fff;transform:translateX(2px)}
.rp-date{display:flex;flex-direction:column;align-items:center;justify-content:center;width:42px;height:42px;flex-shrink:0;
  border-radius:11px;background:#0a0a11;border:1px solid var(--lx-border)}
.rp-date b{font-size:16px;font-weight:800;color:#fff;line-height:1.05}
.rp-date i{font-size:9px;font-style:normal;color:var(--lx-mut);text-transform:uppercase;letter-spacing:.04em}
.rp-row-t{display:flex;align-items:baseline;gap:8px;font-size:13px;font-weight:700;color:#fff}
.rp-row-t em{font-size:10.5px;font-weight:500;font-style:normal;color:var(--lx-dim)}
.rp-row-s{display:block;margin-top:2px;font-size:11.5px;color:var(--lx-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-dots{display:flex;gap:4px;flex-shrink:0}
.rp-dots i{width:7px;height:7px;border-radius:50%;display:inline-block}
.rp-dots i.green{background:#22c55e;box-shadow:0 0 7px rgba(34,197,94,.7)}
.rp-dots i.amber{background:#f59e0b;box-shadow:0 0 7px rgba(245,158,11,.7)}
.rp-dots i.red{background:#ef4444;box-shadow:0 0 7px rgba(239,68,68,.7)}
.rp-go{flex-shrink:0;transition:.15s}
.rp-loading{display:flex;align-items:center;justify-content:center;padding:26px;border-radius:12px;background:#0d0d16;
  border:1px solid var(--lx-border)}
.rp-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 20px;border-radius:12px;
  background:#0d0d16;border:1px dashed var(--lx-border)}
.rp-link{color:#818cf8;text-decoration:none}
.rp-link:hover{text-decoration:underline}

/* ---- full-screen day report ---- */
.rp-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(4,4,10,.72);backdrop-filter:blur(3px);animation:rpFade .12s ease-out}
@keyframes rpFade{from{opacity:0}to{opacity:1}}
.rp-sheet{display:flex;flex-direction:column;width:min(980px,100%);max-height:min(92vh,900px);border-radius:18px;
  background:#0a0a11;border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden;
  animation:rpUp .16s ease-out}
@keyframes rpUp{from{transform:translateY(8px);opacity:.6}to{transform:none;opacity:1}}
.rp-sheet-h{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--lx-border);
  background:linear-gradient(135deg,rgba(124,58,237,.12),transparent 60%)}
.rp-sheet-t{font-size:20px;font-weight:800;letter-spacing:-.02em;color:#fff;line-height:1.15}
.rp-sheet-s{font-size:12px;color:var(--lx-mut);margin-top:2px}
.rp-close{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;margin-left:auto;
  flex-shrink:0;border-radius:9px;background:#12121c;border:1px solid var(--lx-border);color:#b6b6c8;cursor:pointer;transition:.15s}
.rp-close:hover{color:#fff;border-color:rgba(255,255,255,.25)}
.rp-sheet-b{flex:1;min-height:0;overflow-y:auto;padding:16px 18px 22px}
.rp-lead{font-size:14px;line-height:1.65;color:#d6d6e4}
.rp-lead b{color:#fff}
.rp-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin-top:14px}
.rp-tile{padding:10px 12px;border-radius:11px;background:color-mix(in srgb,var(--c) 8%,#0d0d16);
  border:1px solid color-mix(in srgb,var(--c) 32%,transparent)}
.rp-tile-n{font-size:20px;font-weight:800;line-height:1.05;color:var(--c);font-variant-numeric:tabular-nums}
.rp-tile-l{margin-top:2px;font-size:10.5px;color:var(--lx-mut)}
.rp-sec{margin-top:18px}
.rp-sec-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#fff}
.rp-action{display:inline-flex;align-items:center;gap:4px;margin-left:auto;font-size:11.5px;font-weight:600;
  color:#818cf8;text-decoration:none}
.rp-action:hover{text-decoration:underline}
.rp-block{padding:11px 12px;border-radius:11px;background:#0d0d16;border:1px solid var(--lx-border)}
.rp-item{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:11px;background:#0d0d16;
  border:1px solid var(--lx-border);transition:.15s}
.rp-item:hover{border-color:rgba(139,92,246,.4)}
.rp-item-ico{display:flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border-radius:9px;
  color:#a5b4fc;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3)}
.rp-item-t{display:block;font-size:12.5px;font-weight:600;color:#fff;text-decoration:none;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-item-t:hover{text-decoration:underline}
.rp-item-s{display:block;margin-top:2px;font-size:10.5px;color:var(--lx-mut)}
.rp-item-why{display:block;margin-top:3px;font-size:11px;color:#fca5a5;line-height:1.45}
.rp-live{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;font-size:10.5px;font-weight:600;color:#4ade80;
  text-decoration:none;white-space:nowrap}
.rp-live:hover{text-decoration:underline}
.rp-open{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex-shrink:0;border-radius:7px;
  color:#8b8ba0;transition:.15s}
.rp-open:hover{color:#fff;background:rgba(255,255,255,.07)}
.rp-log-l{display:flex;gap:8px;align-items:baseline;padding:5px 0}
.rp-log-l+.rp-log-l{border-top:1px solid var(--lx-border)}
@container rp (max-width:560px){.rp-row-t em{display:none}}
.rp-spin{animation:rpSpin 1s linear infinite}
@keyframes rpSpin{to{transform:rotate(360deg)}}
`;
