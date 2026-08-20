import { NextRequest } from "next/server";
import "@/lib/dns-fix";

/** /api/chat — streams Mr Lxwa's reply chunk-by-chunk (ChatGPT-style).
 *  Build Guide Step 7: real NVIDIA NIM (Nemotron 3.5 Lightning) call, streamed.
 *  Wire format to the client is unchanged (plain text chunks) — see components/kit.tsx. */

function systemPrompt(ctx: any): string {
  const mem = Object.fromEntries((ctx?.memory || []).map((m: any) => [m.k, m.v]));
  // "detailed thinking off" is a Nemotron-specific directive that cuts this reasoning
  // model's internal "thinking" tokens way down — without it, replies were taking
  // 18-25s in testing (vs ~8s with it) because the model reasons proportionally to
  // how much context/instruction it's given. Keep this prompt short for the same reason.
  return `detailed thinking off

You are Mr Lxwa, running a small AI marketing team (Mr. Keyword, Mr. Writer, Mr. Story, Miss Social, Mr. SEO) inside the GrowthTeam AI (MrLxwa) dashboard. Reply in 1-2 short sentences, warm and confident. **Bold** is fine.

Account: ${ctx.tokens ?? "?"}/${ctx.tokensMax ?? "?"} tokens (${ctx.plan ?? "free"} plan) · ${ctx.awaiting ?? 0} awaiting approval · latest report: ${ctx.report ?? "nothing yet today"} · business: ${Object.entries(mem).map(([k, v]) => `${k}=${v}`).join(", ") || "not onboarded yet"}

You can only inform/explain right now, not take real actions yet — say so if asked. Never invent numbers not given above. Match the user's language (English or Hinglish).`;
}

async function callLightning(q: string, ctx: any): Promise<ReadableStream<Uint8Array>> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing");

  const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt(ctx) },
        { role: "user", content: q },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    throw new Error(`NVIDIA NIM chat failed (${upstream.status}): ${await upstream.text().catch(() => "")}`);
  }

  // Re-frame NVIDIA's OpenAI-style SSE ("data: {...}\n\n" chunks) into the plain-text
  // stream the client already reads — no client change needed, only this adapter.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let sawReasoning = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the last (possibly partial) line for next time

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta;
          // Nemotron is a reasoning model — it can emit a `reasoning_content` field
          // before the real answer. Skip that; only stream the actual reply text.
          if (delta?.reasoning_content && !delta?.content) {
            sawReasoning = true;
            continue;
          }
          if (typeof delta?.content === "string" && delta.content) {
            controller.enqueue(encoder.encode(delta.content));
          }
        } catch {
          // ignore any non-JSON keep-alive lines
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

/** Canned fallback — only used if NVIDIA is unreachable/misconfigured, so the widget
 *  never just breaks. Also handles the client's silent "__hello__" auto-open message. */
function fallback(q: string, ctx: any): string {
  if (q === "__hello__") {
    return `Salam! 👋 I'm **Mr Lxwa**, running your team. Ask me about your **tokens**, **today's work**, your **team**, or say **"write an article"** and I'll explain exactly what happens.`;
  }
  return `I'm having trouble reaching my brain right now — try again in a moment. Meanwhile: you have **⚡${ctx.tokens ?? "?"}** tokens, and **${ctx.awaiting ?? 0}** item(s) await your approval.`;
}

export async function POST(req: NextRequest) {
  const { q, ctx } = await req.json();
  const encoder = new TextEncoder();

  // "__hello__" is a silent UI trigger (chat auto-opens with a greeting) — always instant/canned,
  // no need to spend a model call on a fixed message.
  if (q === "__hello__") {
    const text = fallback(q, ctx || {});
    const stream = new ReadableStream({
      async start(c) {
        for (const w of text.split(/(?<=\s)/)) { c.enqueue(encoder.encode(w)); await new Promise((r) => setTimeout(r, 24)); }
        c.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  try {
    const stream = await callLightning(q, ctx || {});
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (e: any) {
    console.error("[chat] Lightning call failed, using fallback:", e.message);
    const text = fallback(q, ctx || {});
    const stream = new ReadableStream({
      async start(c) {
        for (const w of text.split(/(?<=\s)/)) { c.enqueue(encoder.encode(w)); await new Promise((r) => setTimeout(r, 24)); }
        c.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
