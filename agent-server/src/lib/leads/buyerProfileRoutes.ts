/** The buyer-profile HTTP surface (high-quality-leads plan, Phase 1). Mounted by index.ts behind
 *  the same x-agent-token gate as /jobs and /whatsapp.
 *
 *  Four routes, one object the dashboard screen talks to:
 *    GET    /buyer-profile/:tenantId          — what have we got, and is there a Site Brain to draft from
 *    POST   /buyer-profile/:tenantId/draft     — the LLM drafts buyer vs competitor segments from the Site Brain
 *    POST   /buyer-profile/:tenantId/save      — the client's edits (stays UNCONFIRMED)
 *    POST   /buyer-profile/:tenantId/confirm    — the client accepts it; lead generation may now run
 *
 *  The drafter and the LLM live on this server (completeJson → NVIDIA NIM), which is why the draft
 *  cannot happen in the Next.js app and is proxied here. Every write goes through saveProfile, so a
 *  buyer profile is versioned exactly like the rest of the Site Brain — nothing is edited in place,
 *  and a bad confirm can be rolled back from Settings → Site Brain history. */
import type { Express, Request, Response } from "express";
import { supabase } from "../../supabase.js";
import { env } from "../../env.js";
import { completeJson } from "../llm.js";
import { loadActiveProfile, saveProfile, buyerProfileReady, type SiteProfile } from "../siteProfile.js";
import { draftBuyerProfile, sanitizeBuyerProfile, describeBuyerProfile } from "./buyerProfile.js";

function authed(req: Request, res: Response): boolean {
  if (env.AGENT_SERVER_TOKEN) {
    if (req.get("x-agent-token") !== env.AGENT_SERVER_TOKEN) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return false;
    }
    return true;
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_OPEN_JOBS !== "1") {
    res.status(503).json({ ok: false, error: "Agent server is not configured: AGENT_SERVER_TOKEN missing" });
    return false;
  }
  return true;
}

/** Persist a changed buyer profile as a NEW Site Brain version, keeping everything else intact. */
async function persist(tenantId: string, profile: SiteProfile, buyerProfile: SiteProfile["buyer_profile"], createdBy: string, prevBuiltFrom: Record<string, unknown>) {
  const next: SiteProfile = { ...profile, buyer_profile: buyerProfile };
  return saveProfile(tenantId, next, {
    builtFrom: { ...prevBuiltFrom, buyer_profile_updated_at: new Date().toISOString() },
    createdBy,
  });
}

export function mountBuyerProfile(app: Express): void {
  /** Read the current buyer profile + whether there is a Site Brain to draft one from. */
  app.get("/buyer-profile/:tenantId", async (req, res) => {
    if (!authed(req, res)) return;
    try {
      const row = await loadActiveProfile(req.params.tenantId);
      res.json({
        ok: true,
        hasSiteBrain: !!row && !!(row.profile.what_they_do || row.profile.audience || row.profile.offerings.length),
        buyerProfile: row?.profile.buyer_profile ?? null,
        ready: buyerProfileReady(row?.profile ?? null),
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "read failed" });
    }
  });

  /** Draft from the Site Brain. Saves the draft as a new version (UNCONFIRMED) and returns it. */
  app.post("/buyer-profile/:tenantId/draft", async (req, res) => {
    if (!authed(req, res)) return;
    const { tenantId } = req.params;
    try {
      const row = await loadActiveProfile(tenantId);
      if (!row) return res.status(409).json({ ok: false, error: "Run the website analysis first — there is no Site Brain to draft a buyer profile from yet." });

      const result = await draftBuyerProfile(row.profile, (p) => completeJson(p));
      if (!result.ok) return res.status(422).json({ ok: false, error: result.reason });

      const saved = await persist(tenantId, row.profile, result.buyerProfile, "agent:buyer-profile", row.built_from);
      console.log(`[buyer-profile] drafted for ${tenantId}: ${describeBuyerProfile(result.buyerProfile)}`);
      res.json({ ok: true, buyerProfile: saved.profile.buyer_profile, warnings: result.warnings, version: saved.version });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "draft failed" });
    }
  });

  /** Save the client's edits. Any edit un-confirms the profile — a changed profile must be
   *  confirmed again before it drives lead generation. */
  app.post("/buyer-profile/:tenantId/save", async (req, res) => {
    if (!authed(req, res)) return;
    const { tenantId } = req.params;
    const { buyerProfile, userId } = req.body ?? {};
    if (!buyerProfile || typeof buyerProfile !== "object") {
      return res.status(400).json({ ok: false, error: "buyerProfile is required" });
    }
    try {
      const row = await loadActiveProfile(tenantId);
      if (!row) return res.status(409).json({ ok: false, error: "There is no Site Brain to attach a buyer profile to — run the website analysis first." });

      const clean = sanitizeBuyerProfile(buyerProfile); // stays UNCONFIRMED by construction
      const saved = await persist(tenantId, row.profile, clean, userId ? `user:${userId}` : "user:edit", row.built_from);
      res.json({ ok: true, buyerProfile: saved.profile.buyer_profile, version: saved.version });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "save failed" });
    }
  });

  /** Confirm the current (optionally edited) buyer profile. After this, buyerProfileReady is true
   *  and an AUTO lead run will search for these buyers. The client may send the latest edits in the
   *  same call so Confirm also saves them. */
  app.post("/buyer-profile/:tenantId/confirm", async (req, res) => {
    if (!authed(req, res)) return;
    const { tenantId } = req.params;
    const { userId, buyerProfile } = req.body ?? {};
    try {
      const row = await loadActiveProfile(tenantId);
      if (!row) return res.status(409).json({ ok: false, error: "There is no buyer profile to confirm yet." });

      // Confirm either the edits sent with this call, or whatever is already stored.
      const base = buyerProfile && typeof buyerProfile === "object" ? sanitizeBuyerProfile(buyerProfile) : row.profile.buyer_profile;
      if (!base || !base.buyer_segments.length) {
        return res.status(422).json({ ok: false, error: "There are no buyer segments to confirm — draft or add at least one first." });
      }
      const confirmed = {
        ...base,
        confirmed: true,
        confirmed_by: userId ? String(userId) : null,
        confirmed_at: new Date().toISOString(),
      };
      const saved = await persist(tenantId, row.profile, confirmed, userId ? `user:${userId}` : "user:confirm", row.built_from);
      res.json({ ok: true, buyerProfile: saved.profile.buyer_profile, ready: buyerProfileReady(saved.profile), version: saved.version });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "confirm failed" });
    }
  });
}
