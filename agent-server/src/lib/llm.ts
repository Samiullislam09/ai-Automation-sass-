import { nvidiaFetch } from "./nvidia.js";

/** Ported from the main app's lib/ai/llm.ts, for the crawler's niche/topics summary.
 *  Includes chat_template_kwargs.thinking:false (the main app's lib didn't have this yet
 *  when this was ported) — see app/api/chat/route.ts's comment for why: without it this
 *  Nemotron model burns wildly variable, sometimes very large amounts of reasoning tokens
 *  even for a "reply with only JSON" instruction, live-tested to matter a lot for latency. */
export async function completeJson<T = any>(prompt: string): Promise<T> {
  const res = await nvidiaFetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    label: "llm",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      chat_template_kwargs: { thinking: false },
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`NVIDIA NIM chat completion failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);

  const data: any = await res.json();
  const raw: string | undefined = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("NVIDIA NIM: unexpected response shape (no text)");

  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return parseModelJson<T>(cleaned);
}

/** Every `completeJson` caller (boss.ts, keyword.ts, crawler.ts, social.ts, analyst.ts,
 *  keywordFallback.ts, leads.ts) asks the model for "ONLY JSON", and models routinely still put
 *  a real, unescaped newline — or tab, or other raw control character — inside a string value
 *  instead of the `\n` JSON actually requires. A plain `JSON.parse` on that throws `SyntaxError:
 *  Bad control character in string literal in JSON at position N`, uncaught, straight past every
 *  caller here — reproduced live 2026-09-04: it landed, word for word, in a task's own `reason`
 *  field where a customer read it instead of any answer.
 *
 *  Raw control characters (0x00-0x1F) can never legally sit inside a JSON string, so escaping
 *  the ones a model plausibly meant (\n, \r, \t) is always a safe repair, never a guess at
 *  content — nothing here invents or drops meaningful text, it only fixes punctuation the model
 *  already implied. Only escapes them WHILE INSIDE A STRING (tracked by quote/backslash state)
 *  so real structural whitespace between tokens — a pretty-printed reply's own newlines outside
 *  any string — is left alone; escaping those too would turn valid JSON into a stray backslash
 *  where whitespace used to be. Falls back to dropping a control character with no sane escape
 *  (a literal NUL, say). Only once repair also fails does this throw — with the model's own
 *  text attached (truncated), never a bare parser error a customer cannot act on. */
export function parseModelJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    try {
      return JSON.parse(escapeControlCharsInStrings(raw)) as T;
    } catch {
      throw new Error(`NVIDIA NIM: model did not return valid JSON: ${raw.slice(0, 200)}`);
    }
  }
}

export function escapeControlCharsInStrings(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
    } else if (ch === "\\") {
      out += ch;
      escaped = true;
    } else if (ch === '"') {
      out += ch;
      inString = false;
    } else if (ch.charCodeAt(0) < 0x20) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      // else: no sane escape for this one — drop it rather than guess.
    } else {
      out += ch;
    }
  }
  return out;
}
