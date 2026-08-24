import { NextRequest, NextResponse } from "next/server";
import "@/lib/dns-fix";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** "Make the intro shorter." "Add a section on pricing." — the AI editor inside the reviewer.
 *
 *  It RETURNS a revision, it does not save one. Nothing is written to content_items until the
 *  person reading it presses Save, so an instruction that lands badly costs one click of
 *  Undo rather than the draft.
 *
 *  Same model as the rest of the product, with the two settings the writer needed the hard
 *  way: thinking disabled (this Nemotron burns its whole budget on internal reasoning
 *  otherwise and never returns) and an explicit output ceiling big enough for a full article.
 */

const TIMEOUT_MS = 180_000;
const MAX_INSTRUCTION = 600;

const RULES = [
  "Return the COMPLETE revised article in markdown — not a diff, not an explanation, not a comment on what you changed.",
  "Change ONLY what the instruction asks for. Every other sentence must come back word for word.",
  "Never invent facts, statistics, prices, dates, awards, client names or quotes. If the instruction asks for something you have no facts for, write the section without specifics rather than making them up.",
  "Keep the existing voice, the '# Title' first line and the '##' section structure unless the instruction says otherwise.",
  "No preamble and no sign-off — the response is the article itself.",
];

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const key = process.env.NVIDIA_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "NVIDIA_API_KEY is not set on this deployment." }, { status: 503 });

  const payload = await request.json().catch(() => ({} as any));
  const instruction = String(payload?.instruction ?? "").trim().slice(0, MAX_INSTRUCTION);
  if (!instruction) return NextResponse.json({ ok: false, error: "Kya badalna hai, wo likho." }, { status: 400 });

  // The body being edited comes from the client, so an unsaved revision can be refined again
  // without saving first. Falls back to the stored copy when the client doesn't send one.
  const draft = typeof payload?.body === "string" && payload.body.trim() ? payload.body : null;

  const { data: item, error } = await supabase
    .from("content_items")
    .select("title, body, status")
    .eq("id", params.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!item) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const current = draft ?? item.body ?? "";
  if (!current.trim()) return NextResponse.json({ ok: false, error: "This draft is empty." }, { status: 400 });

  // The business's own profile, so a revision doesn't drift away from who this is for.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, website_url, niche, tone_profile")
    .eq("id", tenantId)
    .maybeSingle();
  const tone = ((tenant?.tone_profile as any) ?? {}) as any;

  const context = [
    tenant?.name ? `Business: ${tenant.name}` : "",
    tenant?.website_url ? `Website: ${tenant.website_url}` : "",
    tenant?.niche ? `What they do: ${tenant.niche}` : "",
    tone.audience ? `Audience: ${tone.audience}` : "",
    tone.tone ? `Brand tone: ${tone.tone}` : "",
  ].filter(Boolean).join("\n");

  const prompt = [
    context ? `BUSINESS CONTEXT (everything you may treat as true):\n${context}\n` : "",
    "CURRENT ARTICLE:",
    "---",
    current,
    "---",
    "",
    `THE EDITOR'S INSTRUCTION: ${instruction}`,
    "",
    `RULES:\n${RULES.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        stream: false,
        chat_template_kwargs: { thinking: false },
        max_tokens: 6000,
        messages: [
          {
            role: "system",
            content:
              "You are a careful copy editor working on one business's own blog article. " +
              "You make exactly the change you are asked for and nothing else, and you never introduce a fact you were not given.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return NextResponse.json({ ok: false, error: `The model refused the edit (${res.status}). ${detail}` }, { status: 502 });
    }

    const data = await res.json();
    const choice = data?.choices?.[0];
    let text: string = choice?.message?.content ?? "";
    if (!text.trim()) return NextResponse.json({ ok: false, error: "The model returned nothing." }, { status: 502 });
    if (choice?.finish_reason === "length") {
      return NextResponse.json({ ok: false, error: "The revision was cut off by the model's output limit — try a smaller change." }, { status: 502 });
    }

    // Models like to wrap a whole document in a fence even when told not to.
    text = text.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/```$/, "").trim();

    return NextResponse.json({ ok: true, body: text, instruction });
  } catch (e: any) {
    const timedOut = e?.name === "TimeoutError" || /abort|timeout/i.test(e?.message ?? "");
    return NextResponse.json(
      { ok: false, error: timedOut ? `The model didn't answer within ${TIMEOUT_MS / 1000}s. Nothing was changed.` : (e?.message ?? "Revision failed.") },
      { status: 504 }
    );
  }
}
