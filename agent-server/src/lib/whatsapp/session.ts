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
import os from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSupabaseAuthState, clearAuthState } from "./authStore.js";
import { linkIncoming, recordSentStatus } from "./store.js";
import { getWhatsappAutoReply } from "../outreach/settings.js";
import { scheduleAutoReply } from "./autoReply.js";

type Sock = ReturnType<typeof makeWASocket>;

type Session = {
  sock: Sock;
  /** "reconnecting" = already linked (saved login exists) and coming back online: NOT a reason to ask for a QR. */
  status: "pairing" | "connected" | "logged_out" | "banned" | "disconnected" | "reconnecting";
  qr: string | null;
  phone: string | null;
  /** Set while a connect() is mid-flight so two callers cannot open two sockets for one tenant. */
  starting: boolean;
};

const sessions = new Map<string, Session>();

/** One id per running process: the Railway deployment (so an old deploy and a new one differ) plus the pid and a
 *  random part (so two copies on one machine differ). */
export const INSTANCE_ID = `${process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_REPLICA_ID || "local"}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
/** When this process started. The newest process wins a handover. */
export const PROCESS_STARTED_AT = Date.now();
/** Who this process is, in words. "linux" with a short random host is a container (Railway); "win32" is a Windows PC. */
export const INSTANCE_INFO = `${process.platform} / ${os.hostname()} / pid ${process.pid}${process.env.RAILWAY_DEPLOYMENT_ID ? ` / deploy ${process.env.RAILWAY_DEPLOYMENT_ID.slice(0, 8)}` : ""}`;

const LEASE_STALE_MS = 60_000;   // a holder that has not renewed for this long is gone
const LEASE_RENEW_MS = 15_000;   // how often the holder renews, and so how fast it notices a handover request
const WAIT_RETRY_MS = 10_000;    // how often a waiting process looks again

/** May THIS process hold WhatsApp at all? A copy running on a developer's computer (Windows or macOS) must never
 *  touch the production login: it would take the connection from the real server every time it starts. Only a
 *  Linux host (a container) takes part by default; set WHATSAPP_ENABLED=1 to force it on anywhere, 0 to force it off. */
export function whatsappHostEnabled(env: Record<string, string | undefined> = process.env, platform: string = process.platform): boolean {
  if (env.WHATSAPP_ENABLED === "1") return true;
  if (env.WHATSAPP_ENABLED === "0") return false;
  return platform === "linux";
}

export type LeaseRow = { owner?: string | null; owner_seen_at?: string | null; owner_started_at?: string | null; takeover_by?: string | null };

/** Who may hold the WhatsApp connection? Pure.
 *   take     nobody holds it, or the holder stopped renewing (it is gone): this process may.
 *   mine     this process already holds it.
 *   request  ANOTHER live process holds it, but this one is NEWER: ask it to step aside, and wait.
 *   wait     ANOTHER live process holds it and is newer (or the same age): wait, never fight. */
export function leaseDecision(row: LeaseRow | null, me: string, myStartedAt: number, nowMs: number): "take" | "mine" | "request" | "wait" {
  const owner = row?.owner ?? null;
  if (!owner) return "take";
  if (owner === me) return "mine";
  const seen = row?.owner_seen_at ? Date.parse(row.owner_seen_at) : 0;
  if (nowMs - seen > LEASE_STALE_MS) return "take";
  const ownerStart = row?.owner_started_at ? Date.parse(row.owner_started_at) : 0;
  return myStartedAt > ownerStart ? "request" : "wait";
}

/** The holder, on a renewal: should it yield to someone who asked? Pure. Only a request from a NEWER process counts. */
export function shouldYield(row: { takeover_by?: string | null } | null, me: string): boolean {
  const by = row?.takeover_by ?? null;
  return !!by && by !== me;
}

/** Tenants whose connection is held by ANOTHER process right now (so the page can say so instead of "reconnecting"). */
const heldElsewhere = new Map<string, { until: number }>();
export function inUseElsewhere(tenantId: string): boolean {
  const h = heldElsewhere.get(tenantId);
  if (!h) return false;
  if (Date.now() > h.until) { heldElsewhere.delete(tenantId); return false; }
  return true;
}
let leaseColumnsMissing = false;   // migration 039 not applied
let handoverColumnsMissing = false; // migration 041 not applied

const baseLease = () => ({ owner: INSTANCE_ID, owner_seen_at: new Date().toISOString() });
const fullLease = () => ({ ...baseLease(), ...(handoverColumnsMissing ? {} : { owner_started_at: new Date(PROCESS_STARTED_AT).toISOString(), takeover_by: null, owner_info: INSTANCE_INFO }) });

async function claimLease(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  if (leaseColumnsMissing) return true; // migration 039 not applied: no lease, fall back to backing off on 440
  let sel = await supabase.from("whatsapp_sessions").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (sel.error) return true; // a read hiccup must not stop a connection
  const row = sel.data as (LeaseRow & Record<string, unknown>) | null;
  if (row && !("owner" in row)) { leaseColumnsMissing = true; console.warn("[whatsapp] migration 039 (connection lease) is not applied: running without it"); return true; }
  if (row && !("takeover_by" in row)) handoverColumnsMissing = true;

  const decision = leaseDecision(row, INSTANCE_ID, PROCESS_STARTED_AT, Date.now());
  if (decision === "wait" || decision === "request") {
    heldElsewhere.set(tenantId, { until: Date.now() + 30_000 });
    if (decision === "request" && !handoverColumnsMissing && row?.takeover_by !== INSTANCE_ID) {
      // This process is newer: ask the holder to hand over. It sees the request on its next renewal (within 15 s).
      await supabase.from("whatsapp_sessions").update({ takeover_by: INSTANCE_ID }).eq("tenant_id", tenantId).eq("owner", row!.owner as string);
      console.warn(`[whatsapp] ${tenantId}: asked the current holder (${row?.owner_info ?? row?.owner}) to hand over the login to this newer process`);
    }
    return false;
  }
  heldElsewhere.delete(tenantId);

  // Take it only if it is still free, stale or already ours: the update is the lock, a racing process loses cleanly.
  const stale = new Date(Date.now() - LEASE_STALE_MS).toISOString();
  const upd = await supabase.from("whatsapp_sessions").update(fullLease())
    .eq("tenant_id", tenantId).or(`owner.is.null,owner.eq.${INSTANCE_ID},owner_seen_at.lt.${stale}`).select("tenant_id");
  if (upd.error) return true;
  if ((upd.data ?? []).length === 0) {
    if (!row) {
      // No row yet (first ever connect): create it with us as the owner.
      await supabase.from("whatsapp_sessions").upsert({ tenant_id: tenantId, ...fullLease(), updated_at: new Date().toISOString() }, { onConflict: "tenant_id", ignoreDuplicates: true });
    }
    const again = await supabase.from("whatsapp_sessions").select("owner").eq("tenant_id", tenantId).maybeSingle();
    if ((again.data as any)?.owner && (again.data as any).owner !== INSTANCE_ID) { heldElsewhere.set(tenantId, { until: Date.now() + 30_000 }); return false; }
  }
  console.log(`[whatsapp] ${tenantId}: this process holds the login (${INSTANCE_INFO})`);
  return true;
}

let leaseTimer: NodeJS.Timeout | null = null;
function startLeaseHeartbeat(supabase: SupabaseClient): void {
  if (leaseTimer || leaseColumnsMissing) return;
  leaseTimer = setInterval(async () => {
    for (const [tenantId, s] of Array.from(sessions.entries())) {
      if (s.starting || (s.status !== "connected" && s.status !== "reconnecting")) continue;
      const cols = handoverColumnsMissing ? "tenant_id" : "tenant_id, takeover_by";
      const r = await supabase.from("whatsapp_sessions").update({ owner_seen_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("owner", INSTANCE_ID).select(cols);
      if (r.error) continue;
      const got = (r.data ?? []) as unknown as { takeover_by?: string | null }[];
      if (got.length === 0) {
        // The lease is no longer ours (someone took it): stop using the socket so we do not fight for it.
        console.error(`[whatsapp] ${tenantId}: another process now holds this login; this one steps aside`);
        heldElsewhere.set(tenantId, { until: Date.now() + 30_000 });
        sessions.delete(tenantId);
        try { (s.sock as any)?.end?.(undefined); } catch { /* already closed */ }
      } else if (shouldYield(got[0], INSTANCE_ID)) {
        // A NEWER process asked for the login (a new deploy): hand it over now, so it does not have to wait for us to die.
        console.warn(`[whatsapp] ${tenantId}: a newer process (${got[0].takeover_by}) asked for this login; handing it over`);
        heldElsewhere.set(tenantId, { until: Date.now() + 30_000 });
        sessions.delete(tenantId);
        try { (s.sock as any)?.end?.(undefined); } catch { /* already closed */ }
        await supabase.from("whatsapp_sessions").update({ owner: null, owner_seen_at: null, owner_started_at: null, owner_info: null }).eq("tenant_id", tenantId).eq("owner", INSTANCE_ID);
      }
    }
  }, LEASE_RENEW_MS);
  leaseTimer.unref?.();
}

/** On shutdown: hand the connection over at once instead of making the next process wait for the lease to go stale. */
export async function releaseAllLeases(supabase: SupabaseClient): Promise<void> {
  if (leaseTimer) { clearInterval(leaseTimer); leaseTimer = null; }
  const ids = Array.from(sessions.keys());
  for (const tenantId of ids) {
    try { (sessions.get(tenantId)?.sock as any)?.end?.(undefined); } catch { /* ignore */ }
    sessions.delete(tenantId);
    await supabase.from("whatsapp_sessions").update({ owner: null, owner_seen_at: null, ...(handoverColumnsMissing ? {} : { owner_started_at: null, owner_info: null }) }).eq("tenant_id", tenantId).eq("owner", INSTANCE_ID).then(() => {}, () => {});
  }
}

/** What to do when WhatsApp closes the socket. Pure, so the rules are a test, not a guess.
 *   logged_out  the phone unlinked this device: the saved login is dead, wipe it, a scan is needed.
 *   banned      WhatsApp refused the account: never retry.
 *   replaced    ANOTHER process opened the same login (a second server, a local dev copy, an old deploy that has
 *               not stopped yet). Reconnecting at once only knocks that one off and gets knocked off in turn,
 *               forever. Wait a long while instead.
 *   reconnect   anything else (network, restart): come back, a little slower each time. */
export function closeAction(code: number | undefined): "logged_out" | "banned" | "replaced" | "reconnect" {
  if (code === DisconnectReason.loggedOut) return "logged_out";
  if (code === DisconnectReason.forbidden || code === 403) return "banned";
  if (code === DisconnectReason.connectionReplaced || code === 440) return "replaced";
  return "reconnect";
}

/** Delay before the next reconnect: 3s, 6s, 12s ... capped at 60s; a long wait after "replaced". */
export function reconnectDelayMs(attempt: number, replaced: boolean): number {
  if (replaced) return 10 * 60_000;
  return Math.min(60_000, 3_000 * 2 ** Math.max(0, attempt));
}

/** Per tenant: how many reconnects in a row have failed, and the earliest moment another connect may start. */
const retry = new Map<string, { attempt: number; notBefore: number }>();

const healReported = new Set<string>();
let hostOffNoted = false;

/** Can this process send for the tenant RIGHT NOW? The live socket answers that, not the database row: the row
 *  is only a record of it and can be wrong (an old, late "close" event used to write "disconnected" after the
 *  new socket had already opened). Trusting the row meant the Activity page said "Working" while no first message
 *  ever left. When the live socket is up and the row disagrees, the row is corrected here. */
export async function senderOnline(supabase: SupabaseClient, tenantId: string, dbStatus: string | null | undefined): Promise<boolean> {
  const live = sessions.get(tenantId);
  if (!live || live.status !== "connected" || !live.sock) return false;
  if (dbStatus !== "connected") {
    // The socket flips to "connected" a moment BEFORE its own record is written, so a sender that wakes inside that
    // moment sees the old row. That is harmless and is corrected here. It is reported once per connection, and
    // then CHECKED: if the record is still wrong after we wrote it, that is a real problem and is logged as an error.
    const key = `${tenantId}:${live.phone ?? ""}`;
    if (!healReported.has(key)) console.warn(`[whatsapp] ${tenantId}: record said "${dbStatus ?? "no row"}" while the socket is connected; correcting it`);
    await setDbStatus(supabase, tenantId, { status: "connected", qr: null, ...(live.phone ? { phone_number: live.phone } : {}) }).catch(() => {});
    const { data: check, error: checkErr } = await supabase.from("whatsapp_sessions").select("status").eq("tenant_id", tenantId).maybeSingle();
    if (checkErr || (check as any)?.status !== "connected") {
      console.error(`[whatsapp] ${tenantId}: the connection record is STILL wrong after correcting it (${checkErr ? checkErr.message : `status ${(check as any)?.status ?? "no row"}`}). Check the whatsapp_sessions table and its permissions.`);
    } else if (!healReported.has(key)) {
      console.log(`[whatsapp] ${tenantId}: connection record corrected`);
    }
    healReported.add(key);
  }
  return true;
}

/** How the rest of the server sees a tenant's connection without touching Baileys. */
export function sessionStatus(tenantId: string): { status: string; qr: string | null; phone: string | null } {
  const s = sessions.get(tenantId);
  if (!s) return { status: inUseElsewhere(tenantId) ? "in_use_elsewhere" : "disconnected", qr: null, phone: null };
  return { status: s.status, qr: s.qr, phone: s.phone };
}

async function setDbStatus(
  supabase: SupabaseClient,
  tenantId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("whatsapp_sessions")
    .upsert({ tenant_id: tenantId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  // This used to swallow the error, so a write that never landed (a constraint, a paused or over-quota database)
  // looked like success and the record stayed wrong ("database said none") with nothing in the logs to say why.
  if (error) console.error(`[whatsapp] ${tenantId}: could not save the connection record (${JSON.stringify(patch.status ?? Object.keys(patch))}): ${error.message}`);
}

/** Open (or reopen) a tenant's WhatsApp connection. Returns immediately; the QR and connection
 *  state arrive asynchronously and are pushed to the dashboard as they change. Idempotent: a
 *  second call while one is connected is a no-op, while one is starting waits for nothing. */
export async function connect(
  supabase: SupabaseClient,
  tenantId: string,
  onUpdate?: (s: { status: string; qr: string | null; phone: string | null }) => void,
  force = false
): Promise<void> {
  if (!whatsappHostEnabled()) {
    if (!hostOffNoted) { hostOffNoted = true; console.warn(`[whatsapp] this process (${INSTANCE_INFO}) does not hold WhatsApp logins: only a Linux server does by default, so a copy on a developer machine cannot take the production connection. Set WHATSAPP_ENABLED=1 to turn it on here.`); }
    return;
  }
  const existing = sessions.get(tenantId);
  // A socket that is connected, still coming back, or waiting for a QR is ALIVE: a second one on the same login
  // would knock it off (WhatsApp allows one). Likewise while a reconnect is backing off.
  if (existing && (existing.starting || existing.status === "connected" || existing.status === "reconnecting" || existing.status === "pairing")) return;
  const r0 = retry.get(tenantId);
  if (!force && r0 && Date.now() < r0.notBefore) return;

  const placeholder: Session = { sock: undefined as any, status: "pairing", qr: null, phone: null, starting: true };
  sessions.set(tenantId, placeholder);
  const push = () => onUpdate?.(sessionStatus(tenantId));

  // Everything up to the socket existing can fail (the lease check, reading the saved login, makeWASocket). If it
  // does, the placeholder MUST go: left behind with starting=true it would make every later connect() return early
  // and the tenant would sit on "reconnecting" until the server restarts.
  let state: Awaited<ReturnType<typeof useSupabaseAuthState>>["state"], saveCreds: () => Promise<void>;
  try {
    // One process at a time. If another live process holds this login, wait quietly and look again soon.
    if (!(await claimLease(supabase, tenantId))) {
      sessions.delete(tenantId);
      console.warn(`[whatsapp] ${tenantId}: another process holds this login (lease); ${INSTANCE_ID} waits`);
      retry.set(tenantId, { attempt: retry.get(tenantId)?.attempt ?? 0, notBefore: Date.now() + WAIT_RETRY_MS });
      setTimeout(() => void connect(supabase, tenantId, onUpdate), WAIT_RETRY_MS);
      push();
      return;
    }
    startLeaseHeartbeat(supabase);
    ({ state, saveCreds } = await useSupabaseAuthState(supabase, tenantId));
  } catch (e: any) {
    if (sessions.get(tenantId) === placeholder) sessions.delete(tenantId);
    const attempt = (retry.get(tenantId)?.attempt ?? 0) + 1;
    const delay = reconnectDelayMs(attempt - 1, false);
    retry.set(tenantId, { attempt, notBefore: Date.now() + delay });
    console.error(`[whatsapp] ${tenantId}: could not start the connection (${e?.message}); retrying in ${Math.round(delay / 1000)}s`);
    setTimeout(() => void connect(supabase, tenantId, onUpdate), delay);
    throw e;
  }
  // A saved login means this number is ALREADY linked: we are coming back online, not pairing. The page
  // must not ask the user to scan again just because the server restarted or the socket blipped.
  placeholder.status = state.creds?.me ? "reconnecting" : "pairing";

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
    // Only the CURRENT socket speaks for this tenant. A late "close" from a socket that was already replaced
    // must not delete or rewrite the live one.
    if (!s || s !== placeholder) return;

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
      retry.delete(tenantId); // a good connection: the next drop starts the backoff from 3s again
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
      const action = closeAction(code);
      console.warn(`[whatsapp] ${tenantId} socket closed (code ${code ?? "none"}) -> ${action}`);

      if (action === "logged_out") {
        // The phone unlinked this device. The stored session is dead; wipe it so we do not
        // reconnect-loop, and the tenant must scan again to relink.
        s.status = "logged_out";
        s.qr = null;
        sessions.delete(tenantId);
        await clearAuthState(supabase, tenantId);
        await setDbStatus(supabase, tenantId, { status: "logged_out", qr: null });
        push();
      } else if (action === "banned") {
        // WhatsApp refused the account — the ban case. Do not retry; surface it so the tenant
        // sees a real reason rather than a spinner.
        s.status = "banned";
        sessions.delete(tenantId);
        await setDbStatus(supabase, tenantId, { status: "banned", qr: null });
        push();
      } else {
        // A transient drop (network, restart) or another process holding the same login. Reconnect with the saved
        // creds, a little slower each time, and never from two places at once (see connect()).
        const replaced = action === "replaced";
        const prev = retry.get(tenantId);
        const attempt = (prev?.attempt ?? 0) + (replaced ? 0 : 1);
        const delay = reconnectDelayMs(attempt - 1, replaced);
        retry.set(tenantId, { attempt, notBefore: Date.now() + delay });
        if (replaced) { heldElsewhere.set(tenantId, { until: Date.now() + delay }); console.error(`[whatsapp] ${tenantId}: this login is in use by ANOTHER process (connection replaced). This process is ${INSTANCE_ID}. Check that only one agent-server is running (an old Railway deploy, a second replica, or a copy on your own computer). Retrying in ${Math.round(delay / 60_000)} min.`); }
        await setDbStatus(supabase, tenantId, { status: "disconnected" }); // stays a "linked" row: phone_number is kept
        sessions.delete(tenantId);
        push();
        setTimeout(() => void connect(supabase, tenantId, onUpdate), delay);
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
    // Auto-reply only to LIVE messages ("notify"), never to the batch of old ones WhatsApp
    // replays as "append" on reconnect — otherwise every deploy would fire replies at old chats.
    const autoReply = m.type === "notify" ? await getWhatsappAutoReply(tenantId) : false;
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
      const m0 = msg.message;
      const text =
        (m0?.conversation ??
        m0?.extendedTextMessage?.text ??
        m0?.imageMessage?.caption ??
        m0?.videoMessage?.caption ??
        m0?.buttonsResponseMessage?.selectedDisplayText ??
        m0?.listResponseMessage?.title ??
        "") ||
        // Media with no caption used to be dropped without a trace: a customer who sent a voice
        // note (very common in India) got total silence and the owner never saw it. A placeholder
        // line is stored instead, so it shows in the inbox and the reply engine can answer it
        // honestly ("I can't play voice notes here — could you type it?") — see decide.ts.
        (m0?.audioMessage ? "[Voice message]" : "") ||
        (m0?.imageMessage ? "[Photo]" : "") ||
        (m0?.videoMessage ? "[Video]" : "") ||
        (m0?.documentMessage || m0?.documentWithCaptionMessage ? "[Document]" : "");
      if (!String(text).trim()) continue; // a reaction/sticker/receipt with no body — nothing to show
      const phone = jid.split("@")[0];
      const linked = await linkIncoming(supabase, tenantId, {
        phone,
        text: String(text),
        waMessageId: msg.key?.id ?? null,
      });

      // Auto-reply (opt-in, "Auto replies ON"): we do NOT send here. We SCHEDULE a reply (§28) with
      // a random human delay and a per-lead singletonKey, so a burst collapses into one answer and
      // the timing is human, not machine-instant — the property that keeps a linked number safe.
      // The worker (autoReply.ts) re-reads the thread, runs the safety gate, types, then sends.
      if (linked && autoReply) {
        void scheduleAutoReply({ tenantId, leadId: linked.leadId, phone });
      }
    }
  });

  // Delivery/read receipts for messages WE sent → move outreach_messages.status forward.
  sock.ev.on("messages.update", async (updates: any[]) => {
    for (const up of updates ?? []) {
      const status = up.update?.status;
      const id = up.key?.id;
      if (!id || status == null) continue;
      // Baileys status: 2=server ack (sent), 3=delivered, 4=read.
      // 0 = ERROR: WhatsApp's server refused the message ("received error in ack"). It is NOT sent, whatever the
      // single tick suggested, so say so instead of leaving it looking delivered-later.
      const mapped = status >= 4 ? "read" : status >= 3 ? "delivered" : status === 0 ? "failed" : null;
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

/** Show a "typing…" indicator to the recipient for `ms`, like a person composing a reply, then
 *  stop — used by the auto-reply worker so an AI answer doesn't appear instantly out of nowhere.
 *  Best effort: if we're not connected or presence fails, it just returns and the send proceeds. */
export async function simulateTyping(tenantId: string, phone: string, ms: number): Promise<void> {
  const s = sessions.get(tenantId);
  if (!s || s.status !== "connected" || !s.sock) return;
  const jid = `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
  try {
    await s.sock.sendPresenceUpdate("composing", jid);
    await new Promise((r) => setTimeout(r, Math.max(0, ms)));
    await s.sock.sendPresenceUpdate("paused", jid);
  } catch {
    /* presence is optional — never block the send that follows */
  }
}

/** Show or clear the "typing…" indicator. autoReply.ts turns it ON the moment it starts working on a reply, so the customer
 *  sees someone typing within a second — not only after the model has finished — and OFF if nothing is sent after all.
 *  Best effort: presence is cosmetic and must never block a send. */
export async function setPresence(tenantId: string, phone: string, state: "composing" | "paused"): Promise<void> {
  const s = sessions.get(tenantId);
  if (!s || s.status !== "connected" || !s.sock) return;
  try {
    await s.sock.sendPresenceUpdate(state, `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`);
  } catch { /* cosmetic */ }
}

/** Race a promise against a timeout so a hung Baileys call can never freeze a request forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`WhatsApp timed out ${label}. Try again in a moment.`)), ms)),
  ]);
}

/** Which of these numbers are on WhatsApp — the whole chat list's badges in ONE Baileys call
 *  (sock.onWhatsApp accepts many jids at once). Returns a map phone→true/false/null (null =
 *  couldn't tell / not connected). Matched back by significant-digit suffix because WhatsApp may
 *  return a normalised jid. */
export async function checkNumbers(tenantId: string, phones: string[]): Promise<Record<string, boolean | null>> {
  const out: Record<string, boolean | null> = {};
  const uniq = Array.from(new Set(phones.map((p) => String(p || "")).filter(Boolean)));
  const s = sessions.get(tenantId);
  if (!s || s.status !== "connected" || !s.sock || !uniq.length) {
    for (const p of uniq) out[p] = null;
    return out;
  }
  const sig = (x: string) => x.replace(/[^0-9]/g, "").replace(/^0+/, "");
  try {
    const jids = uniq.map((p) => `${p.replace(/[^0-9]/g, "")}@s.whatsapp.net`);
    const results = await withTimeout(s.sock.onWhatsApp(...jids), 15_000, "checking numbers");
    const found: { d: string; exists: boolean }[] = (results ?? []).map((r: any) => ({ d: sig(String(r?.jid ?? "").split("@")[0]), exists: !!r?.exists }));
    for (const p of uniq) {
      const d = sig(p);
      const hit = found.find((f) => f.d && (f.d.endsWith(d) || d.endsWith(f.d)));
      out[p] = hit ? hit.exists : false; // in the result set but not "exists" → not on WhatsApp
    }
  } catch {
    for (const p of uniq) out[p] = null;
  }
  return out;
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
      const target = info.jid ?? jid;
      // Try full-res, then the low-res preview — some contacts expose only the preview. Still null
      // for most cold leads: WhatsApp only shows a photo when their privacy allows it (Everyone,
      // or when they have us as a contact), which a stranger usually does not.
      for (const kind of ["image", "preview"] as const) {
        try {
          photo = (await withTimeout(s.sock.profilePictureUrl(target, kind), 8_000, "fetching the photo")) ?? null;
        } catch {
          photo = null;
        }
        if (photo) break;
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
  await setDbStatus(supabase, tenantId, { status: "disconnected", qr: null, phone_number: null, ...(leaseColumnsMissing ? {} : { owner: null, owner_seen_at: null }) });
}

/** Is this tenant's number linked (a login is saved)? Read from the database, because the in-memory map is
 *  empty after every restart. Linked = a phone number is on file and the link was not logged out / banned /
 *  unlinked by the user (unlinking clears phone_number). */
export async function linkedState(supabase: SupabaseClient, tenantId: string): Promise<{ linked: boolean; phone: string | null }> {
  const { data } = await supabase.from("whatsapp_sessions").select("status, phone_number").eq("tenant_id", tenantId).maybeSingle();
  const row = data as { status?: string; phone_number?: string | null } | null;
  const linked = !!row?.phone_number && row.status !== "logged_out" && row.status !== "banned";
  return { linked, phone: linked ? row!.phone_number ?? null : null };
}

/** On server boot, reopen connections for every LINKED tenant — not only the ones whose last status was
 *  "connected": a socket that was mid-reconnect when the server went down is stored as "disconnected" and
 *  was never brought back, which is what sent people to the QR screen again and again. */
export async function resumeConnected(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.from("whatsapp_sessions").select("tenant_id").not("phone_number", "is", null).in("status", ["connected", "disconnected", "pairing"]);
  for (const row of data ?? []) {
    connect(supabase, row.tenant_id as string).catch((e) =>
      console.error(`[whatsapp] resume failed for ${row.tenant_id}:`, e?.message)
    );
  }
}
