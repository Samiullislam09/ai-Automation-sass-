"use client";
/**
 * components/WorkspaceRenderers.tsx — one renderer per `data.kind`.
 *
 * MASTER_PLAN §24.4b: the right-hand panel does not summarise the work, it *is* the work —
 * the table filling row by row, the document assembling heading by heading, the image
 * resolving. Every component here takes the same thing (`DataItem[]` + `flowing`) and every
 * one of them obeys the same three rules from §24.5:
 *
 *   1. **Animation is evidence.** Nothing loops. Every animation here is a one-shot entrance
 *      triggered by an item actually arriving, or a transition between two values that both
 *      came from events. The only continuous thing in the file is the caret at the end of the
 *      document, and it is rendered only while `flowing` is true.
 *   2. **No invented sentences.** Nothing here writes prose about what an agent "is doing".
 *      Column headers, units and empty-state notes are chrome; the sentences live in
 *      `TaskState.lines`, which only `foldEvents` can fill and only from `message_user`.
 *   3. **No prompts, no reasoning, no raw anything.** `visibleEntries()` is a denylist that
 *      the generic renderer runs before it draws a single field, so a new agent shipping a
 *      payload with `prompt` in it cannot leak it by being unrecognised.
 *
 * An unknown kind is a normal outcome, not an error: agents ship new kinds faster than this
 * file changes, and a blank panel would be a worse lie than a plain card.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DataItem } from "@/lib/live";

/* ── payload access ────────────────────────────────────────────────────────────────────
 * Agents are separate services on their own release cycles, so a payload is read by trying
 * the names the plan and the manifests actually use, and drawing nothing when none of them
 * is there. A missing number is never filled in with a zero — see `Absent` below. */

function pick(p: any, ...names: string[]): any {
  if (!p || typeof p !== "object") return undefined;
  for (const n of names) {
    const v = p[n];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A fit/relevance score may arrive as 0..1 (cosine) or 0..100. Both mean the same thing. */
function pct(v: any): number | null {
  const n = num(v);
  if (n === null) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** The honest absence. §24.5 and §25.3: a keyword with no volume source connected has no
 *  volume — it does not have a zero, and it does not get one silently blended into a score. */
function Absent({ why }: { why: string }) {
  return (
    <span className="ws-absent" title={why}>
      not measured
    </span>
  );
}

/* ── the denylist that guards the generic renderer ─────────────────────────────────────── */

const NEVER_SHOW = /(prompt|system_?message|messages|completion|reason(ing)?|thought|chain_of|raw|trace|token|api[_-]?key|secret|authorization|credential|password|embedding|vector)/i;

/** The fields of an unknown payload that are safe and useful to draw. Scalars only: an object
 *  nested inside something we do not recognise is exactly where a prompt or a model's
 *  reasoning would be hiding. */
export function visibleEntries(payload: any, max = 8): [string, string][] {
  if (payload === null || payload === undefined) return [];
  if (typeof payload !== "object") return [["value", String(payload).slice(0, 400)]];
  if (Array.isArray(payload)) {
    return payload
      .slice(0, max)
      .map((v, i) => [String(i + 1), typeof v === "object" ? "…" : String(v).slice(0, 200)] as [string, string]);
  }
  const out: [string, string][] = [];
  for (const k of Object.keys(payload)) {
    if (out.length >= max) break;
    if (NEVER_SHOW.test(k)) continue;
    const v = (payload as any)[k];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue;
    out.push([k.replace(/_/g, " "), String(v).slice(0, 400)]);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * keyword → a table that fills row by row
 *
 * The three columns the plan insists on stay three columns (§25.3): the number or its honest
 * absence, the fit score, and the Search Console opportunity. Blending them into one "score"
 * is precisely the thing a customer cannot argue with and therefore cannot trust.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

function KeywordTable({ items }: { items: DataItem[]; flowing: boolean }) {
  return (
    <div className="ws-block">
      <div className="ws-block-h">
        <span className="ws-kicker">Keywords</span>
        <span className="ws-count">{items.length}</span>
      </div>
      <div className="scroll-x">
        <table className="ws-tbl">
          <thead>
            <tr>
              <th className="ws-th-kw">Keyword</th>
              <th>Monthly searches</th>
              <th>Fit to your site</th>
              <th>Search Console</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <KeywordRow key={it.key} item={it} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="ws-note">
        Three separate columns on purpose: a search volume, how close the keyword sits to what your site is
        already about, and what Search Console already shows for it. They are never averaged into one number.
      </p>
    </div>
  );
}

function KeywordRow({ item }: { item: DataItem }) {
  const p = item.payload ?? {};
  const kw = pick(p, "kw", "keyword", "term", "query", "text") ?? "—";
  const vol = num(pick(p, "vol", "volume", "searches", "monthly_searches", "msv"));
  const fit = pct(pick(p, "fit", "fit_score", "relevance", "similarity", "cosine"));
  const gsc = (pick(p, "gsc", "search_console") ?? p) as any;
  const impressions = num(pick(gsc, "impressions", "impr"));
  const position = num(pick(gsc, "position", "pos", "avg_position"));
  const note = pick(p, "why", "reason", "note", "cluster");
  // A documented product rule (§25.4), computed from numbers already on screen — not a claim
  // about what any agent decided.
  const quickWin = position !== null && position >= 8 && position <= 20;

  return (
    <tr className="ws-row">
      <td className="ws-th-kw brk">{String(kw)}</td>
      <td>
        {vol === null ? (
          <Absent why="No search-volume source is connected. The agent left it empty rather than estimate one." />
        ) : (
          <b className="ws-numb">{fmtInt(vol)}</b>
        )}
      </td>
      <td>
        {fit === null ? (
          <Absent why="This agent did not send a fit score for this keyword." />
        ) : (
          <span className="ws-fit">
            <span className="ws-fit-bar">
              <i style={{ width: `${Math.max(0, Math.min(100, fit))}%` }} />
            </span>
            <b className="ws-numb">{fit}</b>
          </span>
        )}
      </td>
      <td>
        {impressions === null && position === null ? (
          <span className="ws-dash">—</span>
        ) : (
          <span className="ws-gsc">
            {impressions !== null && <span>{fmtInt(impressions)} impr</span>}
            {position !== null && <span>pos {position.toFixed(1)}</span>}
            {quickWin && (
              <span className="ws-tag" title="Position 8–20 with impressions already — the cheapest win to take (plan §25.4).">
                8–20
              </span>
            )}
          </span>
        )}
      </td>
      <td className="ws-muted brk">{note ? String(note) : <span className="ws-dash">—</span>}</td>
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * section → the document assembling itself, heading by heading
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

function SectionDoc({ items, flowing }: { items: DataItem[]; flowing: boolean }) {
  const title = useMemo(() => {
    for (const it of items) {
      const t = pick(it.payload, "title", "h1");
      if (t) return String(t);
    }
    return null;
  }, [items]);

  const words = items.reduce((n, it) => n + (num(pick(it.payload, "words", "word_count")) ?? 0), 0);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Follow the writing, the way a person watching over a shoulder would — but only while it
  // is actually being written. A finished document does not steal your scroll position.
  useEffect(() => {
    if (!flowing || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [items.length, flowing]);

  return (
    <div className="ws-block">
      <div className="ws-block-h">
        <span className="ws-kicker">Article</span>
        <span className="ws-count">
          {items.length} section{items.length === 1 ? "" : "s"}
          {words > 0 ? ` · ${fmtInt(words)} words` : ""}
        </span>
      </div>
      <div className="ws-doc" ref={bodyRef}>
        {title && <h1 className="ws-doc-h1">{title}</h1>}
        {items.map((it) => {
          const p = it.payload ?? {};
          const h2 = pick(p, "h2", "heading", "title", "section");
          const text = pick(p, "text", "body", "content", "excerpt");
          const w = num(pick(p, "words", "word_count"));
          return (
            <section key={it.key} className="ws-sec">
              {h2 && <h2 className="ws-doc-h2">{String(h2)}</h2>}
              {text ? (
                <p className="ws-doc-p">{String(text)}</p>
              ) : (
                // No body in the event — say that, rather than draw grey bars that look like
                // text arriving.
                <p className="ws-doc-p ws-muted">{w !== null ? `${fmtInt(w)} words written` : "written"}</p>
              )}
              {text && w !== null && <span className="ws-words">{fmtInt(w)} words</span>}
            </section>
          );
        })}
        {/* The one continuous animation in this file, and it exists only while evidence is
            arriving. When the writer goes quiet the caret disappears with it. */}
        {flowing && <span className="ws-caret" aria-hidden="true" />}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * image → a placeholder that resolves into the image
 *
 * The shimmer is the browser's real download, not a timer: it stops on the img's own `load`.
 * `prompt` is never drawn — §24.5.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

function ImageWall({ items }: { items: DataItem[]; flowing: boolean }) {
  return (
    <div className="ws-block">
      <div className="ws-block-h">
        <span className="ws-kicker">Images</span>
        <span className="ws-count">{items.length}</span>
      </div>
      <div className="ws-imgs">
        {items.map((it) => (
          <ImageTile key={it.key} item={it} />
        ))}
      </div>
    </div>
  );
}

function ImageTile({ item }: { item: DataItem }) {
  const p = item.payload ?? {};
  const url = pick(p, "url", "src", "image_url", "href");
  const alt = pick(p, "alt", "alt_text", "caption") ?? "";
  const role = pick(p, "kind", "role", "slot");
  const [state, setState] = useState<"loading" | "ready" | "broken">(url ? "loading" : "broken");

  return (
    <figure className={"ws-img is-" + state}>
      {url && state !== "broken" ? (
        <img
          src={String(url)}
          alt={String(alt)}
          loading="lazy"
          onLoad={() => setState("ready")}
          onError={() => setState("broken")}
        />
      ) : (
        <div className="ws-img-broken">image did not load</div>
      )}
      <figcaption>
        {role ? <span className="ws-tag">{String(role)}</span> : null}
        <span className="brk">{String(alt || "")}</span>
      </figcaption>
    </figure>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * score → a gauge that moves only when a score event arrives
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

function ScoreBoard({ items, flowing }: { items: DataItem[]; flowing: boolean }) {
  // One gauge per named score, holding the latest value for that name. A second `seo` event
  // moves the existing needle rather than adding a second dial.
  const gauges = useMemo(() => {
    const map = new Map<string, { label: string; value: number; max: number }>();
    for (const it of items) {
      const p = it.payload ?? {};
      if (p && typeof p === "object" && !Array.isArray(p)) {
        const explicit = num(pick(p, "value", "score"));
        if (explicit !== null) {
          const label = String(pick(p, "label", "name", "metric") ?? "score");
          map.set(label, { label, value: explicit, max: num(pick(p, "max", "out_of")) ?? 100 });
          continue;
        }
        for (const k of Object.keys(p)) {
          if (NEVER_SHOW.test(k)) continue;
          const v = num((p as any)[k]);
          if (v === null) continue;
          map.set(k, { label: k.replace(/_/g, " "), value: v, max: 100 });
        }
      }
    }
    return Array.from(map.values());
  }, [items]);

  if (!gauges.length) return <GenericCards items={items} flowing={flowing} kind="score" />;

  return (
    <div className="ws-block">
      <div className="ws-block-h">
        <span className="ws-kicker">Scores</span>
      </div>
      <div className="ws-gauges">
        {gauges.map((g) => (
          <Gauge key={g.label} {...g} flowing={flowing} />
        ))}
      </div>
    </div>
  );
}

function Gauge({ label, value, max, flowing }: { label: string; value: number; max: number; flowing: boolean }) {
  const target = Math.max(0, Math.min(1, max ? value / max : 0));
  // Sweep from empty to the value only when the value has just arrived. On a page that loads
  // with an old score already in the recording, the needle is simply *at* it — animating there
  // would be a re-enactment dressed up as news.
  const [shown, setShown] = useState(flowing ? 0 : target);
  useEffect(() => {
    if (!flowing) {
      setShown(target);
      return;
    }
    const id = requestAnimationFrame(() => setShown(target));
    return () => cancelAnimationFrame(id);
  }, [target, flowing]);

  const R = 34;
  const C = 2 * Math.PI * R;
  const tone = target >= 0.8 ? "ok" : target >= 0.5 ? "warn" : "bad";

  return (
    <div className={"ws-gauge tone-" + tone}>
      <svg viewBox="0 0 84 84" role="img" aria-label={`${label}: ${value} of ${max}`}>
        <circle cx="42" cy="42" r={R} className="ws-gauge-track" />
        <circle
          cx="42"
          cy="42"
          r={R}
          className="ws-gauge-arc"
          style={{ strokeDasharray: C, strokeDashoffset: C * (1 - shown) }}
        />
      </svg>
      <div className="ws-gauge-v">
        <b>{Math.round(value)}</b>
        <span>/ {max}</span>
      </div>
      <div className="ws-gauge-l">{label}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * anything else → a readable card. Never a crash, never a blank.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

function GenericCards({ items, kind }: { items: DataItem[]; kind: string; flowing?: boolean }) {
  return (
    <div className="ws-block">
      <div className="ws-block-h">
        <span className="ws-kicker">{kind.replace(/_/g, " ")}</span>
        <span className="ws-count">{items.length}</span>
      </div>
      <div className="ws-cards">
        {items.map((it) => {
          const rows = visibleEntries(it.payload);
          return (
            <div key={it.key} className="ws-gcard">
              {rows.length ? (
                rows.map(([k, v]) => (
                  <div className="ws-kv" key={k}>
                    <span>{k}</span>
                    <b className="brk">{v}</b>
                  </div>
                ))
              ) : (
                <div className="ws-muted">
                  {kind} — nothing in this item that is safe to show here.
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="ws-note">
        This build has no purpose-made view for <code>{kind}</code> yet, so the fields are listed plainly.
      </p>
    </div>
  );
}

/* ── the switch ────────────────────────────────────────────────────────────────────────── */

export const KIND_LABEL: Record<string, string> = {
  keyword: "Keywords",
  section: "Article",
  image: "Images",
  score: "Scores",
  lead: "Leads",
};

/** One block of one kind. Wrapped so a malformed payload from one agent takes down its own
 *  block and not the workspace. */
export default function KindBlock({ kind, items, flowing }: { kind: string; items: DataItem[]; flowing: boolean }) {
  try {
    switch (kind) {
      case "keyword":
        return <KeywordTable items={items} flowing={flowing} />;
      case "section":
        return <SectionDoc items={items} flowing={flowing} />;
      case "image":
        return <ImageWall items={items} flowing={flowing} />;
      case "score":
        return <ScoreBoard items={items} flowing={flowing} />;
      default:
        return <GenericCards items={items} kind={kind} flowing={flowing} />;
    }
  } catch {
    return (
      <div className="ws-block">
        <div className="ws-block-h">
          <span className="ws-kicker">{kind}</span>
        </div>
        <p className="ws-note">These {items.length} item(s) could not be drawn. They are safe in the recording.</p>
      </div>
    );
  }
}
