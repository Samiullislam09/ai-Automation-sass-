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

function systemPrompt(ctx: any, business: string | null): string {
  return `You are Mr Lxwa, running a small AI marketing team (Mr. Keyword, Mr. Writer, Mr. Story, Miss Social, Mr. SEO) inside the GrowthTeam AI (MrLxwa) dashboard. Reply in 1-2 short sentences, warm and confident. **Bold** is fine.

Account: ${ctx.tokens ?? "?"}/${ctx.tokensMax ?? "?"} tokens (${ctx.plan ?? "free"} plan) · ${ctx.awaiting ?? 0} awaiting approval · latest report: ${ctx.report ?? "nothing yet today"} · business: ${business ?? "not onboarded yet"}

You can only inform/explain right now, not take real actions yet — say so if asked. Never invent numbers not given above. Match the user's language (English or Hinglish).`;
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
      // The actual fix for the ~20-40s/truncation issues: a plain "detailed thinking off"
      // system-prompt hint is only a soft suggestion for this Nemotron hybrid-reasoning
      // model — it still burned huge, wildly variable amounts of reasoning_content even
      // with that hint. chat_template_kwargs.thinking:false is the real API-level switch
      // (per NVIDIA's Nemotron docs) — live-tested it drops reasoning_content to null and
      // replies consistently in ~1-2s regardless of prompt length/flavor text, vs 6-40s
      // and frequent finish_reason:length truncation before this. DO NOT remove this.
      chat_template_kwargs: { thinking: false },
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

  const business = await loadRealBusinessContext();

  // Cheap defense-in-depth on top of chat_template_kwargs.thinking:false above — costs
  // nothing on the (now common) happy path, catches the rare remaining transient failure.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await askLightning(q, ctx || {}, business);
      return new Response(wordStream(text), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    } catch (e: any) {
      console.error(`[chat] Lightning call failed (attempt ${attempt}/2):`, e.message);
    }
  }
  return new Response(wordStream(fallback(q, ctx || {})), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
