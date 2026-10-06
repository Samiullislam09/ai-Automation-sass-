/** Mr. WhatsApp's connection to one tenant's WhatsApp — a WhatsApp-Web-style link, human-driven.
 *
 *  WHAT THIS IS. Each tenant pairs their OWN WhatsApp by scanning a QR (exactly the "linked
 *  devices" flow on the phone). After that this server holds a live socket to WhatsApp for them:
 *  it RECEIVES messages (stored in outreach_messages, shown in the dashboard's chat UI) and it
 *  SENDS a message when — and only when — a logged-in human clicks Send in that UI.
 *
 *  WHAT THIS DELIBERATELY IS NOT. There is no autonomous sender here. Nothing in this file, and
 *  nothing anywhere below it, pulls approved leads off a queue and messages them on a timer.
 *  `sendText` is called by exactly one thing: the POST /whatsapp/send route, which requires an
 *  authenticated request. A message goes out because a person pressed a button, the same as if
 *  they had opened WhatsApp on their phone. That property is the difference between a CRM inbox
 *  and a spam machine, and it is kept as a code fact, not a policy note: search this repository
 *  for callers of sendText and you will find the one human-triggered route.
 *
 *  Mr. Brain may DRAFT a reply when a message comes in (so the human does not have to type), but
 *  the draft sits in the compose box until the human sends it. Drafting is not sending.
 *
 *  STATE. One WASocket per tenant, kept in a module-level map (this server is a long-lived
 *  process, the same way socket.ts holds its io server). Auth persists in Supabase
 *  (authStore.ts), so a redeploy reconnects without a re-scan. */
import { makeWASocket, DisconnectReason, Browsers } from "@whiskeysockets/baileys";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSupabaseAuthState, clearAuthState } from "./authStore.js";
import { linkIncoming, recordSentStatus } from "./store.js";

type Sock = ReturnType<typeof makeWASocket>;

type Session = {
  sock: Sock;
  status: "pairing" | "connected" | "logged_out" | "banned" | "disconnected";
  qr: string | null;
  phone: string | null;
  /** Set while a connect() is mid-flight so two callers cannot open two sockets for one tenant. */
  starting: boolean;
};

const sessions = new Map<string, Session>();

/** How the rest of the server sees a tenant's connection without touching Baileys. */
export function sessionStatus(tenantId: string): { status: string; qr: string | null; phone: string | null } {
  const s = sessions.get(tenantId);
  if (!s) return { status: "disconnected", qr: null, phone: null };
  return { status: s.status, qr: s.qr, phone: s.phone };
}

async function setDbStatus(
  supabase: SupabaseClient,
  tenantId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await supabase
    .from("whatsapp_sessions")
    .upsert({ tenant_id: tenantId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
}

/** Open (or reopen) a tenant's WhatsApp connection. Returns immediately; the QR and connection
 *  state arrive asynchronously and are pushed to the dashboard as they change. Idempotent: a
 *  second call while one is connected is a no-op, while one is starting waits for nothing. */
export async function connect(
  supabase: SupabaseClient,
  tenantId: string,
  onUpdate?: (s: { status: string; qr: string | null; phone: string | null }) => void
): Promise<void> {
  const existing = sessions.get(tenantId);
  if (existing && (existing.status === "connected" || existing.starting)) return;

  const placeholder: Session = { sock: undefined as any, status: "pairing", qr: null, phone: null, starting: true };
  sessions.set(tenantId, placeholder);
  const push = () => onUpdate?.(sessionStatus(tenantId));

  const { state, saveCreds } = await useSupabaseAuthState(supabase, tenantId);

  const sock: Sock = makeWASocket({
    auth: state,
    browser: Browsers.appropriate("MrLxwa"),
    // We drive the QR ourselves through the dashboard rather than Baileys' terminal printer.
    printQRInTerminal: false,
    // Read receipts and presence are only sent when a human is actually looking; we never fake
    // "online" to a recipient. Left at Baileys' defaults.
    markOnlineOnConnect: false,
  });
  placeholder.sock = sock;
  placeholder.starting = false;

  sock.ev.on("creds.update", () => void saveCreds());

  sock.ev.on("connection.update", async (u: any) => {
    const s = sessions.get(tenantId);
    if (!s) return;

    if (u.qr) {
      // A new QR to show. Stored in whatsapp_sessions.qr so the dashboard can render it, and
      // cleared the moment we connect.
      s.status = "pairing";
      s.qr = u.qr;
      await setDbStatus(supabase, tenantId, { status: "pairing", qr: u.qr });
      push();
    }

    if (u.connection === "open") {
      s.status = "connected";
      s.qr = null;
      s.phone = sock.user?.id ? String(sock.user.id).split(":")[0] : null;
      await setDbStatus(supabase, tenantId, {
        status: "connected",
        qr: null,
        phone_number: s.phone,
        last_connected_at: new Date().toISOString(),
      });
      // Stamp first_connected_at only if it was never set — the warmup window measures from
      // here, and last_connected_at (moved every reconnect) cannot answer "how new is this
      // number". The .is(null) guard makes the write a no-op on every connect after the first.
      await supabase
        .from("whatsapp_sessions")
        .update({ first_connected_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .is("first_connected_at", null);
      push();
    }

    if (u.connection === "close") {
      const code = (u.lastDisconnect?.error as any)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        // The phone unlinked this device. The stored session is dead; wipe it so we do not
        // reconnect-loop, and the tenant must scan again to relink.
        s.status = "logged_out";
        s.qr = null;
        sessions.delete(tenantId);
        await clearAuthState(supabase, tenantId);
        await setDbStatus(supabase, tenantId, { status: "logged_out", qr: null });
        push();
      } else if (code === DisconnectReason.forbidden || code === 403) {
        // WhatsApp refused the account — the ban case. Do not retry; surface it so the tenant
        // sees a real reason rather than a spinner.
        s.status = "banned";
        sessions.delete(tenantId);
        await setDbStatus(supabase, tenantId, { status: "banned", qr: null });
        push();
      } else {
        // A transient drop (network, restart). Reconnect once, reusing the stored creds.
        s.status = "disconnected";
        await setDbStatus(supabase, tenantId, { status: "disconnected" });
        push();
        setTimeout(() => void connect(supabase, tenantId, onUpdate), 3000);
      }
    }
  });

  // Incoming messages. Each is stored and linked to a lead by phone number (store.ts). Nothing
  // is auto-answered here — the dashboard shows it and a human replies.
  //
  // We process "notify" (new, real-time) AND "append" (what Baileys delivers on reconnect for
  // messages that arrived while we were down — every Railway deploy drops the socket, so a reply
  // in that window ONLY ever shows up as an append). linkIncoming de-dupes by WhatsApp message id,
  // so handling both can never store the same reply twice or re-import old history as new.
  sock.ev.on("messages.upsert", async (m: any) => {
    if (m.type !== "notify" && m.type !== "append") return;
    for (const msg of m.messages ?? []) {
      if (msg.key?.fromMe) continue; // our own outgoing echo, already recorded on send
      let jid = msg.key?.remoteJid as string | undefined;
      // WhatsApp now delivers many incoming messages with a privacy LID (<id>@lid) as remoteJid
      // instead of the phone number — the real phone jid is in remoteJidAlt. Without this, a reply
      // from a known lead lands under a junk "+<lid>" contact instead of matching their number.
      if (jid?.endsWith("@lid")) {
        const alt = (msg.key?.remoteJidAlt ?? msg.key?.senderPn ?? msg.key?.participantAlt) as string | undefined;
        if (alt && alt.includes("@s.whatsapp.net")) jid = alt;
      }
      if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") continue; // skip groups + status
      const text =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ??
        msg.message?.buttonsResponseMessage?.selectedDisplayText ??
        msg.message?.listResponseMessage?.title ??
        "";
      if (!String(text).trim()) continue; // a reaction/receipt with no body — nothing to show
      await linkIncoming(supabase, tenantId, {
        phone: jid.split("@")[0],
        text: String(text),
        waMessageId: msg.key?.id ?? null,
      });
    }
  });

  // Delivery/read receipts for messages WE sent → move outreach_messages.status forward.
  sock.ev.on("messages.update", async (updates: any[]) => {
    for (const up of updates ?? []) {
      const status = up.update?.status;
      const id = up.key?.id;
      if (!id || status == null) continue;
      // Baileys status: 2=server ack (sent), 3=delivered, 4=read.
      const mapped = status >= 4 ? "read" : status >= 3 ? "delivered" : null;
      if (mapped) await recordSentStatus(supabase, tenantId, id, mapped);
    }
  });
}

/** Send one text message, NOW, because a human asked to. The only sender in the system.
 *
 *  Returns the WhatsApp message id so the caller can store the outgoing row keyed to it, which is
 *  how the delivery/read receipts above find their row later. Throws if the tenant is not
 *  connected — a send must never silently no-op. */
export async function sendText(tenantId: string, phone: string, body: string): Promise<{ waMessageId: string }> {
  const s = sessions.get(tenantId);
  if (!s || s.status !== "connected" || !s.sock) {
    throw new Error("WhatsApp is not connected for this workspace — pair it first.");
  }
  const jid = `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;

  // Verify the number is actually on WhatsApp BEFORE sending. A landline or any non-WhatsApp
  // number (common for the business listings leads come from) makes sendMessage hang for minutes
  // — this was the "5–10 min to send" the owner saw. onWhatsApp answers in a second; if the
  // number isn't registered we fail fast with a message a human can act on.
  let target = jid;
  try {
    const results = await withTimeout(s.sock.onWhatsApp(jid), 12_000, "checking the number");
    const info = Array.isArray(results) ? results[0] : undefined;
    if (!info?.exists) {
      throw new Error("This number isn't on WhatsApp — it looks like a landline or a number with no WhatsApp account. Try their mobile/WhatsApp number.");
    }
    if (info.jid) target = info.jid; // WhatsApp's canonical jid for this number
  } catch (e: any) {
    // A real "not on WhatsApp" is rethrown; a timeout on the check shouldn't block a send to a
    // number that is fine, so fall through to the send (which has its own timeout below).
    if (/isn't on WhatsApp/.test(String(e?.message))) throw e;
  }

  const sent = await withTimeout(s.sock.sendMessage(target, { text: body }), 25_000, "sending the message");
  return { waMessageId: sent?.key?.id ?? "" };
}

/** Race a promise against a timeout so a hung Baileys call can never freeze a request forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`WhatsApp timed out ${label}. Try again in a moment.`)), ms)),
  ]);
}

/** Is a number on WhatsApp, and what's its photo — in ONE call (the dashboard needs both when a
 *  chat opens). `onWhatsapp: null` means we couldn't tell (not connected / check timed out), which
 *  the UI treats as "unknown", not "no". A landline returns `onWhatsapp: false` so the UI can say
 *  so plainly and disable Send instead of letting a message hang. */
export async function getContactInfo(tenantId: string, phone: string): Promise<{ onWhatsapp: boolean | null; photo: string | null }> {
  const s = sessions.get(tenantId);
  if (!s || s.status !== "connected" || !s.sock) return { onWhatsapp: null, photo: null };
  const jid = `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
  let onWhatsapp: boolean | null = null;
  let photo: string | null = null;
  try {
    const results = await withTimeout(s.sock.onWhatsApp(jid), 10_000, "checking the number");
    const info = Array.isArray(results) ? results[0] : undefined;
    onWhatsapp = !!info?.exists;
    if (info?.exists) {
      try {
        photo = (await withTimeout(s.sock.profilePictureUrl(info.jid ?? jid, "image"), 8_000, "fetching the photo")) ?? null;
      } catch {
        photo = null; // no public photo / privacy
      }
    }
  } catch {
    onWhatsapp = null; // couldn't check — leave it unknown
  }
  return { onWhatsapp, photo };
}

/** The real WhatsApp profile photo URL for a number, or null. Only works while connected, and
 *  only for numbers that are on WhatsApp with a photo the privacy settings let us see — otherwise
 *  null (the UI falls back to the default avatar). The URL WhatsApp returns is short-lived, so the
 *  caller fetches it fresh per chat open rather than storing it. */
export async function getProfilePicture(tenantId: string, phone: string): Promise<string | null> {
  const s = sessions.get(tenantId);
  if (!s || s.status !== "connected" || !s.sock) return null;
  const jid = `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
  try {
    return (await s.sock.profilePictureUrl(jid, "image")) ?? null;
  } catch {
    return null; // no photo, privacy, or not a WhatsApp number
  }
}

/** Unlink: log the device out from our side and forget the session. The tenant's phone still has
 *  its own copy; this just ends OUR link. */
export async function disconnect(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const s = sessions.get(tenantId);
  try {
    await s?.sock?.logout();
  } catch {
    /* already gone */
  }
  sessions.delete(tenantId);
  await clearAuthState(supabase, tenantId);
  await setDbStatus(supabase, tenantId, { status: "disconnected", qr: null, phone_number: null });
}

/** On server boot, reopen connections for tenants who were connected — so a redeploy does not
 *  silently drop everyone's WhatsApp until they each poke the dashboard. */
export async function resumeConnected(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.from("whatsapp_sessions").select("tenant_id").eq("status", "connected");
  for (const row of data ?? []) {
    connect(supabase, row.tenant_id as string).catch((e) =>
      console.error(`[whatsapp] resume failed for ${row.tenant_id}:`, e?.message)
    );
  }
}
