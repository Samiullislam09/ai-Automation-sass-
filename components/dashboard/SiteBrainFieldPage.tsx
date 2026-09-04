"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import SiteBrainField, { SiteBrainFieldStyles } from "@/components/SiteBrainField";
import {
  FIELD_META,
  FRIENDLY_LABEL,
  isFieldEmpty,
  isProfileField,
  normalizeProfile,
  PROFILE_FIELDS,
  type ProfileField,
  type SiteProfile,
} from "@/components/SiteBrainModel";

/** /dashboard/site-brain/[field] — one fact of the Site Brain on its own page (owner,
 *  2026-09-05: "list pe click karo to full page pe aaye aur wahin add/edit kar sako").
 *
 *  Same data and the same save contract as the list: GET /api/site-brain, PATCH one field. The
 *  editor itself is the shared SiteBrainField in `bare` mode, so the value renderers, the
 *  source list and the "your edit wins from here" promise are identical in both places.
 *
 *  An empty field opens straight into the editor — that is the whole reason someone clicked it. */
export default function SiteBrainFieldPage({ field: raw }: { field: string }) {
  const { toast, report } = useStore();
  const field = isProfileField(raw) ? raw : null;
  const [profile, setProfile] = useState<SiteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/site-brain")
      .then((r) => r.json())
      .then((d) => { if (d.ok && d.profile) setProfile(normalizeProfile(d.profile)); })
      .catch(() => toast("Couldn't load your Site Brain — try refreshing.", "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const save = async (f: ProfileField, value: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch("/api/site-brain", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: f, value }),
      });
      const data = await res.json();
      if (!data.ok) { toast(data.error || "Couldn't save that change.", "error"); return false; }
      if (data.unchanged) { toast("Nothing changed."); return true; }
      setProfile(normalizeProfile(data.profile));
      report(`You corrected the Site Brain: ${f.replace(/_/g, " ")} (now v${data.version}).`);
      toast("Saved — the team will use your version from now on.");
      return true;
    } catch {
      toast("Couldn't save — network error.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const i = field ? PROFILE_FIELDS.indexOf(field) : -1;
  const prev = i > 0 ? PROFILE_FIELDS[i - 1] : null;
  const next = i >= 0 && i < PROFILE_FIELDS.length - 1 ? PROFILE_FIELDS[i + 1] : null;
  const empty = field && profile ? isFieldEmpty(profile, field) : false;

  return (
    <div className="sb-wrap">
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
      <section className="sb-panel flex min-w-0 flex-1 flex-col">
        <header className="sb-head">
          <Link href="/dashboard/site-brain" className="sb-back" title="Back to Site Brain"><ArrowLeft size={16} /></Link>
          <div className="min-w-0 flex-1">
            <h1 className="sb-h1">{field ? FRIENDLY_LABEL[field] : "Unknown field"}</h1>
            <p className="sb-sub">{field ? FIELD_META[field].hint : "This is not part of the Site Brain."}</p>
          </div>
          <div className="flex items-center gap-2">
            {prev
              ? <Link href={`/dashboard/site-brain/${prev}`} className="sb-back" title={FRIENDLY_LABEL[prev]}><ChevronLeft size={16} /></Link>
              : <span className="sb-back" style={{ opacity: .35 }}><ChevronLeft size={16} /></span>}
            {next
              ? <Link href={`/dashboard/site-brain/${next}`} className="sb-back" title={FRIENDLY_LABEL[next]}><ChevronRight size={16} /></Link>
              : <span className="sb-back" style={{ opacity: .35 }}><ChevronRight size={16} /></span>}
          </div>
        </header>

        <div className="lx-scroll flex-1 overflow-y-auto px-5 pb-6 pt-4">
          {!field ? (
            <div className="sb-empty">
              <b className="lx-12">Nothing here</b>
              <p className="lx-11 lx-mut mt-1">
                That isn&apos;t one of the twelve things the Site Brain holds.{" "}
                <Link href="/dashboard/site-brain" className="sb-link">Back to Site Brain</Link>
              </p>
            </div>
          ) : loading ? (
            <div className="sb-loading"><Loader2 size={16} className="sb-spin lx-mut" /><span className="lx-11 lx-mut">Loading…</span></div>
          ) : !profile ? (
            <div className="sb-empty">
              <b className="lx-12">Your site hasn&apos;t been read yet</b>
              <p className="lx-11 lx-mut mt-1">
                Connect your website first and the team fills this in.{" "}
                <Link href="/dashboard/connect" className="sb-link">Open Connect</Link>
              </p>
            </div>
          ) : (
            <>
              <div className="sb-fieldcard">
                <SiteBrainField
                  bare
                  autoEdit={empty}
                  meta={FIELD_META[field]}
                  profile={profile}
                  busy={busy}
                  onSave={save}
                />
              </div>

              <div className="sb-navrow">
                {prev && (
                  <Link href={`/dashboard/site-brain/${prev}`} className="sb-navbtn">
                    <ChevronLeft size={14} /> <span className="truncate">{FRIENDLY_LABEL[prev]}</span>
                  </Link>
                )}
                {next && (
                  <Link href={`/dashboard/site-brain/${next}`} className="sb-navbtn ml-auto">
                    <span className="truncate">{FRIENDLY_LABEL[next]}</span> <ChevronRight size={14} />
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <SiteBrainFieldStyles />
    </div>
  );
}

const PAGE_CSS = `
.sb-wrap{display:flex;height:100%;min-height:0;container-type:inline-size;container-name:sb}
.sb-panel{background:#0a0a11;border:1px solid var(--lx-border);border-radius:16px;min-width:0;width:100%}
.sb-head{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--lx-border)}
.sb-h1{font-size:19px;font-weight:700;letter-spacing:-.01em;color:#f5f5fa;line-height:1.2}
.sb-sub{margin-top:3px;max-width:560px;font-size:12px;color:#8b8ba0;line-height:1.5}
.sb-back{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;flex-shrink:0;border-radius:9px;
  background:#191925;border:1px solid #262636;color:#b6b6c8;text-decoration:none;transition:.15s}
.sb-back:hover{color:#fff;border-color:#3a3a52}
.sb-fieldcard{padding:16px;border-radius:12px;background:#101018;border:1px solid #1e1e2b}
.sb-navrow{display:flex;gap:8px;margin-top:16px}
.sb-navbtn{display:inline-flex;align-items:center;gap:6px;max-width:48%;height:34px;padding:0 13px;border-radius:9px;
  background:#101018;border:1px solid #1e1e2b;color:#a8a8bd;font-size:12px;font-weight:600;text-decoration:none;transition:.15s}
.sb-navbtn:hover{color:#fff;border-color:#3a3a52}
.sb-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px;border-radius:12px;
  background:#101018;border:1px dashed #232332}
.sb-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:26px;border-radius:12px;background:#101018;
  border:1px solid #1e1e2b}
.sb-link{color:#8f95ff;text-decoration:none}
.sb-link:hover{text-decoration:underline}
.sb-spin{animation:sbSpin 1s linear infinite}
@keyframes sbSpin{to{transform:rotate(360deg)}}
`;
