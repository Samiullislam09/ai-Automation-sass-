import { NextRequest } from "next/server";

/**
 * /api/chat — streams the reply chunk-by-chunk (ChatGPT-style).
 * TODO(backend): replace `brain()` with a call to NVIDIA NIM (Nemotron 3.5 Lightning):
 *   const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
 *     method:"POST", headers:{ Authorization:`Bearer ${process.env.NVIDIA_API_KEY}` },
 *     body: JSON.stringify({ model:"nvidia/nemotron-3.5-lightning", stream:true,
 *       messages:[{role:"system",content:systemPromptWith(ctx)},{role:"user",content:q}] })
 *   });
 *   ...then pipe r.body through. The client already consumes a stream — no client change needed.
 */
function brain(q: string, ctx: any): string {
  const l = q.toLowerCase();
  const mem = Object.fromEntries((ctx?.memory || []).map((m: any) => [m.k, m.v]));
  if (q === "__hello__") return `Salam! 👋 I'm **Boss AI**, running your team. Ask me about your **tokens**, **today's work**, your **team**, or say **"write an article"** and I'll explain exactly what happens.`;
  if (/token|credit|balance/.test(l)) return `You have **⚡${ctx.tokens} of ${ctx.tokensMax}** tokens on the **${ctx.plan}** plan. An article costs 10, a story 4, a post 1. They refill monthly — or upgrade from Billing in one tap.`;
  if (/report|today|kya kiya|what did/.test(l)) return ctx.report ? `Latest from today's report: *"${ctx.report}"* — the full day is in **Reports**. I write one every working day.` : `Nothing logged yet today — create something and I'll write tonight's report.`;
  if (/team|agent|kaun|who works/.test(l)) return `Your team: **Mr. Keyword** (research), **Mr. Writer** (articles), **Mr. Story** (visuals), **Miss Social** (distribution), **Mr. SEO** (site care) — and me, coordinating. **${ctx.awaiting || 0}** item(s) currently await your approval.`;
  if (/memory|know|about me|business/.test(l)) return `Here's what I know: you run **${mem["Business type"] || "a business"}** at **${mem["Website"] || "your site"}**, audience **${mem["Audience"] || "—"}**, tone **${mem["Brand tone"] || "—"}**. Edit anything in **Memory** — we all adjust instantly.`;
  if (/plan|price|upgrade|pay/.test(l)) return `**Free** = 10 tokens/mo (1 article). **Starter $5** = 120 (~10 articles). **Growth $15** = 400 + premium writing model. Billing page has one-tap upgrade — and you can cancel anytime.`;
  if (/article|write|likho|content/.test(l)) return `Ready when you are — Dashboard → **Full Article (⚡10)**. I'll have the top 10 ranking pages analyzed, build a blueprint, and **Mr. Writer** drafts it in your **${(mem["Brand tone"] || "brand").toLowerCase()}** tone. You approve before anything goes live.`;
  if (/hello|hi|salam|hey/.test(l)) return `Hello! Team is standing by. Want an article started, or a summary of where things stand?`;
  return `Got it. Right now I answer about tokens, team, reports, memory and plans — once connected to the live agent server I'll also **act** on requests ("pause the calendar", "rewrite that intro"). Try **"team status"**.`;
}

export async function POST(req: NextRequest) {
  const { q, ctx } = await req.json();
  const text = brain(q, ctx || {});
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      // stream word-by-word for the ChatGPT feel
      for (const w of text.split(/(?<=\s)/)) { c.enqueue(enc.encode(w)); await new Promise(r => setTimeout(r, 24)); }
      c.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
