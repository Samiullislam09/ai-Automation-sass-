"use client";
import { useEffect, useState } from "react";
import { CalendarClock, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { C, D, STAGE, SOURCE_LABEL, SORT_LABEL, REJECT_REASONS, ago, scoreColor, isToday, fmtDay, siteLabel, initials, cityOf, countryOf, phoneDisplay, StageChip, Tag, WaGlyph, RejectMenu, type Lead, type Gen } from "./shared";

function MeetingCard({ meeting, onClose }: { meeting: NonNullable<Lead["meeting"]>; onClose: () => void }) {
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
    <div className="mb-4 rounded-xl p-3" style={{ background: C.brandSoft, border: "1px solid #ddd6ff" }}>
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold" style={{ color: C.brandInk }}><CalendarClock size={14} />{meeting.status === "scheduled" ? "Meeting booked" : "Slots offered — awaiting reply"}</div>
      {when && <div className="text-[13px]" style={{ color: C.ink }}>{when}</div>}
      {meeting.meet_link && <a href={meeting.meet_link} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[12.5px] font-semibold" style={{ color: C.blue }}>Join Google Meet →</a>}
      {meeting.status === "scheduled" && (
        <button onClick={cancel} disabled={busy} className="mt-2 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-60" style={{ color: "#b42318", background: "#fdeaea" }}>{busy ? "Cancelling…" : "Cancel meeting"}</button>
      )}
    </div>
  );
}

export default function LeadDrawer({ lead, onClose, setStage, busy, waLink, loadingDetail }: { lead: Lead; loadingDetail?: boolean; onClose: () => void; setStage: (l: Lead, s: string, reason?: string) => void; busy: string | null; waLink: (l: Lead) => string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const timeline = [
    lead.created_at && { dot: C.blue, label: "Lead created", at: lead.created_at },
    lead.approved_at && { dot: C.green, label: "Approved", at: lead.approved_at },
    lead.contacted_at && { dot: C.violet, label: "First message sent", at: lead.contacted_at },
    lead.last_in_at && { dot: C.amber, label: "They replied", at: lead.last_in_at },
  ].filter(Boolean) as { dot: string; label: string; at: string }[];
  return (
    <div className="fixed inset-0 z-[90] flex justify-end" style={{ background: "rgba(15,23,42,.35)" }} onClick={onClose}>
      <div className="flex h-full w-full flex-col sm:max-w-md" style={{ background: C.panel }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Lead details">
      <div className="lx-lscroll min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: C.brand }}>{initials(lead)}</span>
            <div>
              <div className="text-[15px] font-bold" style={{ color: C.ink }}>{lead.company || lead.name || "Lead"}</div>
              <div className="text-[12px]" style={{ color: C.sub }}>{lead.country || lead.city || SOURCE_LABEL[lead.source ?? ""] || ""}</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5" style={{ background: C.graySoft, color: C.sub }} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-lg px-2.5 py-1 text-[13px] font-bold" style={{ color: scoreColor(lead.icp_score), background: C.graySoft }}>{lead.icp_score ?? "—"}/100</span>
          <StageChip stage={lead.stage} />
          {lead.needs_attention && <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ color: C.amber, background: C.amberSoft }}><TriangleAlert size={12} />Needs you</span>}
        </div>
        {lead.needs_attention && lead.needs_attention_reason && (
          <div className="mb-4 rounded-xl px-3 py-2 text-[12.5px]" style={{ color: C.amber, background: C.amberSoft, border: "1px solid #f3dcb0" }}>
            Mr Lxwa replied but flagged this for you: <b>{lead.needs_attention_reason}</b>
          </div>
        )}
        {lead.meeting && <MeetingCard meeting={lead.meeting} onClose={onClose} />}
        <div className="mb-4 space-y-2 text-[13px]" style={{ color: C.ink }}>
          {(lead.whatsapp || lead.phone) && <Row icon="phone" v={lead.whatsapp || lead.phone!} />}
          {lead.email && <Row icon="mail" v={lead.email} />}
          {lead.website && <Row icon="web" v={lead.website} href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} />}
        </div>

        {/* Lead details — always shown, "—" when absent, so the panel never looks empty. */}
        <div className="mb-5 rounded-2xl p-4" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
          <div className="mb-3 text-[13px] font-bold" style={{ color: C.ink }}>Lead details</div>
          <Detail k="Company" v={lead.company} />
          <Detail k="Contact" v={lead.name} />
          <Detail k="Email" v={lead.email ?? null} />
          <Detail k="Website" v={lead.website ?? null} />
          <Detail k="Country" v={lead.country ?? null} />
          <Detail k="City" v={lead.city ?? null} />
          <Detail k="Source" v={SOURCE_LABEL[lead.source ?? ""] ?? lead.source ?? null} />
          <Detail k="Created" v={new Date(lead.created_at).toLocaleDateString()} last />
        </div>
        <div className="mb-5 rounded-2xl p-4" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
          <div className="mb-3 text-[13px] font-bold" style={{ color: C.ink }}>Automation status</div>
          <StatusRow label="AI Agent" on={lead.ai_messaged} at={lead.ai_messaged ? lead.last_out_at : null} tone={C.green} soft={C.greenSoft} />
          <StatusRow label="You" on={lead.human_messaged} at={lead.human_messaged ? lead.last_out_at : null} tone={C.green} soft={C.greenSoft} />
          <StatusRow label="Client" on={lead.is_client} tone={C.green} soft={C.greenSoft} last />
        </div>
        {loadingDetail && <div aria-hidden className="mb-5 h-24 animate-pulse rounded-2xl" style={{ background: C.graySoft }} />}
        {(lead.reason || lead.observation || lead.source_segment || lead.score_breakdown) && (
          <div className="mb-5 rounded-2xl p-4" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
            <div className="mb-2 text-[13px] font-bold" style={{ color: C.ink }}>Why this lead</div>
            {(lead.observation || lead.reason) && <p className="mb-2 text-[12.5px]" style={{ color: C.sub }}>{lead.observation || lead.reason}</p>}
            {lead.evidence?.quote && <p className="mb-2 border-l-2 pl-2 text-[12px] italic" style={{ borderColor: C.line, color: C.sub }}>“{lead.evidence.quote}”</p>}
            <div className="flex flex-wrap gap-1.5">
              {lead.classification && <Tag tone={lead.classification === "buyer" ? C.green : C.amber} soft={lead.classification === "buyer" ? C.greenSoft : C.amberSoft}>{lead.classification === "buyer" ? "Buyer ✓" : lead.classification}</Tag>}
              {lead.source_segment && <Tag tone={C.brand} soft={C.brandSoft}>Segment: {lead.source_segment}</Tag>}
              {lead.source_query && <Tag tone={C.sub} soft={C.graySoft}>Found via “{lead.source_query}”</Tag>}
            </div>
            {/* verified buying signals, from the stored score breakdown */}
            {(() => {
              const sig = lead.score_breakdown?.components?.find((c) => c.id === "buying-signals");
              return sig && sig.points > 0 ? <p className="mt-2 text-[12px]" style={{ color: C.green }}>✓ {sig.why}</p> : null;
            })()}
            {/* the score, explained group by group */}
            {lead.score_breakdown?.components && (
              <div className="mt-3 space-y-1">
                {Object.entries(
                  lead.score_breakdown.components.reduce((acc: Record<string, { p: number; m: number }>, c) => {
                    const g = acc[c.group] ?? { p: 0, m: 0 };
                    acc[c.group] = { p: g.p + c.points, m: g.m + c.max };
                    return acc;
                  }, {}),
                ).map(([group, v]) => (
                  <div key={group} className="flex items-center justify-between text-[11.5px]" style={{ color: C.sub }}>
                    <span className="capitalize">{group === "fit" ? "Buyer fit" : group === "timing" ? "Health & size" : group}</span>
                    <span className="font-semibold" style={{ color: C.ink }}>{v.p}/{v.m}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {lead.stage === "rejected" && lead.reject_reason && (
          <div className="mb-5 rounded-xl p-3 text-[12px]" style={{ background: C.redSoft, color: C.red }}>
            Rejected as: {REJECT_REASONS.find((r) => r.key === lead.reject_reason)?.label ?? lead.reject_reason}
            {(lead.reject_reason === "competitor" || lead.reject_reason === "wrong_industry") && <span style={{ color: C.sub }}> — this domain won’t be surfaced again.</span>}
          </div>
        )}
        <div>
          <div className="mb-2 text-[13px] font-bold" style={{ color: C.ink }}>Timeline</div>
          <div className="space-y-3">
            {timeline.map((t, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.dot }} />
                <div>
                  <div className="text-[12.5px] font-medium" style={{ color: C.ink }}>{t.label}</div>
                  <div className="text-[11.5px]" style={{ color: C.sub }}>{new Date(t.at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="shrink-0 p-3 pb-[calc(12px+env(safe-area-inset-bottom))]" style={{ borderTop: `1px solid ${C.line}`, background: C.panel }}>
        <div className="grid grid-cols-2 gap-2">
          {lead.stage === "rejected" ? (
            <button className="col-span-2 h-11 rounded-xl text-[13px] font-semibold" style={{ color: C.brandInk, background: C.brandSoft }} disabled={busy === lead.id} onClick={() => setStage(lead, "approved")}>Restore this lead</button>
          ) : (
            <>
              <a href={waLink(lead)} className="flex h-11 items-center justify-center gap-2 rounded-xl text-[13px] font-semibold" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.ink, textDecoration: "none" }}>
                <span style={{ color: "#16a34a" }}><WaGlyph size={16} /></span>
                WhatsApp chat
              </a>
              <div><RejectMenu variant="button" full disabled={busy === lead.id} onPick={(reason) => setStage(lead, "rejected", reason)} /></div>
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
function Row({ icon, v, href }: { icon: string; v: string; href?: string }) {
  const paths: Record<string, React.ReactNode> = {
    phone: <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012 4.2 2 2 0 014 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.6a2 2 0 01-.5 2.1L8 9.6a16 16 0 006 6l1.2-1.1a2 2 0 012.1-.5c.8.3 1.7.5 2.6.6A2 2 0 0122 16.9z" stroke="currentColor" strokeWidth="1.6" fill="none" />,
    mail: <path d="M4 6h16v12H4zM4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" />,
    web: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18" stroke="currentColor" strokeWidth="1.5" fill="none" />,
  };
  const body = <span className="inline-flex items-center gap-2"><span style={{ color: C.sub }}><svg width="15" height="15" viewBox="0 0 24 24">{paths[icon]}</svg></span>{v}</span>;
  return href ? <a href={href} target="_blank" rel="noreferrer" className="block" style={{ color: C.brand }}>{body}</a> : <div>{body}</div>;
}
function Detail({ k, v, last }: { k: string; v: string | null | undefined; last?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3" style={{ paddingBottom: last ? 0 : 8, marginBottom: last ? 0 : 8, borderBottom: last ? "none" : `1px solid ${C.line}` }}>
      <span className="text-[12px]" style={{ color: C.sub }}>{k}</span>
      <span className="max-w-[60%] truncate text-right text-[12.5px] font-medium" style={{ color: v ? C.ink : C.sub }}>{v || "—"}</span>
    </div>
  );
}
function StatusRow({ label, on, at, tone, soft, last }: { label: string; on: boolean; at?: string | null; tone: string; soft: string; last?: boolean }) {
  return (
    <div className="flex items-center justify-between" style={{ paddingBottom: last ? 0 : 10, marginBottom: last ? 0 : 10, borderBottom: last ? "none" : `1px solid ${C.line}` }}>
      <span className="text-[12.5px]" style={{ color: C.ink }}>{label}</span>
      <div className="text-right">
        <span className="rounded-md px-2 py-0.5 text-[11.5px] font-semibold" style={{ color: on ? tone : C.sub, background: on ? soft : C.graySoft }}>{on ? "Messaged" : "Not messaged"}</span>
        {at && <div className="text-[10.5px]" style={{ color: C.sub }}>{ago(at)}</div>}
      </div>
    </div>
  );
}

