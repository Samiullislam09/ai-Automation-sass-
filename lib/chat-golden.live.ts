/** LIVE golden run for the manager chat — the real model, the real prompt, fixed fixtures (never the production database). A gate to run BY HAND before a deploy that
 *  touches the chat, its tools or its prompt:
 *
 *      npm run golden:chat                 # everything
 *      npm run golden:chat -- ap-          # only cases whose id contains "ap-"
 *      npm run golden:chat -- --routing    # routing only (fast)    --answers  # answers only
 *
 *  Needs NVIDIA_API_KEY (or the chat key pool) in .env.local. Exit code 1 if any case fails. A model's wording varies run to run, so a single failure is first
 *  re-run once automatically; a case that fails twice is a real failure. */
import { readFileSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch { /* file not there */ }
}

const action = (id: string, phrases: string[], input: any = {}) => ({ id, phrases, input, irreversible: false, estimated_seconds: 30, needs: [], provides: id });
const agent = (id: string, name: string, description: string, actions: any[]) => ({ id, name, version: "1", description, enabled: true, healthy: true, office: { room: id, ico: "x", color: "#fff" }, actions });
/** The same small registry the offline test assumes (lib/chat-golden.test.ts REGISTRY_ACTIONS). */
const REGISTRY: any = {
  capabilities: "", problems: [], fetchedAt: Date.now(), stale: false,
  agents: [
    agent("keyword", "Mr. Keyword", "Researches keywords.", [action("find_keywords", ["keywords do", "keyword research karo"], { topic: "string?" })]),
    agent("leads", "Mr. Lead", "Finds leads.", [action("find_leads", ["leads dhundo", "find leads"], { query: "string?" })]),
    agent("writer", "Mr. Writer", "Writes articles.", [action("write_article", ["article likho"], { topic: "string?" })]),
    agent("image", "Mr. Image", "Makes images.", [action("make_image", ["image banao"], { prompt: "string?" })]),
  ],
};

async function twice<T>(run: () => Promise<{ ok: boolean; detail: string; value?: T }>) {
  const a = await run();
  if (a.ok) return a;
  const b = await run();
  return b.ok ? { ...b, detail: `${b.detail} (passed on the second try)` } : b;
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find((a) => !a.startsWith("--")) ?? "";
  const doRouting = !args.includes("--answers");
  const doAnswers = !args.includes("--routing");
  const { ROUTING, ANSWERS, checkAnswer } = await import("./chat-golden");
  const { extractIntent } = await import("./chat-brain-intent");
  const { buildMessages } = await import("./chat-prompt");
  const { toolResultBlock } = await import("./chat-data-tools");
  const { chatComplete } = await import("./chat-llm");
  let failed = 0, total = 0;

  if (doRouting) {
    console.log("── ROUTING: which tool does the model pick? ──");
    for (const c of ROUTING.filter((x) => x.id.includes(only))) {
      total++;
      const r = await twice(async () => {
        const plan: any = await extractIntent(c.message, REGISTRY, { tz: "Asia/Dubai" });
        const name = String(plan?.action ?? "?");
        return { ok: c.expect.includes(name), detail: `-> ${name} (wanted ${c.expect.join(" | ")})` };
      });
      if (!r.ok) failed++;
      console.log(`${r.ok ? "PASS" : "FAIL"}  [${c.lang}] ${c.id}: ${c.message}\n      ${r.detail}${r.ok ? "" : `\n      why this case exists: ${c.why}`}`);
    }
  }

  if (doAnswers) {
    console.log("\n── ANSWERS: given the tool's data, is the reply right? ──");
    for (const c of ANSWERS.filter((x) => x.id.includes(only))) {
      total++;
      const r = await twice(async () => {
        const toolResult = c.tool === "answer_question" ? null : toolResultBlock({ ok: true, tool: c.tool, data: c.fixture });
        const messages = buildMessages(c.message, {}, { business: "Business: wca-global.com — ISO certification consultancy.", counts: null, capabilities: "", toolResult }, []);
        // The chat route streams the same messages to the chat model; one non-streamed call is equivalent for judging the text.
        const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
        const text = await chatComplete(system, c.message, { timeoutMs: 20000, maxTokens: 500, temperature: 0.2 });
        if (text == null) return { ok: false, detail: "the model did not answer" };
        const problems = checkAnswer(c, text);
        return { ok: problems.length === 0, detail: `reply: ${text.replace(/\s+/g, " ").slice(0, 260)}${problems.length ? `\n      ✖ ${problems.join("\n      ✖ ")}` : ""}` };
      });
      if (!r.ok) failed++;
      console.log(`${r.ok ? "PASS" : "FAIL"}  [${c.lang}] ${c.id}: ${c.message}\n      ${r.detail}${r.ok ? "" : `\n      why this case exists: ${c.why}`}`);
    }
  }

  console.log(failed ? `\n${failed} of ${total} cases FAILED` : `\nAll ${total} cases passed`);
  process.exit(failed ? 1 : 0);
}
main();
