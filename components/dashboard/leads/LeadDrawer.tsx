"use client";
import { useEffect, useState } from "react";
import { CalendarClock, Globe, Mail, MessageCircle, Phone, TriangleAlert, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { C, STAGE, SOURCE_LABEL, REJECT_REASONS, ago, RejectMenu, type Lead } from "./shared";

/** The lead detail drawer. One surface; its sections are separated by 1px lines and spacing, not
 *  boxed into cards. Plain text, one icon set, nothing animates. */

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-5 py-5 last:border-b-0" style={{ borderColor: C.line }}>
      {title && <h3 className="mb-3 text-[13px] font-semibold">{title}</h3>}
      {children}
    </section>
  );
}

/** label on the left, value on the right; rows 10px apart */
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt style={{ color: C.sub }}>{k}</dt>
          <dd className="min-w-0 truncate" style={{ color: v ? C.ink : C.sub }}>{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function MeetingBlock({ meeting, onClose }: { meeting: NonNullable<Lead["meeting"]>; onClose: () => void }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const when = meeting.start_at ? new Date(meeting.start_at).toLocaleString([], { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/whatsapp/meeting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", meetingId: meeting.id }) }).then((x) => x.json());
      if (r.ok) { toast("Meeting cancelled."); onClose(); } else toast(r.error ?? "Could not cancel.", "error");
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); } finally { setBusy(false); }
  };
  return (
    <div className="text-[13px]">
      <div className="flex items-center gap-2 font-medium"><CalendarClock size={16} style={{ color: C.sub }} />{meeting.status === "scheduled" ? "Meeting booked" : "Slots offered, waiting for a reply"}</div>
      {when && <div className="mt-1 pl-6" style={{ color: C.sub }}>{when}</div>}
      {meeting.meet_link && <a href={meeting.meet_link} target="_blank" rel="noreferrer" className="mt-1 block truncate pl-6 font-medium hover:underline" style={{ color: C.brand }}>Join Google Meet</a>}
      {meeting.status === "scheduled" && (
        <button onClick={cancel} disabled={busy} className="ml-6 mt-3 h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-[#f9fafb] disabled:opacity-40" style={{ color: C.red, borderColor: C.line, background: C.panel }}>{busy ? "Cancelling…" : "Cancel meeting"}</button>
      )}
    </div>
  );
}

export default function LeadDrawer({ lead, onClose, setStage, busy, waLink, loadingDetail, showWa = true }: { lead: Lead; loadingDetail?: boolean; showWa?: boolean; onClose: () => void; setStage: (l: Lead, s: string, reason?: string) => void; busy: string | null; waLink: (l: Lead) => string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const timeline = [
    lead.created_at && { label: "Lead created", at: lead.created_at },
    lead.approved_at && { label: "Approved", at: lead.approved_at },
    lead.contacted_at && { label: "First message sent", at: lead.contacted_at },
    lead.last_in_at && { label: "They replied", at: lead.last_in_at },
  ].filter(Boolean) as { label: string; at: string }[];

  // The pipeline stage is only worth a word when it says something; "Approved" says nothing.
  const stageWord = ["approved", "pending_approval", "new"].includes(lead.stage) ? null : STAGE[lead.stage]?.label ?? lead.stage;
  const where = [lead.country || lead.city, SOURCE_LABEL[lead.source ?? ""] ?? lead.source].filter(Boolean).join(" · ");
  const site = lead.website ? (lead.website.startsWith("http") ? lead.website : `https://${lead.website}`) : null;
  const hasWhy = !!(lead.reason || lead.observation || lead.source_segment || lead.score_breakdown || lead.classification || lead.source_query || lead.evidence?.quote);
  const signal = lead.score_breakdown?.components?.find((c) => c.id === "buying-signals");
  const groups = lead.score_breakdown?.components
    ? Object.entries(lead.score_breakdown.components.reduce((acc: Record<string, { p: number; m: number }>, c) => {
        const g = acc[c.group] ?? { p: 0, m: 0 };
        acc[c.group] = { p: g.p + c.points, m: g.m + c.max };
        return acc;
      }, {}))
    : [];

  return (
    <div className="fixed inset-0 z-[90] flex justify-end" style={{ background: "rgba(17,24,39,.35)" }} onClick={onClose}>
      <div className="flex h-full w-full flex-col sm:max-w-md" style={{ background: C.panel, borderLeft: `1px solid ${C.line}` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Lead details">
        <div className="flex items-start justify-between gap-3 border-b px-5 pb-4 pt-5" style={{ borderColor: C.line }}>
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold">{lead.company || lead.name || "Lead"}</h2>
            {where && <p className="mt-1 text-[13px]" style={{ color: C.sub }}>{where}</p>}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors duration-150 ease-out hover:bg-[#f3f4f6]" style={{ color: C.sub }} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="lx-lscroll min-h-0 flex-1 overflow-y-auto">
          <Section>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <span><span style={{ color: C.sub }}>Score</span> <span className="font-semibold tabular-nums">{lead.icp_score ?? "—"}</span><span style={{ color: C.sub }}> / 100</span></span>
              {stageWord && <span style={{ color: C.sub }}>{stageWord}</span>}
              {lead.needs_attention && <span className="inline-flex items-center gap-1 font-medium" style={{ color: C.amber }}><TriangleAlert size={13} />Needs you</span>}
            </div>
            {lead.needs_attention && lead.needs_attention_reason && (
              <p className="mt-2 text-[13px]" style={{ color: C.amber }}>MenCra replied but flagged this for you: {lead.needs_attention_reason}</p>
            )}
          </Section>

          {lead.meeting && <Section><MeetingBlock meeting={lead.meeting} onClose={onClose} /></Section>}

          <Section title="Contact">
            <div className="space-y-2.5 text-[13px]">
              {(lead.whatsapp || lead.phone) ? <div className="flex items-center gap-3"><Phone size={16} className="shrink-0" style={{ color: C.sub }} />{lead.whatsapp || lead.phone}</div> : null}
              {lead.email ? <a href={`mailto:${lead.email}`} className="flex items-center gap-3 hover:underline"><Mail size={16} className="shrink-0" style={{ color: C.sub }} /><span className="truncate">{lead.email}</span></a> : null}
              {site ? <a href={site} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:underline" style={{ color: C.brand }}><Globe size={16} className="shrink-0" style={{ color: C.sub }} /><span className="truncate">{lead.website}</span></a> : null}
              {!(lead.whatsapp || lead.phone || lead.email || site) && <span style={{ color: C.sub }}>No contact details yet.</span>}
            </div>
          </Section>

          <Section title="Details">
            <Facts rows={[
              ["Company", lead.company], ["Contact", lead.name], ["Country", lead.country ?? null], ["City", lead.city ?? null],
              ["Source", SOURCE_LABEL[lead.source ?? ""] ?? lead.source ?? null], ["Added", new Date(lead.created_at).toLocaleDateString()],
            ]} />
          </Section>

          <Section title="Outreach">
            <Facts rows={[
              ["AI agent", lead.ai_messaged ? <>Messaged <span style={{ color: C.sub }}>· {ago(lead.last_out_at)}</span></> : <span style={{ color: C.sub }}>Not messaged</span>],
              ["You", lead.human_messaged ? <>Messaged <span style={{ color: C.sub }}>· {ago(lead.last_out_at)}</span></> : <span style={{ color: C.sub }}>Not messaged</span>],
              ["Client", lead.is_client ? "Yes" : <span style={{ color: C.sub }}>No</span>],
            ]} />
          </Section>

          {loadingDetail && <Section><div aria-hidden className="h-16 rounded-lg" style={{ background: C.graySoft }} /></Section>}

          {hasWhy && (
            <Section title="Why this lead">
              <div className="space-y-2.5 text-[13px]">
                {(lead.observation || lead.reason) && <p>{lead.observation || lead.reason}</p>}
                {lead.evidence?.quote && <p className="border-l-2 pl-3 italic" style={{ borderColor: C.line, color: C.sub }}>“{lead.evidence.quote}”</p>}
                {lead.classification && <p style={{ color: C.sub }}>Classified as {lead.classification}</p>}
                {lead.source_segment && <p style={{ color: C.sub }}>Segment: {lead.source_segment}</p>}
                {lead.source_query && <p style={{ color: C.sub }}>Found via “{lead.source_query}”</p>}
                {signal && signal.points > 0 && <p>{signal.why}</p>}
              </div>
              {groups.length > 0 && (
                <div className="mt-4">
                  <Facts rows={groups.map(([g, v]) => [g === "fit" ? "Buyer fit" : g === "timing" ? "Health & size" : g.charAt(0).toUpperCase() + g.slice(1), `${v.p} / ${v.m}`] as [string, React.ReactNode])} />
                </div>
              )}
            </Section>
          )}

          {lead.stage === "rejected" && lead.reject_reason && (
            <Section>
              <p className="text-[13px]" style={{ color: C.red }}>
                Rejected as {REJECT_REASONS.find((r) => r.key === lead.reject_reason)?.label ?? lead.reject_reason}.
                {(lead.reject_reason === "competitor" || lead.reject_reason === "wrong_industry") && <span style={{ color: C.sub }}> This domain won’t be surfaced again.</span>}
              </p>
            </Section>
          )}

          <Section title="Timeline">
            <ol className="space-y-3">
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-3 text-[13px]">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.sub }} />
                  <div><div>{t.label}</div><div className="mt-0.5 text-[12px]" style={{ color: C.sub }}>{new Date(t.at).toLocaleString()}</div></div>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="shrink-0 border-t p-3 pb-[calc(12px+env(safe-area-inset-bottom))]" style={{ borderColor: C.line, background: C.panel }}>
          <div className={`grid gap-2 ${showWa ? "grid-cols-2" : "grid-cols-1"}`}>
            {lead.stage === "rejected" ? (
              <button className="h-11 rounded-lg border text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-[#f9fafb] disabled:opacity-40 col-span-full" style={{ color: C.ink, background: C.panel, borderColor: C.line }} disabled={busy === lead.id} onClick={() => setStage(lead, "approved")}>Restore this lead</button>
            ) : (
              <>
                {showWa && (
                  <a href={waLink(lead)} className="flex h-11 items-center justify-center gap-2 rounded-lg border text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-[#f9fafb]" style={{ background: C.panel, borderColor: C.line, color: C.ink, textDecoration: "none" }}>
                    <MessageCircle size={16} />WhatsApp chat
                  </a>
                )}
                <div><RejectMenu variant="button" full disabled={busy === lead.id} onPick={(reason) => setStage(lead, "rejected", reason)} /></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
