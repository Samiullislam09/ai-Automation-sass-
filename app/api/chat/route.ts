import { NextRequest } from "next/server";
import "@/lib/dns-fix";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { detectChatIntent } from "@/lib/chat-intent";
import { enqueueAgentJob } from "@/lib/agent-jobs";

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
async function loadRealBusinessContext(): Promise<{ tenantId: string | null; business: string | null }> {
  try {
    const supabase = await createClient();
    const tenantId = await getCurrentTenantId(supabase);
    if (!tenantId) return { tenantId: null, business: null };

    const [{ data: tenant }, { data: samplePages }] = await Promise.all([
      supabase.from("tenants").select("website_url, niche, tone_profile, icp_profile, onboarded").eq("id", tenantId).single(),
      supabase.from("site_pages").select("title").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(6),
    ]);
    if (!tenant || !tenant.onboarded) return { tenantId, business: null };

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

    return { tenantId, business: facts.length ? facts.join(" · ") : null };
  } catch (e: any) {
    console.error("[chat] failed to load real tenant context:", e.message);
    return { tenantId: null, business: null };
  }
}

function systemPrompt(ctx: any, business: string | null, recentWork: string | null): string {
  return `You are Mr Lxwa, running a small AI marketing team (Mr. Keyword, Mr. Writer, Mr. Story, Miss Social, Mr. SEO) inside the GrowthTeam AI (MrLxwa) dashboard. Reply in 1-2 short sentences, warm and confident. **Bold** is fine.

Account: ${ctx.tokens ?? "?"}/${ctx.tokensMax ?? "?"} tokens (${ctx.plan ?? "free"} plan) · ${ctx.awaiting ?? 0} awaiting approval · latest report: ${ctx.report ?? "nothing yet today"} · business: ${business ?? "not onboarded yet"}

WHAT THE TEAM ACTUALLY DID (real jobs_log rows — the only work you may claim happened):
${recentWork ?? "nothing yet — no jobs have run for this account."}

IF THE USER IS ASKING ABOUT PROGRESS — "kya update hai", "article likha?", "what happened", "is it done", "any news" — that is a STATUS question, not an order. Answer it from the list above and nowhere else:
- The newest matching row wins. Say what it was and whether it finished.
- If it FAILED, say so first and quote the reason in plain words. Never answer a status question by asking the user to re-issue the order when the list shows the job already ran or failed — that is the single most annoying thing you can do.
- If the list has nothing about what they're asking, say plainly that nothing has run for it yet.
The conversation above is yours to remember: if you already told the user you put the team on something, do not act as if you never heard of it.

You are the MANAGER, not the writer. You never write an article, blog post or social copy inside this chat — Mr. Keyword researches and Mr. Writer drafts, and the draft lands in the user's Approvals page. If the user asks for content, tell them to say it as an order ("write an article about X") so you can put the team on it; do not produce the content yourself, not even a sample or an outline.

Real actions you CAN start: planning topics and writing articles. BUT NOT IN THIS REPLY — if you are answering, the order was not recognised, so NOTHING has been queued. Never say "queued", "enqueued", "I've started it" or "Mr. Writer is on it" here; instead ask the user to type it as a plain order, exactly like: write an article about <topic>. Everything else — publishing, social scheduling, email — is not built yet; say so plainly. Never invent numbers or work not listed above. Match the user's language (English or Hinglish).`;
}

/** The last few real jobs, in one line each. Without this Mr Lxwa could not answer "what did
 *  the team do?" with anything but invention — and invention is the one thing he must not do. */
async function loadRecentWork(tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("jobs_log")
      .select("agent, action, status, detail, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (!data?.length) return null;
    return data
      .map((j: any) => {
        const when = new Date(j.created_at).toLocaleString();
        const what = j.action && j.action !== j.agent ? j.action : j.agent;
        // The hint is the part that answers "so what do I do?" — without it Mr Lxwa could
        // report a failure but never explain it.
        const hint = j.detail?.hint ? ` (${String(j.detail.hint).slice(0, 200)})` : "";
        const outcome =
          j.status === "error" ? `FAILED: ${String(j.detail?.message ?? "unknown error").slice(0, 200)}${hint}`
          : j.status === "success" ? "done"
          : j.status;
        return `- ${when} · ${j.agent} · ${what} — ${outcome}`;
      })
      .join("\n");
  } catch (e: any) {
    console.error("[chat] failed to load recent work:", e.message);
    return null;
  }
}

type Turn = { role: "user" | "assistant"; content: string };

/** The chat had no memory at all: every POST sent one question and nothing else, so asking
 *  for an article and then asking "kya update hai?" produced a reply that had never heard of
 *  the article. Trimmed and sanitised here rather than trusted from the client. */
function cleanHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t: any) => (t?.role === "user" || t?.role === "assistant") && typeof t?.content === "string" && t.content.trim())
    .slice(-8)
    .map((t: any) => ({ role: t.role, content: String(t.content).slice(0, 700) }));
}


/* ── Persistence ───────────────────────────────────────────────────────────────────────
 * Chat used to live only in React state, so a refresh threw away the whole conversation —
 * including the part where Mr Lxwa told you which job he had just started. Every turn is
 * now written to chat_messages (migration 011) and the panel reopens where you left off.
 * All of it is best-effort: if the tables aren't there yet, or a write fails, the reply
 * still streams. Losing the transcript is bad; losing the answer is worse.
 */

/** The conversation this turn belongs to, creating one on the first message. */
async function ensureConversation(tenantId: string, conversationId: string | null): Promise<string | null> {
  try {
    const supabase = await createClient();
    if (conversationId) {
      const { data } = await supabase
        .from("chat_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (data?.id) return data.id;
      // Unknown id (deleted in another tab, or someone else's) — start a fresh one rather
      // than writing messages into a conversation this tenant doesn't own.
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({ tenant_id: tenantId, user_id: user?.id ?? null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  } catch (e: any) {
    console.error("[chat] could not open a conversation:", e?.message);
    return null;
  }
}

async function saveTurn(tenantId: string, conversationId: string, question: string, answer: string) {
  try {
    const supabase = await createClient();
    await supabase.from("chat_messages").insert([
      { conversation_id: conversationId, tenant_id: tenantId, role: "user", content: question },
      { conversation_id: conversationId, tenant_id: tenantId, role: "assistant", content: answer },
    ]);
    // The title is the first thing you asked, which is what makes the list scannable.
    const { data: conv } = await supabase
      .from("chat_conversations")
      .select("title")
      .eq("id", conversationId)
      .maybeSingle();
    await supabase
      .from("chat_conversations")
      .update({
        updated_at: new Date().toISOString(),
        ...(conv?.title ? {} : { title: question.trim().slice(0, 80) }),
      })
      .eq("id", conversationId)
      .eq("tenant_id", tenantId);
  } catch (e: any) {
    console.error("[chat] could not save the turn:", e?.message);
  }
}

/** History from the database rather than from the client. The browser's copy is fine, but
 *  it only has what this tab happens to be showing — after a refresh that is nothing. */
async function loadHistoryFromDb(tenantId: string, conversationId: string): Promise<Turn[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(8);
    return cleanHistory((data ?? []).reverse());
  } catch {
    return [];
  }
}

async function askLightning(q: string, ctx: any, business: string | null, recentWork: string | null, history: Turn[]): Promise<string> {
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
        { role: "system", content: systemPrompt(ctx, business, recentWork) },
        ...history,
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

/** Enqueues the real job an order maps to and describes the pipeline that will now run.
 *  With a topic we can skip the planner and go straight to Mr. Keyword (chain: true is what
 *  makes him hand the blueprint to Mr. Writer — see agent-server/src/agents/keyword.ts).
 *  Without one, Mr Lxwa's planner picks the topics from the business's own data. */
async function startWork(intent: NonNullable<ReturnType<typeof detectChatIntent>>, tenantId: string): Promise<string> {
  const topic = intent.kind === "write" ? intent.topic : null;

  const res = topic
    ? await enqueueAgentJob("keyword", tenantId, { topic, chain: true, taskLabel: `Researching "${topic}"` })
    : await enqueueAgentJob("boss", tenantId, { count: intent.kind === "plan" ? 3 : 1 });

  if (!res.ok) {
    // 429 is the daily cap, which is a completely different situation from "the server is
    // down" — telling someone to wait for the agent server to come back when it is up and
    // simply refusing on budget grounds sends them chasing the wrong problem.
    const next =
      res.status === 429
        ? `That's the daily budget guard, not a fault — the agent server is fine. Raise the cap on agent-server (DAILY_CAP_*) or try again tomorrow.`
        : `Try again once the agent server is reachable.`;
    return `I couldn't put the team to work: **${res.error}** — so I'm not going to pretend it's running. Nothing was started, and no credits were used. ${next}`;
  }

  const head = topic
    ? `On it — **"${topic}"** is now a real job, not a chat answer.`
    : intent.kind === "plan"
      ? `Starting the team now — I'm picking this week's topics from your own niche and the pages we crawled.`
      : `On it. You didn't name a topic, so I'm choosing one from your niche and the pages we crawled.`;

  const steps = [
    topic ? `**Mr. Keyword** is pulling real search volume + related queries for it.`
          : `**Me (Mr Lxwa)** → then **Mr. Keyword** validates each topic with real search data.`,
    `If the demand is real he builds the blueprint and hands it to **Mr. Writer** — if nobody searches for it, he stops there and tells you why.`,
    `**Mr. Writer** drafts it, it goes through the quality gate, and lands in **Approvals**. Nothing gets published without you.`,
  ];

  return `${head}\n\n1. ${steps[0]}\n2. ${steps[1]}\n3. ${steps[2]}\n\nWatch the office below — each room lights up when its turn starts.`;
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
  const { q, ctx, history: rawHistory, conversationId } = await req.json();
  let history = cleanHistory(rawHistory);

  // "__hello__" is a silent UI trigger (chat auto-opens with a greeting) — always instant/canned,
  // no need to spend a model call on a fixed message.
  if (q === "__hello__") {
    return new Response(wordStream(fallback(q, ctx || {})), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const { tenantId, business } = await loadRealBusinessContext();

  // Open (or reopen) the thread this turn belongs to. The id goes back on a header so the
  // panel can keep using it for the rest of the session without waiting for the stream.
  const convId = tenantId ? await ensureConversation(tenantId, typeof conversationId === "string" ? conversationId : null) : null;
  if (tenantId && convId) {
    const stored = await loadHistoryFromDb(tenantId, convId);
    if (stored.length) history = stored;
  }

  const reply = (text: string) => {
    if (tenantId && convId) void saveTurn(tenantId, convId, q, text);
    return new Response(wordStream(text), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...(convId ? { "X-Conversation-Id": convId } : {}),
      },
    });
  };

  // ---- ORDERS BEFORE CONVERSATION ------------------------------------------------------
  // "write me an article" is a job, not a question. Before spending a chat call on it we hand
  // it to the real queue and answer with what actually started — so the office animation and
  // the Approvals page match what the chat just claimed. See lib/chat-intent.ts.
  const intent = detectChatIntent(q);
  const recentWork = intent ? null : await loadRecentWork(tenantId);
  if (intent && tenantId) {
    const text = await startWork(intent, tenantId);
    return reply(text);
  }


  // Cheap defense-in-depth on top of chat_template_kwargs.thinking:false above — costs
  // nothing on the (now common) happy path, catches the rare remaining transient failure.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await askLightning(q, ctx || {}, business, recentWork, history);
      return reply(text);
    } catch (e: any) {
      console.error(`[chat] Lightning call failed (attempt ${attempt}/2):`, e.message);
    }
  }
  return reply(fallback(q, ctx || {}));
}
