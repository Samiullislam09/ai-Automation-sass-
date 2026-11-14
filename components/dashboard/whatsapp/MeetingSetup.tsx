"use client";
import { useCallback, useEffect, useState } from "react";

/** Is the assistant able to turn a customer's "let's talk" into a real call? Google Calendar connected = it offers free slots,
 *  creates the Google Meet link, puts the call in the owner's calendar and messages the link to the customer and the team.
 *  Not connected = it can only pass the request to a person. This tells the owner, in plain words, and links to the fix. */
export type MeetingSetup = { google: "connected" | "needs_reconnect" | "not_connected" | "not_configured"; email: string | null; booking_link: boolean };

export function useMeetingSetup(): { setup: MeetingSetup | null; reload: () => void } {
  const [setup, setSetup] = useState<MeetingSetup | null>(null);
  const reload = useCallback(() => {
    fetch("/api/whatsapp/meeting-setup", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j?.ok) setSetup({ google: j.google, email: j.email ?? null, booking_link: !!j.booking_link }); }).catch(() => {});
  }, []);
  useEffect(() => {
    reload();
    const onFocus = () => reload(); // back from the Google consent screen
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);
  return { setup, reload };
}

export const googleOk = (s: MeetingSetup | null) => s?.google === "connected";

/** The strip shown on the WhatsApp page while Google Calendar is not usable. */
export function MeetingSetupBanner({ setup, onOpenSettings }: { setup: MeetingSetup | null; onOpenSettings?: () => void }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { try { setHidden(sessionStorage.getItem("wa-meet-banner") === "1"); } catch { /* ignore */ } }, []);
  if (!setup || setup.google === "connected" || hidden) return null;
  const reconnect = setup.google === "needs_reconnect";
  const unconfigured = setup.google === "not_configured";
  const title = reconnect ? "Reconnect Google to allow Calendar" : "Connect Google Calendar to book calls automatically";
  const body = unconfigured
    ? "Google sign-in is not set up on this server yet, so calls cannot be booked automatically. Until then the assistant tells you when someone wants a call and you send the link yourself."
    : "Right now, when a customer wants a call, the assistant can only tell you and you have to send the meeting link yourself. With Google connected it offers free times, creates the Google Meet link, adds the call to your calendar, and sends the details to the customer and to you.";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5" style={{ background: "#fff8e1", borderBottom: "1px solid #f3e2a6", color: "#7a5b00" }} role="status">
      <div className="min-w-0 flex-1 basis-[260px]">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-[12px] leading-relaxed">{body}{setup.booking_link ? " Your booking link is set, so customers can still book through it." : ""}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!unconfigured && <a href="/api/integrations/google/start" className="inline-flex h-8 items-center rounded-lg px-3.5 text-[12.5px] font-semibold text-white" style={{ background: "#008069" }}>{reconnect ? "Reconnect Google" : "Connect Google"}</a>}
        {onOpenSettings && <button onClick={onOpenSettings} className="h-8 rounded-lg px-3 text-[12.5px] font-medium" style={{ background: "#fff", border: "1px solid #f3e2a6" }}>Other options</button>}
        <button onClick={() => { setHidden(true); try { sessionStorage.setItem("wa-meet-banner", "1"); } catch { /* ignore */ } }} className="h-8 rounded-lg px-2 text-[12px]" aria-label="Hide for now">Later</button>
      </div>
    </div>
  );
}
