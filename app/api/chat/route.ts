import { NextRequest } from "next/server";
import "@/lib/dns-fix";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** /api/chat — Mr Lxwa's reply. Build Guide Step 7: real NVIDIA NIM call.
 *
 * Uses stream:false (one fetch, wait for the full answer) then fakes the
 * word-by-word reveal client-side-style, from the server, via setTimeout —
 * same wire format the client already reads (plain text chunks).
 * A true token-by-token SSE relay was tried first but its per-chunk parsing
 * loop turned out to add 15-20s of overhead on this dev machine (NVIDIA
 * itself answers in ~6s non-streaming) — simpler and it's actually faster
 * end to end, so keeping it this way rather than re-adding that complexity. */

/** Real, DB-backed business facts — same source as /api/dashboard/status. The client's
 *  ctx.memory (from lib/store.tsx) is only ever populated once, in-memory, during the
 *  onboarding wizard — it's never persisted, so on every fresh login/page load it's back
 *  to [] and Mr Lxwa had nothing real to answer "what do you know about my business?"
 *  with. This queries the tenant's actual saved profile + crawled site data instead. */
async function loadRealBusinessContext(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const tenantId = await getCurrentTenantId(supabase);
    if (!tenantId) return null;

    const [{ data: tenant }, { data: samplePages }] = await Promise.all([
      supabase.from("tenants").select("website_url, niche, tone_profile, icp_profile, onboarded").eq("id", tenantId).single(),
      supabase.from("site_pages").select("title").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(6),
    ]);
    if (!tenant || !tenant.onboarded) return null;

    const tone = (tenant.tone_profile as any) ?? {};
    const icp = (tenant.icp_profile as any) ?? {};
    const facts: string[] = [];
    if (tenant.website_url) facts.push(`website=${tenant.website_url}`);
    if (tenant.niche) facts.push(`niche=${tenant.niche}`);
    if (icp.businessType) facts.push(`business type=${icp.businessType}`);
    if (tone.audience) facts.push(`audience=${tone.audience}`);
    if (tone.tone) facts.push(`brand tone=${tone.tone}`);
    if (tone.pace) facts.push(`publishing pace=${tone.pace}`);
    if (Array.isArray(tone.topics) && tone.topics.length) facts.push(`content topics=${tone.topics.join(", ")}`);
    if (samplePages?.length) facts.push(`recently read pages=${samplePages.map((p) => p.title).join(", ")}`);

    return facts.length ? facts.join(" · ") : null;
  } catch (e: any) {
    console.error("[chat] failed to load real tenant context:", e.message);
    return null;
  }
}

// Kept deliberately terse. Live-tested: the flavorful version (naming all 5 teammates,
// "running a team inside the dashboard", extra constraint sentences) made this reasoning
// model spend WAY more of its reasoning budget just processing the persona/instructions
// before ever answering — same "hi" query went from 1.3s clean to 7-30s and often got cut
// off mid-reasoning (finish_reason: length) with the elaborate prompt, vs consistently
// clean 7-14s with this version. Every sentence here costs real latency — don't add flavor
// text back without re-testing timing, not just checking the reply still reads fine.
function systemPrompt(ctx: any, business: string | null): string {
  return `detailed thinking off

You are Mr Lxwa, an AI marketing assistant for a small business dashboard. Reply in 1-2 short sentences, warm tone. **Bold** ok. Match the user's language (Hinglish or English). Do not invent facts not given below.

Business: ${business ?? "not onboarded yet"}
Account: ${ctx.tokens ?? "?"}/${ctx.tokensMax ?? "?"} tokens (${ctx.plan ?? "free"} plan) · ${ctx.awaiting ?? 0} awaiting approval · report: ${ctx.report ?? "nothing yet today"}`;
}

async function askLightning(q: string, ctx: any, business: string | null): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing");

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      stream: false,
      // A tight cap (tried 350) backfires: this model writes reasoning_content BEFORE
      // content, and when max_tokens cuts it off mid-reasoning, the API dumps that
      // unfinished reasoning text into `content` too (confirmed live — got a raw,
      // truncated "Here's a thinking process: ..." shown to the user instead of an
      // answer). 1024 gives real prompts enough room to finish reasoning and still emit
      // a clean final answer; the finish_reason check below is the actual safety net for
      // the rare cases that still run long, not this number.
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt(ctx, business) },
        { role: "user", content: q },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`NVIDIA NIM chat failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);

  const data = await res.json();
  const choice = data?.choices?.[0];
  const text: string | undefined = choice?.message?.content;
  if (!text) throw new Error("NVIDIA NIM: no content in response");
  // finish_reason "length" means generation got cut off — for this reasoning model that
  // means `content` is unfinished reasoning narrative, not a real answer. Treat as a
  // failure (caller falls back to the canned reply) rather than showing it to the user.
  if (choice?.finish_reason === "length") throw new Error("NVIDIA NIM: response truncated mid-reasoning (finish_reason=length)");
  return text;
}

/** Canned fallback — only used if NVIDIA is unreachable/misconfigured, so the widget
 *  never just breaks. Also handles the client's silent "__hello__" auto-open message. */
function fallback(q: string, ctx: any): string {
  if (q === "__hello__") {
    return `Salam! 👋 I'm **Mr Lxwa**, running your team. Ask me about your **tokens**, **today's work**, your **team**, or say **"write an article"** and I'll explain exactly what happens.`;
  }
  return `I'm having trouble reaching my brain right now — try again in a moment. Meanwhile: **${ctx.awaiting ?? 0}** item(s) await your approval.`;
}

function wordStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(c) {
      for (const w of text.split(/(?<=\s)/)) { c.enqueue(encoder.encode(w)); await new Promise((r) => setTimeout(r, 22)); }
      c.close();
    },
  });
}

export async function POST(req: NextRequest) {
  const { q, ctx } = await req.json();

  // "__hello__" is a silent UI trigger (chat auto-opens with a greeting) — always instant/canned,
  // no need to spend a model call on a fixed message.
  if (q === "__hello__") {
    return new Response(wordStream(fallback(q, ctx || {})), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  try {
    const business = await loadRealBusinessContext();
    const text = await askLightning(q, ctx || {}, business);
    return new Response(wordStream(text), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (e: any) {
    console.error("[chat] Lightning call failed, using fallback:", e.message);
    return new Response(wordStream(fallback(q, ctx || {})), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
