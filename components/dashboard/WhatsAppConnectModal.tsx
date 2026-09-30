"use client";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { useStore } from "@/lib/store";

/** The QR pairing flow as a modal, reused by both the WhatsApp page and the Connect page.
 *
 *  Self-contained: it owns its own status poll and QR rendering, so a caller only has to open it
 *  and be told when the link succeeds. Poll runs only while the modal is open (the interval is
 *  torn down on close), so a closed modal costs nothing.
 *
 *  It links a WhatsApp; it does not send anything. */
type Status = { status: string; qr: string | null; phone: string | null };

export default function WhatsAppConnectModal({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected?: (phone: string | null) => void;
}) {
  const { toast } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/status").then((x) => x.json());
      if (r.ok) setStatus({ status: r.status, qr: r.qr ?? null, phone: r.phone ?? null });
    } catch { /* transient */ }
  }, []);

  // Poll only while open; faster while a QR is on screen (it rotates ~20s).
  useEffect(() => {
    if (!open) return;
    poll();
    const id = setInterval(poll, status?.status === "pairing" ? 2500 : 6000);
    return () => clearInterval(id);
  }, [open, poll, status?.status]);

  useEffect(() => {
    if (status?.qr) {
      QRCode.toDataURL(status.qr, { width: 260, margin: 1, color: { dark: "#0b0b12", light: "#ffffff" } })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(""));
    } else setQrDataUrl("");
  }, [status?.qr]);

  // Tell the caller the moment we connect, then let them close.
  useEffect(() => {
    if (status?.status === "connected") onConnected?.(status.phone);
  }, [status?.status, status?.phone, onConnected]);

  // Esc to close; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  const startConnect = async () => {
    setConnecting(true);
    try {
      const r = await fetch("/api/whatsapp/connect", { method: "POST" }).then((x) => x.json());
      if (!r.ok) toast(r.error ?? "Could not start pairing.", "error");
      else setStatus({ status: r.status, qr: r.qr ?? null, phone: r.phone ?? null });
    } catch (e: any) {
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setConnecting(false);
    }
  };

  if (!open) return null;

  const st = status?.status ?? "disconnected";
  const pairing = st === "pairing";
  const connected = st === "connected";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="lx-card w-full max-w-md rounded-3xl p-7"
        style={{ border: "1px solid var(--lx-border)", boxShadow: "0 24px 64px rgba(0,0,0,.5)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Link your WhatsApp</h2>
            <p className="lx-11 lx-mut mt-1">Same as WhatsApp Web — scan once and stay linked.</p>
          </div>
          <button className="lx-mut rounded-full p-1.5 hover:opacity-70" style={{ background: "var(--lx-in)" }} onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>

        {connected ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "var(--lx-green)" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#04120a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <b className="lx-13">Connected{status?.phone ? ` · ${status.phone}` : ""}</b>
            <p className="lx-11 lx-mut">Mr. WhatsApp is linked. You can close this.</p>
            <button className="lx-grad lx-12 mt-1 rounded-full px-5 py-2.5 font-semibold" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            {/* steps */}
            <ol className="lx-11 lx-mut mb-4 space-y-1.5">
              <li>1. Open <b style={{ color: "var(--lx-text)" }}>WhatsApp</b> on your phone</li>
              <li>2. <b style={{ color: "var(--lx-text)" }}>Settings → Linked devices → Link a device</b></li>
              <li>3. Scan the code below</li>
            </ol>

            <div className="mx-auto flex h-[260px] w-[260px] items-center justify-center rounded-2xl" style={{ background: "#fff", border: "1px solid var(--lx-border)" }}>
              {pairing && qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="WhatsApp pairing QR" width={244} height={244} />
              ) : pairing ? (
                <span className="lx-11" style={{ color: "#0b0b12" }}>Generating code…</span>
              ) : st === "banned" ? (
                <span className="lx-11 px-4 text-center" style={{ color: "#b91c1c" }}>WhatsApp has blocked this number. Try a different one.</span>
              ) : (
                <span className="lx-11" style={{ color: "#0b0b12" }}>Press connect to get a code</span>
              )}
            </div>

            {st !== "banned" && (
              <button
                className="lx-grad lx-12 mx-auto mt-5 block rounded-full px-6 py-2.5 font-semibold disabled:opacity-60"
                onClick={startConnect}
                disabled={connecting || pairing}
              >
                {connecting ? "Starting…" : pairing ? "Waiting for scan…" : st === "logged_out" ? "Reconnect" : "Connect WhatsApp"}
              </button>
            )}
            <p className="lx-10 lx-mut mt-3 text-center">The code refreshes every few seconds until you scan.</p>
          </>
        )}
      </div>
    </div>
  );
}
