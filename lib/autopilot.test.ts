/** Phase 3: the lead chain as one switch. Pure parts only (validation, what goes to the WhatsApp engine, the summary) plus the routing contract — no network, no database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPatch, whatsappPart, summariseAutopilot, AUTOPILOT_TOOLS, MANAGE_AUTOPILOT, runManageAutopilot } from "./autopilot";
import { shapeLeadStats } from "./chat-lead-tools";
import { planFromToolCall } from "./chat-brain-intent";
import { WRITE_TOOLS, isWriteTool } from "./chat-schedule-tools";
import { toolsFromRegistry } from "./chat-tools";

const ok = (raw: Record<string, unknown>) => { const r = cleanPatch(raw); assert.ok(!("error" in r), JSON.stringify(r)); return (r as any).patch; };
const bad = (raw: Record<string, unknown>) => { const r = cleanPatch(raw); assert.ok("error" in r, "expected a refusal"); return (r as any).error as string; };

test("cleanPatch keeps what is valid and refuses what is not, in plain words — it never turns a bad number into a different one", () => {
  assert.deepEqual(ok({ on: true }), { on: true });
  assert.deepEqual(ok({ leads_per_day: 20, run_time: "09:30", send_start: 10, send_end: 18, followups: false }), { leads_per_day: 20, run_time: "09:30", send_start: 10, send_end: 18, followups: false });
  assert.match(bad({ leads_per_day: 0 }), /1 to 50/);
  assert.match(bad({ leads_per_day: 51 }), /1 to 50/);
  assert.match(bad({ leads_per_day: 2.5 }), /whole number/);
  assert.match(bad({ run_time: "9am" }), /24-hour/);
  assert.match(bad({ send_start: 25 }), /0 to 23/);
  assert.match(bad({ send_start: 9, send_end: 9 }), /same hour/);
  assert.deepEqual(ok({ on: "yes" as any, bogus: 1 }), {}, "a non-boolean switch and unknown keys are ignored, not guessed");
});

test("the master switch sets the whole chain together; single settings touch only themselves", () => {
  assert.deepEqual(whatsappPart({ on: true }), { auto_reply: true, outbound_enabled: true, followups_enabled: true });
  assert.deepEqual(whatsappPart({ on: false }), { auto_reply: false, outbound_enabled: false, followups_enabled: false });
  assert.deepEqual(whatsappPart({ followups: false }), { followups_enabled: false });
  assert.deepEqual(whatsappPart({ reminders: false, daily_summary: true, send_start: 8, send_end: 20 }), { meeting_reminders: false, daily_summary: true, send_start: 8, send_end: 20 });
  assert.deepEqual(whatsappPart({ leads_per_day: 10, run_time: "09:00" }), {}, "lead discovery lives in `schedules`, not in the WhatsApp settings");
  assert.deepEqual(whatsappPart({ on: true, followups: false }), { auto_reply: true, outbound_enabled: true, followups_enabled: false }, "an explicit setting wins over the master switch");
});

test("summariseAutopilot says what the customer can change, and null — never a guess — for what could not be read", () => {
  const stats = shapeLeadStats([]);
  const none = summariseAutopilot({ stats });
  assert.equal(none.first_messages, null);
  assert.equal(none.auto_replies, null);
  assert.equal(none.lead_discovery.on, false);
  const full = summariseAutopilot({
    stats, leadSchedule: { enabled: true, time_of_day: "09:00", timezone: "Asia/Dubai", count: 15 },
    whatsapp: { connected: true, autoReply: true }, settings: { outbound_enabled: true, followups_enabled: false, send_start: 10, send_end: 18, meeting_reminders: true, daily_summary: false },
  });
  assert.deepEqual(full.lead_discovery, { on: true, per_day: 15, run_time: "09:00", timezone: "Asia/Dubai" });
  assert.equal(full.followups, false);
  assert.equal(full.sending_hours, "10:00 to 18:00");
  assert.equal(full.daily_summary, false);
});

test("manage_autopilot is a write tool the router can reach, and a write tool call is no longer collapsed into 'nothing ordered'", async () => {
  assert.ok(WRITE_TOOLS.some((t) => t.function.name === MANAGE_AUTOPILOT));
  assert.equal(isWriteTool(MANAGE_AUTOPILOT), true);
  assert.deepEqual(AUTOPILOT_TOOLS[0].function.parameters.required, []);
  const desc = AUTOPILOT_TOOLS[0].function.description;
  for (const w of ["autopilot on karo", "pause everything", "roz 20 leads dhundo", "activa el piloto automático"]) assert.ok(desc.includes(w), w);
  assert.match(desc, /lookup_autopilot/, "questions about its state stay lookups");
  assert.ok(toolsFromRegistry(null).some((t) => t.function.name === MANAGE_AUTOPILOT));
  // the latent bug: manage_* calls used to come out of planFromToolCall as "answer_question", so no setting was ever changed from the chat
  const plan = planFromToolCall(MANAGE_AUTOPILOT, { action: "turn_on" }, { message: "autopilot on karo", registry: null, tz: "UTC" });
  assert.equal(plan.action, MANAGE_AUTOPILOT);
  assert.deepEqual(plan.params, { action: "turn_on" });
  const sched = planFromToolCall("manage_schedule", { kind: "audit", enabled: true }, { message: "roz audit karo", registry: null, tz: "UTC" });
  assert.equal(sched.action, "manage_schedule");
});

test("the tool refuses an empty or invalid request without touching anything", async () => {
  const never: any = { from() { throw new Error("must not be reached"); } };
  const empty = await runManageAutopilot(never, "t", {});
  assert.equal(empty.ok, false);
  assert.match(empty.note!, /turn the autopilot on or off|which setting/);
  const badNum = await runManageAutopilot(never, "t", { action: "change", leads_per_day: 99 });
  assert.equal(badNum.ok, false);
  assert.match(badNum.note!, /1 to 50/);
});
