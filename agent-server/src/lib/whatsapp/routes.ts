/** The WhatsApp HTTP surface: pair, status, send, unpair. Mounted by index.ts behind the same
 *  x-agent-token gate that guards /jobs, because every one of these acts on a tenant's live
 *  WhatsApp and none of it should be reachable with just the URL.
 *
 *  THE SEND ROUTE IS THE ONLY SENDER. POST /whatsapp/send is the single caller of
 *  session.sendText — a message leaves this server because an authenticated request arrived,
 *  which the dashboard makes when a human clicks Send. There is no queue, no worker, no timer
 *  behind it. That is the property that keeps this a human-driven inbox rather than an automated
 *  outreach machine, and it lives here as one obvious route rather than as a rule to remember. */
import type { Express, Request, Response } from "express";
import { supabase } from "../../supabase.js";
import { env } from "../../env.js";
import { connect, disconnect, sendText, sessionStatus, getContactInfo, checkNumbers } from "./session.js";
import { getWhatsappAutoReply, setWhatsappAutoReply, getWhatsappSettings, patchWhatsappSettings } from "../outreach/settings.js";
import { recordOutgoing } from "./store.js";
import { suggestReply } from "./suggest.js";
import { emitWhatsapp } from "../../socket.js";

function authed(req: Request, res: Response): boolean {
  // Same gate as /jobs. In production an unset token is a closed door, not a warning.
  if (env.AGENT_SERVER_TOKEN) {
    if (req.get("x-agent-token") !== env.AGENT_SERVER_TOKEN) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_OPEN_JOBS !== "1") {
    res.status(503).json({ error: "Agent server is not configured: AGENT_SERVER_TOKEN missing" });
    return false;
  }
  return true;
}

export function mountWhatsapp(app: Express): void {
  /** Start pairing (or reconnect). Returns the current status; the QR arrives over the socket
   *  as `whatsapp:status` events, so the dashboard shows it live without polling. */
  app.post("/whatsapp/:tenantId/connect", async (req, res) => {
    if (!authed(req, res)) return;
    const { tenantId } = req.params;
    try {
      await connect(supabase, tenantId, (s) => emitWhatsapp(tenantId, s));
      res.json({ ok: true, ...sessionStatus(tenantId) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "connect failed" });
    }
  });

  /** Current connection status + the QR if one is pending. Polled once by the UI on open; live
   *  updates come over the socket. */
  app.get("/whatsapp/:tenantId/status", async (req, res) => {
    if (!authed(req, res)) return;
    const autoReply = await getWhatsappAutoReply(req.params.tenantId).catch(() => false);
    res.json({ ok: true, ...sessionStatus(req.params.tenantId), autoReply });
  });

  /** Turn WhatsApp auto-reply on/off for this tenant. */
  app.post("/whatsapp/:tenantId/auto-reply", async (req, res) => {
    if (!authed(req, res)) return;
    try {
      await setWhatsappAutoReply(req.params.tenantId, req.body?.on === true);
      res.json({ ok: true, autoReply: req.body?.on === true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "could not update" });
    }
  });

  /** Read all WhatsApp engine settings (auto-reply master + outbound timeline knobs + quiet hours). */
  app.get("/whatsapp/:tenantId/settings", async (req, res) => {
    if (!authed(req, res)) return;
    try {
      const settings = await getWhatsappSettings(req.params.tenantId);
      res.json({ ok: true, settings });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "could not read settings" });
    }
  });

  /** Update WhatsApp engine settings. Body is a partial WhatsappSettings; returns the merged result. */
  app.post("/whatsapp/:tenantId/settings", async (req, res) => {
    if (!authed(req, res)) return;
    try {
      const settings = await patchWhatsappSettings(req.params.tenantId, req.body ?? {});
      res.json({ ok: true, settings });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "could not update settings" });
    }
  });

  /** The outbound timeline: pending/upcoming cold first-messages for this tenant, soonest first,
   *  with the lead's name — read-only view for the Outbox. A POST with {action:'cancel', id} drops
   *  one lead off the timeline. */
  app.get("/whatsapp/:tenantId/outbox", async (req, res) => {
    if (!authed(req, res)) return;
    const { tenantId } = req.params;
    try {
      const { data: rows } = await supabase
        .from("wa_outbound_queue")
        .select("id, lead_id, scheduled_at, status, reason")
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "sending"])
        .order("scheduled_at", { ascending: true })
        .limit(200);
      const leadIds = [...new Set((rows ?? []).map((r: any) => r.lead_id))];
      const names = new Map<string, string>();
      if (leadIds.length) {
        const { data: leads } = await supabase.from("leads").select("id, company, name, whatsapp, phone").eq("tenant_id", tenantId).in("id", leadIds);
        for (const l of (leads ?? []) as any[]) names.set(l.id, l.company || l.name || l.whatsapp || l.phone || "Lead");
      }
      const items = (rows ?? []).map((r: any) => ({ id: r.id, leadId: r.lead_id, name: names.get(r.lead_id) ?? "Lead", scheduledAt: r.scheduled_at, status: r.status }));
      res.json({ ok: true, items, pending: items.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "could not read outbox" });
    }
  });

  app.post("/whatsapp/:tenantId/outbox", async (req, res) => {
    if (!authed(req, res)) return;
    const { tenantId } = req.params;
    const { action, id } = req.body ?? {};
    if (action !== "cancel" || !id) return res.status(400).json({ ok: false, error: "action:'cancel' and id are required" });
    try {
      await supabase.from("wa_outbound_queue").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", String(id)).eq("tenant_id", tenantId).in("status", ["pending", "sending"]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "could not cancel" });
    }
  });

  /** Whether a number (?phone=) is on WhatsApp, plus its photo — one call the chat uses on open.
   *  Read-only; never fails the UI (unknowns come back as null). */
  app.get("/whatsapp/:tenantId/avatar", async (req, res) => {
    if (!authed(req, res)) return;
    const phone = String(req.query.phone ?? "");
    if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
    try {
      const { onWhatsapp, photo } = await getContactInfo(req.params.tenantId, phone);
      res.json({ ok: true, url: photo, onWhatsapp });
    } catch {
      res.json({ ok: true, url: null, onWhatsapp: null });
    }
  });

  /** Which of a batch of numbers are on WhatsApp — one call for the whole chat list's badges. */
  app.post("/whatsapp/:tenantId/check", async (req, res) => {
    if (!authed(req, res)) return;
    const phones = Array.isArray(req.body?.phones) ? req.body.phones.map((p: any) => String(p)) : [];
    try {
      const results = await checkNumbers(req.params.tenantId, phones);
      res.json({ ok: true, results });
    } catch {
      res.json({ ok: true, results: {} });
    }
  });

  /** SEND ONE MESSAGE — the human pressed Send. Requires the lead id (so the message is stored
   *  against the right CRM row), the phone, and the text. answered_by lets the UI say whether the
   *  human wrote it or accepted Mr. Brain's draft; either way a human sent it. */
  app.post("/whatsapp/:tenantId/send", async (req, res) => {
    if (!authed(req, res)) return;
    const { tenantId } = req.params;
    const { leadId, phone, body, answeredBy } = req.body ?? {};
    if (!leadId || !phone || !String(body ?? "").trim()) {
      return res.status(400).json({ ok: false, error: "leadId, phone and a non-empty body are required" });
    }
    try {
      // opt_out is checked HERE, immediately before sending, not only when a lead was queued —
      // someone marked do-not-contact a moment ago must not still receive a message in flight.
      const { data: lead } = await supabase
        .from("leads")
        .select("opt_out")
        .eq("id", leadId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (lead?.opt_out) {
        return res.status(409).json({ ok: false, error: "This lead has opted out — nothing was sent." });
      }

      const { waMessageId } = await sendText(tenantId, String(phone), String(body));
      await recordOutgoing(
        supabase,
        tenantId,
        String(leadId),
        String(body),
        waMessageId,
        answeredBy === "brain" ? "brain" : "human"
      );
      res.json({ ok: true, waMessageId });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "send failed" });
    }
  });

  /** Draft a reply for a conversation — Mr. Brain reads the thread and suggests the next
   *  message. Returns TEXT; it does not send. The UI drops it into the compose box. A read, so
   *  the same token gate is enough; there is nothing irreversible here. */
  app.post("/whatsapp/:tenantId/suggest", async (req, res) => {
    if (!authed(req, res)) return;
    const { tenantId } = req.params;
    const { leadId } = req.body ?? {};
    if (!leadId) return res.status(400).json({ ok: false, error: "leadId is required" });
    try {
      const { reply } = await suggestReply(supabase, tenantId, String(leadId));
      res.json({ ok: true, reply });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "suggest failed" });
    }
  });

  /** Unlink this workspace's WhatsApp. The tenant's phone keeps its own copy; this ends our link
   *  and forgets the stored session. */
  app.post("/whatsapp/:tenantId/disconnect", async (req, res) => {
    if (!authed(req, res)) return;
    try {
      await disconnect(supabase, req.params.tenantId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "disconnect failed" });
    }
  });
}
