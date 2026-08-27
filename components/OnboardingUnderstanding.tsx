"use client";
import { useEffect, useState } from "react";
import { normalizeProfile, type Goals, type Offering, type SiteProfile } from "@/components/SiteBrainModel";

/** The two screens MASTER_PLAN §25.7 adds to onboarding, between "paste your website" and
 *  "connect where we publish":
 *
 *    1. "We read your site — here's what we understood."  what_they_do · audience · offerings
 *       · proof, each correctable in place.
 *    2. "What are you aiming for?"  leads / traffic / sales, plus the three offerings that
 *       should grow first.
 *
 *  WHY THESE EXIST AT ALL (§25.7's own sentence): a wrong understanding is caught here, in the
 *  first minute, instead of after an article about the wrong company. Every question the wizard
 *  used to ask — business type, audience — was us guessing out loud; now we read the site and
 *  ask the owner to confirm, which is both faster and true.
 *
 *  THREE RULES THESE SCREENS KEEP
 *
 *   · ONBOARDING IS NEVER BLOCKED. The crawl and Mr. Analyst run in the background from the
 *     moment the address is typed. If they haven't finished, `status` comes back "thinking"
 *     and the parent skips the screen entirely — nobody waits on a queue to finish signing up.
 *   · THERE IS ONLY ONE WRITER. Corrections go through PATCH /api/site-brain, the same path
 *     the Site Brain page uses, so a field edited here is versioned and marked `user_edited`
 *     and the analyst will never quietly overwrite it (§25.9).
 *   · NOTHING IS INVENTED TO FILL THE SCREEN. A field the analyst has no evidence for is shown
 *     as an empty box asking for it, never as a plausible sentence we made up — the whole
 *     failure this screen exists to prevent.
 */

export type ProfileStatus = "ready" | "thinking" | "no-pages" | "off";

export type OnboardingProfile = {
  status: ProfileStatus;
  profile: SiteProfile | null;
  pagesCrawled: number;
  builtFromPages: number | null;
};

/** Reads what the analyst made of the site. Returns `null` while it is still loading, so the
 *  parent can hold the step rather than flashing an empty screen and then filling it. */
export function useOnboardingProfile(enabled: boolean): OnboardingProfile | null {
  const [state, setState] = useState<OnboardingProfile | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/onboarding/profile")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setState({
          status: (d?.status as ProfileStatus) ?? "thinking",
          profile: d?.profile ? normalizeProfile(d.profile) : null,
          pagesCrawled: Number(d?.pagesCrawled) || 0,
          builtFromPages: Number(d?.builtFromPages) || null,
        });
      })
      // A failed read is treated as "still thinking" for the same reason the API treats a
      // database error that way: it is not a reason to stop somebody signing up.
      .catch(() => alive && setState({ status: "thinking", profile: null, pagesCrawled: 0, builtFromPages: null }));
    return () => {
      alive = false;
    };
  }, [enabled]);

  return state;
}

async function patchProfile(field: string, value: unknown): Promise<boolean> {
  try {
    const res = await fetch("/api/site-brain", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
    const data = await res.json();
    return !!data?.ok;
  } catch {
    return false;
  }
}

/* ── screen 1 · "we read your site" ─────────────────────────────────────────────────────── */

export function UnderstandingStep({
  profile,
  pages,
  onBack,
  onContinue,
}: {
  profile: SiteProfile;
  pages: number;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [what, setWhat] = useState(profile.what_they_do ?? "");
  const [audience, setAudience] = useState(profile.audience ?? "");
  const [offerings, setOfferings] = useState<Offering[]>(profile.offerings ?? []);
  const [saving, setSaving] = useState(false);

  const proof = (profile.proof ?? []).filter((p) => p?.claim);

  const confirm = async () => {
    setSaving(true);
    // Only what the user actually changed is written. Sending everything back would mark every
    // field `user_edited` and stop the analyst improving the ones nobody looked at.
    const edits: [string, unknown][] = [];
    if (what.trim() !== (profile.what_they_do ?? "")) edits.push(["what_they_do", what.trim() || null]);
    if (audience.trim() !== (profile.audience ?? "")) edits.push(["audience", audience.trim() || null]);
    if (JSON.stringify(offerings) !== JSON.stringify(profile.offerings ?? [])) edits.push(["offerings", offerings]);
    for (const [field, value] of edits) await patchProfile(field, value);
    setSaving(false);
    onContinue();
  };

  return (
    <>
      <h2 style={{ fontSize: 20 }}>We read your site — here&apos;s what we understood</h2>
      <p className="sm mut" style={{ margin: "8px 0 16px" }}>
        {pages ? `From ${pages} of your own pages. ` : ""}Fix anything that&apos;s wrong — your version is the one the team will use from now on.
      </p>

      <div className="field">
        <label htmlFor="ob-what">What you do</label>
        <textarea id="ob-what" rows={3} value={what} placeholder="We didn't work this out — tell us in a line" onChange={(e) => setWhat(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="ob-aud">Who you serve</label>
        <input id="ob-aud" value={audience} placeholder="We didn't work this out — who buys from you?" onChange={(e) => setAudience(e.target.value)} />
      </div>

      <div className="field">
        <label>What you sell</label>
        {offerings.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {offerings.map((o, i) => (
              <div key={i} style={{ display: "flex", gap: 7 }}>
                <input
                  value={o.name}
                  onChange={(e) => setOfferings((prev) => prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)))}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  className="btn btn-g"
                  style={{ padding: "6px 10px", fontSize: 11.5, flexShrink: 0 }}
                  onClick={() => setOfferings((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="xs mut" style={{ margin: 0 }}>We couldn&apos;t find a product or service list on your site. You can add these later.</p>
        )}
      </div>

      {proof.length > 0 && (
        <div className="field">
          <label>What we can prove about you</label>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {proof.slice(0, 4).map((p, i) => (
              <li key={i} className="sm mut" style={{ marginBottom: 3 }}>{p.claim}</li>
            ))}
          </ul>
          <p className="xs mut" style={{ marginTop: 6 }}>Only things written on your own site — we never invent a claim.</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button className="btn btn-g" onClick={onBack} disabled={saving}>← Back</button>
        <button className="btn btn-p" style={{ flex: 1 }} onClick={confirm} disabled={saving}>
          {saving ? "Saving…" : "Yes, that's us →"}
        </button>
      </div>
    </>
  );
}

/* ── screen 2 · goals ───────────────────────────────────────────────────────────────────── */

const GOAL_OPTS: { key: NonNullable<Goals["primary"]>; label: string; sub: string }[] = [
  { key: "leads", label: "More enquiries", sub: "People contacting you" },
  { key: "traffic", label: "More search traffic", sub: "Being found on Google" },
  { key: "sales", label: "More sales", sub: "Orders and revenue" },
];

export function GoalsStep({
  profile,
  onBack,
  onContinue,
}: {
  profile: SiteProfile | null;
  onBack: () => void;
  onContinue: (goals: Goals) => void;
}) {
  const [primary, setPrimary] = useState<Goals["primary"]>(profile?.goals?.primary ?? null);
  const [focus, setFocus] = useState<string[]>(profile?.goals?.focus ?? []);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);

  const names = (profile?.offerings ?? []).map((o) => o.name).filter(Boolean);

  const toggle = (name: string) =>
    setFocus((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : prev.length >= 3 ? prev : [...prev, name]));

  const save = async () => {
    setSaving(true);
    const list = names.length ? focus : typed.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3);
    const goals: Goals = { primary, kpis: profile?.goals?.kpis ?? [], focus: list };
    await patchProfile("goals", goals);
    setSaving(false);
    onContinue(goals);
  };

  return (
    <>
      <h2 style={{ fontSize: 20 }}>What are we aiming for?</h2>
      <p className="sm mut" style={{ margin: "8px 0 16px" }}>Everything the team plans will be pointed at this. You can change it any time.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {GOAL_OPTS.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setPrimary(g.key)}
            style={{
              textAlign: "left",
              padding: "11px 14px",
              borderRadius: 12,
              cursor: "pointer",
              border: "1px solid " + (primary === g.key ? "var(--ac)" : "var(--line2)"),
              background: primary === g.key ? "linear-gradient(135deg,#173c33,#12352c)" : "var(--panel2)",
              color: "var(--ink)",
            }}
          >
            <b style={{ fontSize: 14 }}>{g.label}</b>
            <div className="xs mut">{g.sub}</div>
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: 18 }}>
        <label>{names.length ? "Which should grow first? (pick up to 3)" : "What should grow first? (up to 3, one per line)"}</label>
        {names.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {names.map((n) => {
              const on = focus.includes(n);
              return (
                <span
                  key={n}
                  onClick={() => toggle(n)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    cursor: "pointer",
                    userSelect: "none",
                    fontSize: 13,
                    border: "1px solid " + (on ? "var(--ac)" : "var(--line2)"),
                    background: on ? "linear-gradient(135deg,#173c33,#12352c)" : "var(--panel2)",
                    color: on ? "var(--ac)" : "var(--ink)",
                    opacity: !on && focus.length >= 3 ? 0.45 : 1,
                  }}
                >
                  {n}
                </span>
              );
            })}
          </div>
        ) : (
          <textarea rows={3} value={typed} placeholder={"Roof repairs\nGutter cleaning"} onChange={(e) => setTyped(e.target.value)} />
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button className="btn btn-g" onClick={onBack} disabled={saving}>← Back</button>
        <button className="btn btn-p" style={{ flex: 1 }} onClick={save} disabled={!primary || saving}>
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>
    </>
  );
}
