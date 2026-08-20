import { NextRequest } from "next/server";
import "@/lib/dns-fix";

/** /api/chat — Mr Lxwa's reply. Build Guide Step 7: real NVIDIA NIM call.
 *
 * Uses stream:false (one fetch, wait for the full answer) then fakes the
 * word-by-word reveal client-side-style, from the server, via setTimeout —
 * same wire format the client already reads (plain text chunks).
 * A true token-by-token SSE relay was tried first but its per-chunk parsing
 * loop turned out to add 15-20s of overhead on this dev machine (NVIDIA
 * itself answers in ~6s non-streaming) — simpler and it's actually faster
 * end to end, so keeping it this way rather than re-adding that complexity. */

function systemPrompt(ctx: any): string {
  const mem = Object.fromEntries((ctx?.memory || []).map((m: any) => [m.k, m.v]));
  return `detailed thinking off

You are Mr Lxwa, running a small AI marketing team (Mr. Keyword, Mr. Writer, Mr. Story, Miss Social, Mr. SEO) inside the GrowthTeam AI (MrLxwa) dashboard. Reply in 1-2 short sentences, warm and confident. **Bold** is fine.

Account: ${ctx.tokens ?? "?"}/${ctx.tokensMax ?? "?"} tokens (${ctx.plan ?? "free"} plan) · ${ctx.awaiting ?? 0} awaiting approval · latest report: ${ctx.report ?? "nothing yet today"} · business: ${Object.entries(mem).map(([k, v]) => `${k}=${v}`).join(", ") || "not onboarded yet"}

You can only inform/explain right now, not take real actions yet — say so if asked. Never invent numbers not given above. Match the user's language (English or Hinglish).`;
}

async function askLightning(q: string, ctx: any): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing");

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      stream: false,
      messages: [
        { role: "system", content: systemPrompt(ctx) },
        { role: "user", content: q },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`NVIDIA NIM chat failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);

  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("NVIDIA NIM: no content in response");
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
    const text = await askLightning(q, ctx || {});
    return new Response(wordStream(text), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (e: any) {
    console.error("[chat] Lightning call failed, using fallback:", e.message);
    return new Response(wordStream(fallback(q, ctx || {})), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
