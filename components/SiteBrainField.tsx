"use client";
import { useEffect, useRef, useState } from "react";
import {
  CONFIDENCE_COPY,
  describeSources,
  isFieldEmpty,
  type ContentGap,
  type FieldMeta,
  type Goals,
  type Offering,
  type Proof,
  type ProfileField,
  type SiteProfile,
  type TopicCluster,
  type Voice,
} from "@/components/SiteBrainModel";

/** One field of the Site Brain, with the three things that make it trustworthy (§25.2):
 *
 *   · the VALUE, or an honest blank — a field with no evidence says "pata nahi" and offers to
 *     be filled in. There is no placeholder prose anywhere in here, because a placeholder is
 *     what the agents would then copy into an article;
 *   · WHERE IT CAME FROM — the source URLs, as links you can open. This is the whole point of
 *     the screen: "yahan se pata chala". Sources that are not URLs ("you told us", "Google
 *     Search Console") print as plain words. Nothing is ever dressed up as a link we cannot
 *     stand behind, and a field with no recorded source says exactly that, in amber;
 *   · the CONFIDENCE — and a low-confidence field is marked, in words, as a guess to confirm.
 *
 *  Plus an inline edit, and the promise attached to it: once you edit a field the agent stops
 *  rewriting it and only suggests (`user_edited`, §25.9). The editor says so before you save,
 *  because for the derived fields — clusters and gaps — that is a real trade-off.
 *
 *  Styles are one `style jsx global` block at the bottom rather than per-sub-component tags:
 *  the list markup is shared by five renderers, and styled-jsx only scopes what a single
 *  component returns. Every class is `sb-` prefixed so nothing here can reach another page.
 */

type Props = {
  meta: FieldMeta;
  profile: SiteProfile;
  busy: boolean;
  onSave: (field: ProfileField, value: unknown) => Promise<boolean>;
};

export default function SiteBrainField({ meta, profile, busy, onSave }: Props) {
  const field = meta.field;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  const firstInput = useRef<any>(null);

  const empty = isFieldEmpty(profile, field);
  const confidence = profile.confidence?.[field] ?? null;
  const sources = describeSources(profile.sources?.[field]);
  const isUserEdited = (profile.user_edited ?? []).includes(field);

  const open = () => {
    setDraft(clone((profile as any)[field]));
    setEditing(true);
  };

  useEffect(() => {
    if (editing) firstInput.current?.focus?.();
  }, [editing]);

  const save = async () => {
    const ok = await onSave(field, draft);
    if (ok) setEditing(false);
  };

  // Escape closes the editor from anywhere inside it; Ctrl/Cmd+Enter saves.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setEditing(false);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className={`sb-f ${empty ? "is-empty" : ""}`}>
      <div className="sb-f-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sb-label-row">
            <h3 className="sb-label">{meta.label}</h3>
            {!editing && <Confidence level={confidence} userEdited={isUserEdited} empty={empty} />}
          </div>
          <p className="sb-hint">{meta.hint}</p>
        </div>
        {!editing && (
          <button className="sb-edit-btn" onClick={open} disabled={busy} aria-label={`${empty ? "Fill in" : "Edit"} ${meta.label}`}>
            {empty ? "Fill in" : "Edit"}
          </button>
        )}
      </div>

      {!editing && (
        <>
          <div className="sb-value">{empty ? <Unknown prompt={meta.prompt} onFill={open} /> : <FieldValue field={field} profile={profile} />}</div>
          {!empty && <Sources items={sources} userEdited={isUserEdited} />}
        </>
      )}

      {editing && (
        <div className="sb-edit" onKeyDown={onKeyDown}>
          <FieldEditor field={field} value={draft} onChange={setDraft} firstRef={firstInput} />
          <p className="sb-note">
            {meta.derived
              ? "This one is computed from your site and your Search Console. If you edit it, it freezes: the agent stops recalculating it and only suggests changes."
              : "Your version wins from here on. The agent will suggest changes to this field but never overwrite it."}
          </p>
          <div className="btnrow">
            <button className="btn btn-p btn-sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="btn btn-g btn-sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <span className="xs mut">Esc to cancel · Ctrl+Enter to save</span>
          </div>
        </div>
      )}

      <SiteBrainFieldStyles />
    </div>
  );
}

/** The honest blank. Never a sample sentence dressed up as an answer — the example sits inside
 *  the "we don't know" box, clearly as a prompt, not in place of a value. */
function Unknown({ prompt, onFill }: { prompt: string; onFill: () => void }) {
  return (
    <div className="sb-unk">
      <b>Pata nahi — we haven&apos;t found this.</b>
      <span>Your site doesn&apos;t say it and you haven&apos;t told us, so it stays blank rather than being guessed. {prompt}</span>
      <button className="btn btn-g btn-sm" onClick={onFill} style={{ alignSelf: "flex-start", marginTop: 4 }}>
        Tell us
      </button>
    </div>
  );
}

/** A single quiet chip next to the field name: your words / how sure we are / not found yet.
 *  Never claims confidence it doesn't have — "not recorded" says exactly that. */
function Confidence({ level, userEdited, empty }: { level: string | null; userEdited: boolean; empty?: boolean }) {
  if (empty) return <span className="sb-chip-st missing">Not found yet</span>;
  if (userEdited) return <span className="sb-chip-st you">Your words</span>;
  if (!level) return <span className="sb-chip-st">Source not recorded</span>;
  const c = CONFIDENCE_COPY[level as "high" | "medium" | "low"];
  if (!c) return null;
  const tone = c.tone === "ok" ? "ok" : c.tone === "warn" ? "warn" : "bad";
  return <span title={c.note} className={`sb-chip-st ${tone}`}>{c.label}</span>;
}

/** Where this came from. Folded away by default — it used to print every page URL under
 *  every field, which buried the answer itself under a wall of links. */
function Sources({ items, userEdited }: { items: { label: string; href: string | null }[]; userEdited: boolean }) {
  const [open, setOpen] = useState(false);
  if (!items.length) {
    return <div className="sb-srcbar"><span className="sb-srcnote">No source recorded — treat this as unverified.</span></div>;
  }
  return (
    <div className="sb-srcbar">
      <button className="sb-srctoggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {userEdited ? "You set this" : `Read from ${items.length} ${items.length === 1 ? "source" : "sources"}`}
        <span className={`sb-caret ${open ? "on" : ""}`} aria-hidden>▾</span>
      </button>
      {open && (
        <div className="sb-srclist">
          {items.map((x, i) =>
            x.href ? (
              <a key={i} href={x.href} target="_blank" rel="noopener noreferrer" className="sb-srcitem">{x.label}</a>
            ) : (
              <span key={i} className="sb-srcitem plain">{x.label}</span>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ── read views ──────────────────────────────────────────────────────────────────────────────

function FieldValue({ field, profile }: { field: ProfileField; profile: SiteProfile }) {
  switch (field) {
    case "what_they_do":
    case "audience":
    case "geo":
    case "language":
      return <p className="sb-pv brk">{(profile as any)[field]}</p>;

    case "buyer_intent":
    case "competitors":
      return (
        <div className="sb-chips">
          {((profile as any)[field] as string[]).map((t, i) => (
            <span key={i} className="sb-chip brk">
              {t}
            </span>
          ))}
        </div>
      );

    case "offerings":
      return (
        <ul className="sb-rows">
          {profile.offerings.map((o: Offering, i) => (
            <li key={i}>
              <b className="brk">{o.name}</b>
              {o.kind !== "unknown" && <span className="sb-k">{o.kind}</span>}
              {o.url ? (
                <a href={o.url} target="_blank" rel="noopener noreferrer" className="brk">
                  {pathOf(o.url)} ↗
                </a>
              ) : (
                <span className="sb-none">no page — you typed this in</span>
              )}
            </li>
          ))}
        </ul>
      );

    case "proof":
      return (
        <ul className="sb-rows">
          {profile.proof.map((p: Proof, i) => (
            <li key={i} className="col">
              <b className="brk">{p.claim}</b>
              {p.quote && <q className="sb-quote brk">{p.quote}</q>}
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="brk">
                  {pathOf(p.url)} ↗
                </a>
              ) : (
                <span className="sb-none">no page — you told us this</span>
              )}
            </li>
          ))}
        </ul>
      );

    case "topic_clusters":
      return (
        <ul className="sb-rows">
          {profile.topic_clusters.map((c: TopicCluster, i) => (
            <li key={i} className="col">
              <span>
                <b className="brk">{c.name}</b>
                <span className="sb-k" style={{ marginLeft: 8 }}>
                  {c.size} page{c.size === 1 ? "" : "s"}
                </span>
              </span>
              {c.page_urls.length > 0 && (
                <span className="sb-none brk">
                  {c.page_urls.slice(0, 3).map(pathOf).join(" · ")}
                  {c.page_urls.length > 3 ? ` · +${c.page_urls.length - 3} more` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      );

    case "content_gaps":
      return (
        <ul className="sb-rows">
          {profile.content_gaps.map((g: ContentGap, i) => (
            <li key={i} className="col">
              <b className="brk">“{g.query}”</b>
              <span className="xs mut brk">
                {Number(g.impressions ?? 0).toLocaleString()} impressions
                {g.position != null ? ` · position ${Number(g.position).toFixed(1)}` : ""}
                {g.nearest_url ? ` · closest page you have: ${pathOf(g.nearest_url)}` : " · nothing close on your site"}
              </span>
            </li>
          ))}
        </ul>
      );

    case "voice": {
      const v = profile.voice;
      if (!v) return null;
      return (
        <div>
          {v.tone && (
            <p className="sb-pv brk">
              <b>Tone:</b> {v.tone}
            </p>
          )}
          {v.do?.length > 0 && (
            <p className="sb-pv brk">
              <b style={{ color: "var(--grn)" }}>Do:</b> {v.do.join(" · ")}
            </p>
          )}
          {v.dont?.length > 0 && (
            <p className="sb-pv brk">
              <b style={{ color: "var(--red)" }}>Never:</b> {v.dont.join(" · ")}
            </p>
          )}
        </div>
      );
    }

    case "goals": {
      const g = profile.goals;
      if (!g) return null;
      const LABEL: Record<string, string> = { leads: "More enquiries and leads", traffic: "More search traffic", sales: "More sales" };
      return (
        <div>
          {g.primary && <p className="sb-pv brk">{LABEL[g.primary] ?? g.primary}</p>}
          {g.focus?.length > 0 && <p className="sb-pv brk xs mut">Grow first: {g.focus.join(" · ")}</p>}
          {g.kpis?.length > 0 && <p className="sb-pv brk xs mut">Measured by: {g.kpis.join(" · ")}</p>}
        </div>
      );
    }

    default:
      return null;
  }
}

// ── editors ─────────────────────────────────────────────────────────────────────────────────

function FieldEditor({
  field,
  value,
  onChange,
  firstRef,
}: {
  field: ProfileField;
  value: any;
  onChange: (v: any) => void;
  firstRef: React.MutableRefObject<any>;
}) {
  switch (field) {
    case "what_they_do":
    case "audience":
      return <textarea ref={firstRef} rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-label={field} />;

    case "geo":
    case "language":
      return <input ref={firstRef} value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-label={field} />;

    case "buyer_intent":
    case "competitors":
      return (
        <textarea
          ref={firstRef}
          rows={4}
          value={(Array.isArray(value) ? value : []).join("\n")}
          onChange={(e) => onChange(e.target.value.split("\n"))}
          aria-label={field}
          placeholder="One per line"
        />
      );

    case "offerings":
      return (
        <RepeatRows<Offering>
          rows={Array.isArray(value) ? value : []}
          onChange={onChange}
          blank={{ name: "", url: null, kind: "unknown" }}
          addLabel="Add an offering"
          render={(row, set, first) => (
            <>
              <input ref={first ? firstRef : undefined} value={row.name ?? ""} placeholder="What it's called" onChange={(e) => set({ ...row, name: e.target.value })} aria-label="Offering name" />
              <input value={row.url ?? ""} placeholder="https://… the page that sells it (optional)" onChange={(e) => set({ ...row, url: e.target.value })} aria-label="Offering page URL" />
              <select value={row.kind ?? "unknown"} onChange={(e) => set({ ...row, kind: e.target.value as Offering["kind"] })} aria-label="Offering kind">
                <option value="unknown">Not sure</option>
                <option value="service">Service</option>
                <option value="product">Product</option>
              </select>
            </>
          )}
        />
      );

    case "proof":
      return (
        <RepeatRows<Proof>
          rows={Array.isArray(value) ? value : []}
          onChange={onChange}
          blank={{ claim: "", quote: null, url: null }}
          addLabel="Add a provable fact"
          render={(row, set, first) => (
            <>
              <input ref={first ? firstRef : undefined} value={row.claim ?? ""} placeholder="The fact, in your words" onChange={(e) => set({ ...row, claim: e.target.value })} aria-label="Claim" />
              <input value={row.quote ?? ""} placeholder="The exact wording on your site (optional)" onChange={(e) => set({ ...row, quote: e.target.value })} aria-label="Quote from the page" />
              <input value={row.url ?? ""} placeholder="https://… the page that says it" onChange={(e) => set({ ...row, url: e.target.value })} aria-label="Proof page URL" />
            </>
          )}
        />
      );

    case "topic_clusters":
      return (
        <RepeatRows<TopicCluster>
          rows={Array.isArray(value) ? value : []}
          onChange={onChange}
          blank={{ name: "", page_urls: [], centroid: null, size: 0 }}
          addLabel="Add a cluster"
          render={(row, set, first) => (
            <>
              <input ref={first ? firstRef : undefined} value={row.name ?? ""} placeholder="Cluster name" onChange={(e) => set({ ...row, name: e.target.value })} aria-label="Cluster name" />
              <span className="sb-none">{(row.page_urls ?? []).length} page(s) grouped here — the grouping itself comes from your pages&apos; meaning and isn&apos;t edited by hand.</span>
            </>
          )}
        />
      );

    case "content_gaps":
      return (
        <RepeatRows<ContentGap>
          rows={Array.isArray(value) ? value : []}
          onChange={onChange}
          blank={{ query: "", impressions: 0, position: null, nearest_similarity: null, nearest_url: null, nearest_cluster: null }}
          addLabel="Add a search you want covered"
          render={(row, set, first) => (
            <>
              <input ref={first ? firstRef : undefined} value={row.query ?? ""} placeholder="The search" onChange={(e) => set({ ...row, query: e.target.value })} aria-label="Search query" />
              <span className="sb-none">
                {Number(row.impressions ?? 0).toLocaleString()} impressions{row.position != null ? ` · position ${Number(row.position).toFixed(1)}` : " · not measured — one you added"}
              </span>
            </>
          )}
        />
      );

    case "voice": {
      const v: Voice = value ?? { tone: null, do: [], dont: [], samples: [] };
      return (
        <div className="sb-stack">
          <div className="field">
            <label htmlFor="sb-tone">Tone</label>
            <input id="sb-tone" ref={firstRef} value={v.tone ?? ""} placeholder="e.g. formal, no hype, “we” voice" onChange={(e) => onChange({ ...v, tone: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="sb-do">Always do (one per line)</label>
            <textarea id="sb-do" rows={3} value={(v.do ?? []).join("\n")} onChange={(e) => onChange({ ...v, do: e.target.value.split("\n") })} />
          </div>
          <div className="field">
            <label htmlFor="sb-dont">Never do (one per line)</label>
            <textarea id="sb-dont" rows={3} value={(v.dont ?? []).join("\n")} onChange={(e) => onChange({ ...v, dont: e.target.value.split("\n") })} />
          </div>
        </div>
      );
    }

    case "goals": {
      const g: Goals = value ?? { primary: null, kpis: [], focus: [] };
      return (
        <div className="sb-stack">
          <fieldset className="sb-gset">
            <legend className="xs mut">What matters most?</legend>
            {(["leads", "traffic", "sales"] as const).map((k) => (
              <label key={k} className="sb-gopt">
                <input type="radio" name="sb-goal-field" checked={g.primary === k} onChange={() => onChange({ ...g, primary: k })} />
                <span>{k === "leads" ? "Enquiries / leads" : k === "traffic" ? "Search traffic" : "Sales"}</span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="sb-focus">Which offerings should grow first? (up to 3, one per line)</label>
            <textarea id="sb-focus" rows={3} value={(g.focus ?? []).join("\n")} onChange={(e) => onChange({ ...g, focus: e.target.value.split("\n").slice(0, 3) })} />
          </div>
          <div className="field">
            <label htmlFor="sb-kpi">How you&apos;ll measure it (one per line)</label>
            <textarea id="sb-kpi" ref={firstRef} rows={3} value={(g.kpis ?? []).join("\n")} onChange={(e) => onChange({ ...g, kpis: e.target.value.split("\n") })} />
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

/** A list of small records, each removable. Deliberately plain: a few inputs and a Remove, so
 *  correcting one wrong offering takes four seconds rather than a modal. */
function RepeatRows<T>({
  rows,
  onChange,
  blank,
  addLabel,
  render,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: T;
  addLabel: string;
  render: (row: T, set: (next: T) => void, isFirst: boolean) => React.ReactNode;
}) {
  const setAt = (i: number, next: T) => onChange(rows.map((r, j) => (j === i ? next : r)));
  return (
    <div className="sb-rr">
      {rows.map((row, i) => (
        <div className="sb-rr-row" key={i}>
          <div className="sb-rr-fields">{render(row, (next) => setAt(i, next), i === 0)}</div>
          <button className="btn btn-g btn-sm sb-rr-x" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove this line">
            Remove
          </button>
        </div>
      ))}
      <button className="btn btn-g btn-sm" onClick={() => onChange([...rows, clone(blank)])}>
        + {addLabel}
      </button>
      {!rows.length && <p className="sb-none" style={{ margin: "2px 0 0" }}>Nothing here yet.</p>}
    </div>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────────────────────

/** Path (or host, for a bare root) of a URL — the useful half. Falls back to the raw string
 *  rather than throwing on anything odd that reached the database. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.hostname : u.pathname;
  } catch {
    return url;
  }
}

/** Deep copy of plain JSON out of the profile — no structuredClone dependency. */
function clone<T>(v: T): T {
  if (v === null || v === undefined) return v;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

/** One stylesheet for the whole field, its five list renderers and its editors. Global because
 *  styled-jsx scopes to a single component's own output and this markup is spread across
 *  several; every selector is `sb-` prefixed so it stays inside this feature. */
export function SiteBrainFieldStyles() {
  return (
    <style jsx global>{`
      .sb-f { padding: 14px; border-radius: 12px; background: #101018; border: 1px solid #1e1e2b; }
      .sb-f + .sb-f { margin-top: 10px; }
      .sb-f.is-empty { border-style: dashed; background: #0d0d15; }
      .sb-f-head { display: flex; gap: 12px; align-items: flex-start; }
      .sb-label-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .sb-label { font-size: 13.5px; font-weight: 700; margin: 0; color: #f0f0f7; }
      .sb-hint { font-size: 11px; color: #7c7c95; margin: 3px 0 0; max-width: 62ch; }
      .sb-value { margin-top: 10px; min-width: 0; }
      .sb-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; margin-top: 11px; }
      .sb-edit-btn { height: 28px; padding: 0 12px; border-radius: 8px; background: #191925; border: 1px solid #262636;
                     color: #d6d6e4; font-size: 11.5px; font-weight: 600; cursor: pointer; flex-shrink: 0; }
      .sb-edit-btn:hover:not(:disabled) { color: #fff; border-color: #3a3a52; }
      .sb-edit-btn:disabled { opacity: .5; cursor: not-allowed; }
      .sb-chip-st { padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; letter-spacing: .03em;
                    color: #8b8ba0; background: rgba(255,255,255,.04); border: 1px solid #262636; white-space: nowrap; }
      .sb-chip-st.ok { color: #4ade80; background: rgba(34,197,94,.10); border-color: rgba(34,197,94,.3); }
      .sb-chip-st.warn { color: #fbbf24; background: rgba(251,191,36,.10); border-color: rgba(251,191,36,.3); }
      .sb-chip-st.bad { color: #f87171; background: rgba(239,68,68,.10); border-color: rgba(239,68,68,.3); }
      .sb-chip-st.you { color: #a5b4fc; background: rgba(99,102,241,.12); border-color: rgba(99,102,241,.35); }
      .sb-chip-st.missing { color: #8b8ba0; border-style: dashed; }
      .sb-srcbar { margin-top: 10px; padding-top: 9px; border-top: 1px solid #1a1a26; }
      .sb-srcnote { font-size: 11px; color: #fbbf24; }
      .sb-srctoggle { display: inline-flex; align-items: center; gap: 5px; padding: 0; background: none; border: none;
                      color: #7c7c95; font-size: 11px; font-weight: 600; cursor: pointer; }
      .sb-srctoggle:hover { color: #a5b4fc; }
      .sb-caret { display: inline-block; transition: transform .15s; }
      .sb-caret.on { transform: rotate(180deg); }
      .sb-srclist { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .sb-srcitem { max-width: 100%; padding: 3px 8px; border-radius: 6px; font-size: 10.5px; color: #9a9ab2;
                    background: #0a0a11; border: 1px solid #232332; text-decoration: none; overflow-wrap: anywhere; }
      .sb-srcitem:hover { color: #fff; border-color: #3a3a52; }
      .sb-srcitem.plain { color: #6f6f85; }
      .sb-edit { margin-top: 12px; }
      .sb-note { font-size: 11px; color: var(--mut2); margin: 10px 0 11px; max-width: 68ch; }
      .sb-pv { font-size: 13.5px; color: var(--ink); margin: 0 0 4px; line-height: 1.55; }
      .sb-none { font-size: 11px; color: var(--mut2); }

      .sb-unk { display: flex; flex-direction: column; gap: 6px; padding: 13px 14px; border-radius: 12px;
                border: 1px dashed var(--line2); background: var(--panel2); }
      .sb-unk b { font-size: 12.5px; color: var(--mut); font-weight: 700; }
      .sb-unk span { font-size: 11.5px; color: var(--mut2); white-space: pre-line; }

      .sb-src { display: inline-flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; min-width: 0; }
      .sb-src a { color: var(--ac); text-decoration: underline; text-underline-offset: 2px; }

      .sb-chips { display: flex; flex-wrap: wrap; gap: 7px; }
      .sb-chip { font-size: 12px; padding: 5px 11px; border-radius: 999px; background: var(--panel2);
                 border: 1px solid var(--line2); color: var(--ink); max-width: 100%; }

      .sb-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .sb-rows li { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; min-width: 0;
                    padding: 9px 12px; border-radius: 11px; background: var(--panel2); border: 1px solid var(--line); }
      .sb-rows li.col { flex-direction: column; align-items: flex-start; gap: 4px; }
      .sb-rows b { font-size: 13px; color: var(--ink); }
      .sb-rows a { color: var(--ac); font-size: 11px; text-decoration: underline; text-underline-offset: 2px; }
      .sb-quote { display: block; font-size: 12px; color: var(--mut); font-style: italic; }
      .sb-k { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
              color: var(--mut2); padding: 2px 7px; border-radius: 999px; background: var(--line); }

      .sb-rr { display: flex; flex-direction: column; gap: 9px; align-items: flex-start; }
      .sb-rr-row { display: flex; gap: 8px; align-items: flex-start; width: 100%; padding: 10px;
                   border: 1px solid var(--line2); border-radius: 11px; background: var(--panel2); }
      .sb-rr-fields { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
      .sb-rr-x { flex: none; }

      .sb-stack .field { margin: 0 0 10px; }
      .sb-gset { border: none; padding: 0; margin: 0 0 10px; display: flex; flex-wrap: wrap; gap: 8px; }
      .sb-gset legend { padding: 0 0 6px; }
      .sb-gopt { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; padding: 8px 13px;
                 border: 1px solid var(--line2); border-radius: 999px; background: var(--panel2); cursor: pointer; }
      .sb-gopt input { width: auto; padding: 0; }

      @media (max-width: 560px) {
        .sb-rr-row { flex-direction: column; }
        .sb-rr-x { align-self: flex-end; }
      }
    `}</style>
  );
}
