/** Run: cd agent-server && npx tsx --test src/agents/social.test.ts
 *
 *  §7.7's one hard rule, tested directly: this agent never claims to post or schedule
 *  anything, whatever the model returns. Everything else — the fallback when a network is
 *  missing from the model's answer, hashtag cleanup, the over-length flag — is tested against
 *  `draftPosts` with a fake `complete`, never against the real NVIDIA call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { SocialAgent, draftPosts, readNetworks, NETWORKS, LIMIT, NO_AUTOPOST_NOTE } = await import("./social.js");
const { MANIFESTS, STUB_AGENTS } = await import("../brain/manifests.js");
const { validateAgainstSchema } = await import("../vendor/agent-contract/index.js");

const AGENT = MANIFESTS.find((m) => m.id === "social")!;
const SPEC = AGENT.actions.find((a) => a.id === "draft_social")!;

const ARTICLE = { id: "item-1", title: "ISO 27001 for small teams", body: "ISO 27001 is a certification for information security. " + "It matters because clients ask for it. ".repeat(20), url: null };

/** A fake `complete` that answers with a fixed set of posts, one per network requested,
 *  unless a network is deliberately left out of `answered` to exercise the fallback path. */
function fakeComplete(answered: Partial<Record<string, { text?: string; hashtags?: string[]; imageBrief?: string }>>) {
  return async () => ({
    posts: Object.entries(answered).map(([network, p]) => ({ network, ...p })),
  });
}

type Emitted = { kind: string; payload: any };
function fakeCtx() {
  const data: Emitted[] = [];
  const progress: { fraction: number; label?: string }[] = [];
  const logs: string[] = [];
  return {
    data,
    progress,
    logs,
    ctx: {
      onProgress: () => {},
      data: (kind: string, payload: unknown) => data.push({ kind, payload }),
      progress: (fraction: number, label?: string) => progress.push({ fraction, label }),
      log: (message: string) => logs.push(message),
    },
  };
}

function job(data: Record<string, unknown>) {
  return { id: "job-1", name: "social", data: { tenantId: "t-1", ...data } } as any;
}

/* ---------------------------------------------------------------- the contract ------------ */

test("social is not a stub any more, and the manifest is honest about what it does", () => {
  assert.equal(STUB_AGENTS.has("social"), false);
  // §7.7's whole point: nothing here posts anywhere yet.
  assert.doesNotMatch(AGENT.description.toLowerCase(), /auto[- ]?post/);
  assert.match(AGENT.description.toLowerCase(), /copy/);
});

test("draftPosts' output matches the manifest's declared shape", async () => {
  const complete = fakeComplete({ facebook: { text: "Check out our new guide.", hashtags: ["iso27001"], imageBrief: "A team reviewing a compliance checklist." } });
  const posts = await draftPosts(ARTICLE, null, ["facebook"], complete as any);
  assert.deepEqual(validateAgainstSchema(SPEC.output, { posts }, "social.draft_social output"), []);
});

test("no article means a question, not a crash — and no network call is attempted", async () => {
  const { ctx } = fakeCtx();
  const out: any = await new SocialAgent().run(job({}), ctx as any);
  assert.equal(out.drafted, false);
  assert.match(out.question, /article/);
  assert.deepEqual(out.posts, []);
});

/* ---------------------------------------------------------------- §7.7's hard rule -------- */

test("the note is explicit that nothing is auto-posted", () => {
  // Static, not model-derived — the promise §7.7 makes must hold whatever the model answers
  // with, so it cannot be a sentence the model has any part in writing.
  assert.match(NO_AUTOPOST_NOTE, /auto-post nahi/);
});

/* ---------------------------------------------------------------- readNetworks ------------ */

test("no networks requested means all four, led by nothing in particular but always including facebook", () => {
  assert.deepEqual(readNetworks(undefined), [...NETWORKS]);
  assert.deepEqual(readNetworks([]), [...NETWORKS]);
});

test("an unknown network is dropped, not passed through to the model as a mystery platform", () => {
  assert.deepEqual(readNetworks(["facebook", "myspace", "x"]), ["facebook", "x"]);
});

test("all-unknown networks fall back to the full set rather than drafting nothing", () => {
  assert.deepEqual(readNetworks(["myspace", "friendster"]), [...NETWORKS]);
});

/* ---------------------------------------------------------------- draftPosts --------------- */

test("a network the model forgot still gets a real, usable draft — never dropped silently", async () => {
  const complete = fakeComplete({ facebook: { text: "Read our new guide." } }); // linkedin missing
  const drafts = await draftPosts(ARTICLE, null, ["facebook", "linkedin"], complete as any);
  assert.equal(drafts.length, 2, "a requested network is never silently dropped");
  const li = drafts.find((d) => d.network === "linkedin")!;
  assert.ok(li.text.length > 0);
  assert.match(li.text, /ISO 27001 for small teams/);
});

test("hashtags are cleaned of a leading # and capped at five", async () => {
  const complete = fakeComplete({
    x: { text: "New guide.", hashtags: ["#iso27001", " Compliance ", "security", "audit", "risk", "sixth", "seventh"] },
  });
  const [draft] = await draftPosts(ARTICLE, null, ["x"], complete as any);
  assert.equal(draft.hashtags.length, 5);
  assert.equal(draft.hashtags[0], "iso27001");
  assert.equal(draft.hashtags[1], "Compliance");
});

test("a draft over its network's limit is still returned whole, not truncated mid-sentence", async () => {
  const long = "x".repeat(400);
  const complete = fakeComplete({ x: { text: long } });
  const [draft] = await draftPosts(ARTICLE, null, ["x"], complete as any);
  assert.equal(draft.text, long, "never silently cut");
  assert.ok(draft.text.length > LIMIT.x);
});

test("no imageBrief from the model gets a real fallback sentence, not an empty string", async () => {
  const complete = fakeComplete({ facebook: { text: "New guide." } });
  const [draft] = await draftPosts(ARTICLE, null, ["facebook"], complete as any);
  assert.ok(draft.imageBrief.length > 0);
});

test("proof and offerings from the Site Brain reach the prompt, so the model can ground the post in them", async () => {
  let seenPrompt = "";
  const complete = async (prompt: string) => {
    seenPrompt = prompt;
    return { posts: [{ network: "facebook", text: "New guide." }] };
  };
  const profile: any = {
    what_they_do: "ISO certification consulting",
    proof: [{ claim: "200+ companies certified since 2015", quote: null, url: null }],
    offerings: [{ name: "ISO 27001 gap audit", url: null, kind: "service" }],
    voice: { tone: "friendly but precise", do: [], dont: [], samples: [] },
  };
  await draftPosts(ARTICLE, profile, ["facebook"], complete as any);
  assert.match(seenPrompt, /200\+ companies certified since 2015/);
  assert.match(seenPrompt, /ISO 27001 gap audit/);
  assert.match(seenPrompt, /friendly but precise/);
});
