/** The owner's evening summary — one WhatsApp, once a day, to the team numbers that have alerts on.
 *
 *  What an owner wants at 8 pm is not a dashboard to open; it is the answer to "what did the assistant do
 *  today, and what needs ME?":
 *    how many people wrote and how many were answered · how fast · who is hot · which calls are booked and
 *    which are tomorrow · who the assistant handed to a person · who asked to stop.
 *
 *  Sent per tenant at `summary_hour` local time (default 20:00), when auto-replies are on, `daily_summary` is on
 *  and at least one team number has alerts on. A day with nothing in it sends nothing: a "0, 0, 0" message at
 *  night teaches an owner to ignore the number.
 *
 *  ONCE A DAY. The local date is written to the tenant's settings BEFORE anything is built or sent, so a slow
 *  build, a restart or two sweeps overlapping cannot send it twice; a tenant whose WhatsApp is offline at the
 *  hour is simply retried by the next sweep, as long as it is still that day.
 *
 *  Rendering and "is it due?" are pure and unit-tested; gathering reads the database; `tickDailyDigests` is the
 *  sweep scheduler.ts calls. */
import { supabase } from "../../supabase.js";
import { env } from "../../env.js";
import { getWhatsappSettings, patchWhatsappSettings, type WhatsappSettings } from "../outreach/settings.js";
import { replySamples, speedStats, type MsgRow } from "./activity.js";
import { fmtSlot } from "./meeting.js";
import { brandName } from "./brand.js";
import { listAdmins, notifyAdmins } from "./team.js";
import { senderOnline } from "./session.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ── time ────────────────────────────────────────────────────────────────────────────────── */

/** "2026-11-14" — the tenant's own calendar date. */
export function localDate(nowMs: number, tzOffset: number): string {
  return new Date(nowMs + tzOffset * HOUR).toISOString().slice(0, 10);
}

/** When the tenant's local day began, as a UTC instant. */
export function localDayStartMs(nowMs: number, tzOffset: number): number {
  return Math.floor((nowMs + tzOffset * HOUR) / DAY) * DAY - tzOffset * HOUR;
}

/** Is today's summary due: enabled, the hour has come, and it has not gone out today. Pure. */
export function digestDue(s: Pick<WhatsappSettings, "auto_reply" | "daily_summary" | "summary_hour" | "summary_last_sent" | "tz_offset">, nowMs: number): boolean {
  if (!s.auto_reply || !s.daily_summary) return false;
  const local = new Date(nowMs + s.tz_offset * HOUR);
  if (local.getUTCHours() < s.summary_hour) return false;
  return s.summary_last_sent !== localDate(nowMs, s.tz_offset);
}

/* ── the numbers ─────────────────────────────────────────────────────────────────────────── */

export type DigestData = {
  received: number;
  customers: number;
  aiReplies: number;
  humanReplies: number;
  firstMessagesSent: number;
  liveSpeed: { samples: number; p50_s: number | null; fast_pct: number | null };
  firstReplies: number;
  hot: { name: string; why: string }[];
  meetingsBookedToday: number;
  upcoming: { name: string; when: string }[];
  needsYou: { name: string; reason: string }[];
  optOuts: number;
};

export const emptyDigest = (): DigestData => ({
  received: 0, customers: 0, aiReplies: 0, humanReplies: 0, firstMessagesSent: 0,
  liveSpeed: { samples: 0, p50_s: null, fast_pct: null }, firstReplies: 0,
  hot: [], meetingsBookedToday: 0, upcoming: [], needsYou: [], optOuts: 0,
});

const dur = (s: number | null) => (s == null ? "–" : s < 60 ? `${s}s` : `${Math.round(s / 60)} min`);
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

const STAGE_WHY: Record<string, string> = {
  ready_to_buy: "ready to buy",
  meeting_requested: "asked for a call",
  meeting_scheduled: "call booked",
  won: "became a client",
};
export const hotWhy = (stage: string) => STAGE_WHY[stage] ?? stage.replace(/_/g, " ");

/** The message. Sections with nothing in them are left out; returns null when the day was empty. */
export function renderDigest(d: DigestData, o: { brand: string; dayLabel: string; dashboardUrl?: string }): string | null {
  const quiet = !d.received && !d.aiReplies && !d.humanReplies && !d.firstMessagesSent && !d.hot.length && !d.meetingsBookedToday && !d.upcoming.length && !d.needsYou.length && !d.optOuts;
  if (quiet) return null;
  const lines: string[] = [`📊 Daily summary — ${o.brand} · ${o.dayLabel}`];

  if (d.received || d.aiReplies || d.humanReplies) {
    lines.push("", `💬 ${plural(d.received, "message")} received from ${plural(d.customers, "customer")}`);
    lines.push(`   Replied: ${d.aiReplies} by the assistant${d.humanReplies ? `, ${d.humanReplies} by you` : ""}`);
    if (d.liveSpeed.samples >= 3) lines.push(`   Reply speed: typically ${dur(d.liveSpeed.p50_s)}, ${d.liveSpeed.fast_pct}% within 30 s`);
    if (d.firstReplies) lines.push(`   ${plural(d.firstReplies, "new conversation")} started (first replies wait 1–5 min on purpose)`);
  }
  if (d.firstMessagesSent) lines.push("", `📤 ${plural(d.firstMessagesSent, "new lead")} contacted today`);
  if (d.hot.length) lines.push("", `🔥 Hot today`, ...d.hot.map((h) => `   • ${short(h.name, 40)} — ${h.why}`));
  if (d.meetingsBookedToday || d.upcoming.length) {
    lines.push("", `📅 Calls`);
    if (d.meetingsBookedToday) lines.push(`   ${plural(d.meetingsBookedToday, "call")} booked today`);
    for (const u of d.upcoming) lines.push(`   • Next 24 h: ${short(u.name, 36)} — ${u.when}`);
  }
  if (d.needsYou.length) lines.push("", `🙋 Needs you (${d.needsYou.length})`, ...d.needsYou.map((n) => `   • ${short(n.name, 36)} — ${short(n.reason, 70)}`));
  if (d.optOuts) lines.push("", `🚫 ${plural(d.optOuts, "person")} asked to stop (they will not be messaged again)`);
  if (o.dashboardUrl) lines.push("", `Open: ${o.dashboardUrl}`);
  return lines.join("\n");
}

/* ── gathering ───────────────────────────────────────────────────────────────────────────── */

const nameOf = (l: any) => l?.company || l?.name || l?.phone || l?.whatsapp || "A customer";

/** Read today's numbers. Every query is tolerant: a failure leaves that line out instead of losing the summary. */
export async function gatherDigest(tenantId: string, nowMs: number, tz: number): Promise<DigestData> {
  const d = emptyDigest();
  const dayStart = localDayStartMs(nowMs, tz);
  const iso = (ms: number) => new Date(ms).toISOString();

  // Messages: two days back, so a message's first-reply-or-live classification has its history.
  try {
    const { data } = await supabase.from("outreach_messages").select("lead_id, direction, answered_by, created_at").eq("tenant_id", tenantId).gte("created_at", iso(nowMs - 2 * DAY)).order("created_at", { ascending: false }).limit(3000);
    const rows = (data ?? []) as MsgRow[];
    const today = rows.filter((r) => Date.parse(r.created_at) >= dayStart);
    d.received = today.filter((r) => r.direction === "in").length;
    d.customers = new Set(today.filter((r) => r.direction === "in" && r.lead_id).map((r) => r.lead_id)).size;
    d.aiReplies = today.filter((r) => r.direction === "out" && r.answered_by === "brain").length;
    d.humanReplies = today.filter((r) => r.direction === "out" && r.answered_by !== "brain").length;
    const samples = replySamples(rows).filter((x) => x.by === "brain" && x.at >= dayStart);
    const live = speedStats(samples.filter((x) => !x.opening).map((x) => x.seconds));
    d.liveSpeed = { samples: live.samples, p50_s: live.p50_s, fast_pct: live.fast_pct };
    d.firstReplies = samples.filter((x) => x.opening).length;
  } catch { /* leave the message numbers at zero */ }

  try {
    const { count } = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("contacted_at", iso(dayStart));
    d.firstMessagesSent = count ?? 0;
  } catch { /* ignore */ }

  try {
    const { data } = await supabase.from("leads").select("company, name, phone, whatsapp, stage").eq("tenant_id", tenantId).in("stage", Object.keys(STAGE_WHY)).gte("updated_at", iso(dayStart)).order("updated_at", { ascending: false }).limit(5);
    d.hot = ((data ?? []) as any[]).map((l) => ({ name: nameOf(l), why: hotWhy(String(l.stage)) }));
  } catch { /* ignore */ }

  try {
    const { data } = await supabase.from("leads").select("company, name, phone, whatsapp, needs_attention_reason").eq("tenant_id", tenantId).eq("needs_attention", true).eq("opt_out", false).order("updated_at", { ascending: false }).limit(5);
    d.needsYou = ((data ?? []) as any[]).map((l) => ({ name: nameOf(l), reason: l.needs_attention_reason || "needs a person" }));
  } catch { /* ignore */ }

  try {
    const { count } = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("opt_out_at", iso(dayStart));
    d.optOuts = count ?? 0;
  } catch { /* ignore */ }

  try {
    const { data } = await supabase.from("lead_meetings").select("*").eq("tenant_id", tenantId).eq("status", "scheduled").gte("updated_at", iso(nowMs - 3 * DAY)).limit(200);
    const mets = (data ?? []) as any[];
    d.meetingsBookedToday = mets.filter((m) => Date.parse(String(m.reminders?.booked_at ?? "")) >= dayStart).length;
    const next = mets.filter((m) => m.start_at && Date.parse(m.start_at) >= nowMs && Date.parse(m.start_at) <= nowMs + DAY).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)).slice(0, 5);
    if (next.length) {
      const { data: ls } = await supabase.from("leads").select("id, company, name, phone, whatsapp").eq("tenant_id", tenantId).in("id", next.map((m) => m.lead_id));
      const byId = new Map(((ls ?? []) as any[]).map((l) => [l.id, l]));
      d.upcoming = next.map((m) => ({ name: nameOf(byId.get(m.lead_id)), when: fmtSlot(m.start_at, tz) }));
    }
  } catch { /* ignore */ }

  return d;
}

/* ── the sweep ───────────────────────────────────────────────────────────────────────────── */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(nowMs: number, tz: number): string {
  const d = new Date(nowMs + tz * HOUR);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Send the summary to every tenant for which it is due. Returns how many went out. Never throws. */
export async function tickDailyDigests(now: Date = new Date()): Promise<number> {
  const nowMs = now.getTime();
  let tenantIds: string[] = [];
  try {
    const { data } = await supabase.from("agent_settings").select("tenant_id, settings").eq("agent", "whatsapp");
    tenantIds = ((data ?? []) as any[]).filter((r) => r?.settings?.auto_reply === true && r?.settings?.daily_summary !== false).map((r) => r.tenant_id);
  } catch (e: any) {
    console.error("[digest] could not list tenants:", e?.message);
    return 0;
  }

  let sent = 0;
  for (const tenantId of tenantIds) {
    try {
      const s = await getWhatsappSettings(tenantId);
      if (!digestDue(s, nowMs)) continue;
      const admins = (await listAdmins(tenantId)).filter((a) => a.notify);
      if (!admins.length) continue; // nobody to tell; retried the moment someone is added, if it is still today

      const { data: session } = await supabase.from("whatsapp_sessions").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (!(await senderOnline(supabase, tenantId, (session as any)?.status))) continue; // retried on the next sweep

      // Claim the day BEFORE building or sending: two sweeps, a slow build or a restart must not send it twice.
      await patchWhatsappSettings(tenantId, { summary_last_sent: localDate(nowMs, s.tz_offset) });

      const data = await gatherDigest(tenantId, nowMs, s.tz_offset);
      const { data: tenant } = await supabase.from("tenants").select("name, website_url").eq("id", tenantId).maybeSingle();
      const text = renderDigest(data, {
        brand: brandName(tenant as any),
        dayLabel: dayLabel(nowMs, s.tz_offset),
        dashboardUrl: env.WEB_APP_URL ? `${env.WEB_APP_URL.replace(/\/+$/, "")}/dashboard/whatsapp` : undefined,
      });
      if (!text) continue; // a day with nothing in it sends nothing
      await notifyAdmins(tenantId, { type: "system", title: "📊 Your daily WhatsApp summary", body: text, whatsappText: text });
      sent++;
    } catch (e: any) {
      console.error(`[digest] tenant ${tenantId} failed:`, e?.message);
    }
  }
  return sent;
}
