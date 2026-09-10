import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openFastCompletion } from "@/lib/ai/fastChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One sentence of live progress narration, genuinely written by the model — not a template
 *  (owner 2026-09-09: "ye AI he answer dega ... jaisa jaisa work progress ho"). Called once per
 *  step the client hasn't narrated yet (components/MrLxwaDashboard.tsx's `narratedStepIds`),
 *  so this is a REAL extra call per step, on purpose — the owner chose this over the free,
 *  template-based option when asked directly about the added cost/latency.
 *
 *  Deliberately the FAST provider only (lib/ai/fastChat.ts's Groq/Cerebras chain), no NIM
 *  fallback: this is decorative narration, not the order itself, so a slow/unavailable provider
 *  should mean "say nothing this time," never "make the customer wait." Auth-gated (not the
 *  brain's own token) purely so this can't be hit by anyone outside a real signed-in session —
 *  it names no tenant data beyond what the caller already sends it. */

const SYSTEM_PROMPT = [
  "You are Mr. Lxwa, narrating your AI marketing team's live progress to a small business owner.",
  "One teammate just finished a step of a task in progress.",
  "LANGUAGE RULE (mandatory): reply in the SAME language and script as the customer's own message",
  "given below. If they wrote in English, reply in plain professional English. If they wrote in",
  "Hinglish / Roman Hindi / Roman Urdu, reply in Hinglish. Never switch languages on them.",
  "HONESTY RULE (mandatory): if you are told the step produced NOTHING, say so plainly — do not",
  "claim success, do not say a list was 'finalized' or 'ready', and do not celebrate. A step that",
  "found zero results is disappointing, not good news, and the customer must hear that clearly.",
  "Write ONE short sentence — third person about the teammate (e.g. 'Mr. Keyword...'), never a",
  "bare status word, never a bullet point, never quotes around it, never more than one sentence.",
  "If a subject/topic is given, mention it naturally. Just the sentence, nothing else.",
].join(" ");

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const agentName = typeof body?.agentName === "string" ? body.agentName.trim().slice(0, 60) : "";
  const stepLabel = typeof body?.stepLabel === "string" ? body.stepLabel.trim().slice(0, 200) : "";
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 200) : "";
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 300) : "";
  // Whether this step actually produced anything — without this the model had no way to know a
  // "finished" step came back empty, and cheerfully announced a keyword list that did not exist
  // (owner report 2026-09-10, live: "Mr. Keyword ne aaj keywords ki list finalize kar li hai" for
  // a run that produced zero keywords). `null` (the field omitted) means "not applicable/unknown"
  // — some steps (writing, publishing) don't have a meaningful item count, and the honesty rule
  // only applies when the caller actually knows the count was zero.
  const producedCount = typeof body?.producedCount === "number" ? body.producedCount : null;
  if (!agentName || !stepLabel) {
    return NextResponse.json({ ok: false, error: "agentName and stepLabel are required." }, { status: 400 });
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `${agentName} just finished: ${stepLabel}.`,
        subject ? `Subject: "${subject}".` : "",
        producedCount === 0 ? "IMPORTANT: this step found/produced NOTHING — zero results. Say so honestly." : "",
        message ? `\nThe customer's own latest message, to match language against:\n${message}` : "",
      ].filter(Boolean).join(" "),
    },
  ];

  const result = await openFastCompletion(
    { temperature: 0.6, max_tokens: 60, messages },
    { signal: AbortSignal.timeout(5000) }
  ).catch(() => null);

  const text = String(result?.data?.choices?.[0]?.message?.content ?? "").trim();
  // No provider configured/reachable, or an empty answer — say nothing this time, per the
  // header's own rule. A 200 with ok:false (not a 5xx) so the client treats it as "skip
  // quietly," not an error to retry or surface.
  if (!text) return NextResponse.json({ ok: false, error: "Narration unavailable." });

  return NextResponse.json({ ok: true, text });
}
