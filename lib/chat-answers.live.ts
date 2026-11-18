/** LIVE, READ-ONLY: the whole answer path for the client's real questions — real database, real tools, real model.
 *    npx tsx lib/chat-answers.live.ts <tenantId>
 *  Builds the same kind of prompt the chat route builds (platform knowledge + the tool result block + the question), asks the chat model, prints the reply. */
import { readFileSync } from "node:fs";
for (const f of ["agent-server/.env", ".env.local"]) {
  try { for (const l of readFileSync(f, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); } } catch { /* none */ }
}
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { runReadTool, toolResultBlock } = await import("./chat-data-tools");
  const { PLATFORM_KNOWLEDGE } = await import("./platform-knowledge");
  const { CHAT_MODEL, modelParams } = await import("./chat-model");
  const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const tenant = process.argv[2];
  const key = String(process.env.NVIDIA_API_KEYS_CHAT || process.env.NVIDIA_API_KEY).split(",")[0].trim();
  const CASES: [string, string, Record<string, unknown>][] = [
    ["Kiya tum hamare leads se bat kr sakte ho ?", "lookup_autopilot", {}],
    ["Is main se whatapp par kitne log ha", "lookup_lead_stats", {}],
    ["sainiul ki chat history ka summary do", "lookup_lead_conversation", { who: "sainiul" }],
    ["Apne abhi jo keyword nikala ha usko chat pe do", "lookup_keywords", {}],
  ];
  for (const [q, tool, args] of CASES) {
    const result = await runReadTool(tool, args, sb as any, tenant);
    const system = `You are MenCra, an AI marketing team's manager, chatting with the business owner.\n\n${PLATFORM_KNOWLEDGE}\n\nREPLY RULES: at most 3 short sentences unless a summary is asked; match the user's language (Hinglish for Hinglish); plain words; no headings.`;
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: CHAT_MODEL, max_tokens: 400, ...modelParams(CHAT_MODEL), messages: [{ role: "system", content: system }, { role: "system", content: toolResultBlock(result) }, { role: "user", content: q }] }),
    });
    const j: any = await res.json();
    console.log(`\nQ: ${q}   [${tool}]\nA: ${j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 200)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
