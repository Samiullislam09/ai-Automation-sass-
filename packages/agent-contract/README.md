# @mrlxwa/agent-contract

The one shape every MrLxwa agent has (MASTER_PLAN §6, §20, §24). It gives you:

- **Manifest** types + a dependency-free validator (`validateManifest`) with exact error paths.
- **Events** — an AG-UI-style union (`run_started`, `step_started`, `progress`, `data`, `log`, `step_finished`, `run_finished`, `run_error`).
- **RunContext** — `ctx.step / progress / data / log / llm`, with LLM calls and tokens counted for you.
- **`defineAgent` + `runAction`** — the `/run` wrapper: validates input and output against the manifest, applies the timeout, emits run events, never throws.
- **Adapters** — `inProcess` (agent lives inside the brain) and `createHttpAgent` (three endpoints + signed callbacks), framework-agnostic.
- **Brain-side client** — `remoteAgent()` and `verifyCallbackSignature()`.

Zero runtime dependencies. Node ≥ 20, ESM.

**[CONTRACT.md](./CONTRACT.md) is the normative wire spec** — endpoints, headers, real captured event
and callback JSON, the signature algorithm, retry semantics and the manifest schema in prose. This
README is the TypeScript quickstart; CONTRACT.md is what a per-agent repo (or a Python port) is built
against.

## Quickstart: run the echo agent

[`examples/echo-agent/`](./examples/echo-agent) is a complete, runnable agent in three files —
[`manifest.ts`](./examples/echo-agent/manifest.ts) (what it can do),
[`agent.ts`](./examples/echo-agent/agent.ts) (~30 lines: the whole agent) and
[`server.ts`](./examples/echo-agent/server.ts) (a dependency-free `node:http` host, no express).

```
npm install
npm run example:echo        # PORT=7801 AGENT_TOKEN=echo-dev-token by default
```

```console
$ curl -s http://127.0.0.1:7801/health
{"ok":true,"version":"1.0.0","uptime":2}

$ curl -s http://127.0.0.1:7801/run -X POST \
    -H 'content-type: application/json' -H 'x-agent-token: echo-dev-token' \
    -d '{"run_id":"r1","tenant_id":"t1","action":"echo",
         "input":{"text":"hello from the brain","delay_seconds":1.2},
         "context":{},"callback_url":"http://127.0.0.1:9911/callback"}'
{"accepted":true,"run_id":"r1"}
```

The 202 comes back in ~38 ms; the run itself takes ~1 260 ms and streams `step_started`, `data`
(one per word), `progress` and `log` events to `callback_url` in batches, then one signed
`{"kind":"result"}` message. The exact JSON of all of it is in [CONTRACT.md §5](./CONTRACT.md#5-callbacks).

The handler is the whole agent:

```ts
async echo(ctx) {
  const { text, delay_seconds = 0 } = ctx.input;

  ctx.step("parse", "Reading the text");
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new AgentError("text has no words to echo", false, "empty_input");
  ctx.log(`parsed ${words.length} word(s)`, "debug");

  ctx.step("echo", "Echoing word by word");
  for (const [i, word] of words.entries()) {
    await sleep((delay_seconds * 1000) / words.length);
    if (ctx.signal.aborted) throw new AgentError("cancelled while echoing", true, "aborted");
    ctx.data("chunk", { index: i, word });
    ctx.progress((i + 1) / words.length, `${i + 1}/${words.length}`);
  }

  ctx.step("assemble", "Putting it back together");
  return { text: words.join(" "), steps: 3 };
}
```

`src/e2e.test.ts` runs that same agent and a fake brain on two real sockets and asserts the whole
round trip — 202 latency, event order, the `data` chunks, the signed result, a rejected tampered
signature, and that an unauthorised `/run` produces no callback at all.

## A 40-line agent, for real work

Same shape as the echo example, with an LLM and express instead of `node:http`:

```ts
// src/server.ts
import express from "express";
import { defineAgent, createHttpAgent, expressBridge, type LlmClient } from "@mrlxwa/agent-contract";

const agent = defineAgent({
  manifest: {
    id: "keyword",
    name: "Mr. Keyword",
    version: "1.0.0",
    description: "Turns a topic into 5-8 keyword options with a recommendation",
    actions: [
      {
        id: "find_keywords",
        phrases: ["keyword nikalo", "find keywords for", "kis keyword pe likhun"],
        input: { topic: "string", country: "string?", language: "string?" },
        output: { options: "object[]", recommended: "string" },
        irreversible: false,
        estimated_seconds: 20,
        cost_units: 5,
        needs: [],
        provides: "keywords",
        user_messages: { started: "Finding keywords for {topic}", done: "{count} keywords found" },
      },
    ],
    office: { room: "keyword", ico: "🔎", color: "#4cc9f0" },
  },
  handlers: {
    async find_keywords(ctx) {
      ctx.step("expand", "Expanding the topic");
      const { text } = await ctx.llm.complete({
        json: true,
        messages: [{ role: "user", content: `Give 6 long-tail keywords for "${ctx.input.topic}" as {"options":[{"kw":"","why":""}]}` }],
      });
      const options = JSON.parse(text).options as { kw: string; why: string }[];
      options.forEach((o, i) => { ctx.data("keyword", o); ctx.progress((i + 1) / options.length); });
      return { options, recommended: options[0].kw };
    },
  },
});

const llm: LlmClient = { complete: (req) => myNimClient(req) }; // provider rotation lives here, not in the agent

const http = createHttpAgent(agent, { token: process.env.AGENT_TOKEN!, llm });
const app = express();
app.use(express.json({ limit: "2mb" }));
app.all(["/health", "/manifest", "/run"], expressBridge(http.handle));
app.listen(process.env.PORT ?? 3000);
```

That is the whole agent. `defineAgent` throws at startup if the manifest is invalid or an action has no handler, so a broken agent never boots.

### What the handler gets

| `ctx.`      | Purpose |
|-------------|---------|
| `input`, `context` | Validated input; arbitrary context from the brain (site profile, ICP, credentials for this run). |
| `step(id, label)` | Starts a step (closes the previous). One per user-meaningful phase. |
| `progress(0..1, label?)` | Progress inside the current step. |
| `data(kind, payload)` | One item as it is produced — a keyword, a section, an image, a lead. The UI picks a renderer by `kind`. |
| `log(msg, level?)` | Developer log line. Goes to `task_events`; the user never sees it raw. |
| `llm.complete({messages, model?, json?, maxTokens?})` | Whatever `LlmClient` the adapter injected; calls and tokens are counted into the run result. |
| `signal` | Aborted on timeout / cancel. Check it in long loops. |

Throw `new AgentError("Apollo credits exhausted", /* retryable */ false, "quota")` to control retry semantics; any other error is non-retryable, a timeout is retryable.

Default timeout is `2 × estimated_seconds` (the brain's watchdog rule) — override with `timeoutMs`.

### Running in-process (today's keyword / writer)

```ts
import { inProcess } from "@mrlxwa/agent-contract";
const keyword = inProcess(agent, { llm, sink: (e) => broadcast(e) });
const result = await keyword.run({ run_id, tenant_id, action: "find_keywords", input, context });
```

### HTTP contract (what `createHttpAgent` implements)

Summary only — [CONTRACT.md](./CONTRACT.md) is the authority, with real captured JSON for every message.

```
GET  /health    → 200 { ok, version, uptime }
GET  /manifest  → 200 manifest
POST /run       → header x-agent-token: <token>
                  body  { run_id, tenant_id, action, input, context, callback_url }
                  202 { accepted: true, run_id } | 400 | 401 | 409 (duplicate run_id)
```

The run happens in the background. Everything goes to `callback_url` as JSON POSTs with headers
`x-agent-token`, `x-agent-id` and `x-run-signature = HMAC-SHA256(callbackToken ?? token, run_id + "." + status)`:

- `{ kind: "event", run_id, events: AgentEvent[] }` — batched at most every 500 ms, `status = "event"`, sent once (best effort).
- `{ kind: "result", run_id, result: RunResult }` — always last, `status = "ok" | "error"`, retried 3× with backoff.

### Brain side

```ts
import { remoteAgent, verifyCallbackSignature } from "@mrlxwa/agent-contract";

const writer = remoteAgent({ baseUrl: process.env.WRITER_URL!, token: process.env.WRITER_TOKEN! });
await writer.health();                 // throws RemoteAgentError with status + agent id
const manifest = await writer.manifest();
await writer.run({ run_id, tenant_id, action: "write_article", input, context, callback_url });

// in the callback route:
const status = body.kind === "event" ? "event" : body.result.ok ? "ok" : "error";
if (!verifyCallbackSignature(secret, body.run_id, status, req.header("x-run-signature"))) return res.sendStatus(401);
```

## Development

```
npm install
npm run build       # tsc → dist/, then a type-check pass over examples/
npm test            # tsx --test src/**/*.test.ts
npm run example:echo  # the reference agent on http://127.0.0.1:7801
```

Unit tests use no network at all. `src/e2e.test.ts` binds two `node:http` servers on **ephemeral
loopback ports** (127.0.0.1:0) — no fixed port, no outbound traffic — and closes them, keep-alive
connections included, when it finishes.

## Consuming from agent-server

**Not wired yet — on purpose.** `agent-server` is deployed on Railway with *Root Directory = `agent-server`*
(see `agent-server/railway.json`, builder NIXPACKS, `npm install && npm run build`). Nixpacks only copies that
directory into the build, so a `"@mrlxwa/agent-contract": "file:../packages/agent-contract"` dependency would
point outside the build context and fail `npm install` on Railway (same family of error as the
"Failed to read app source directory" issue already hit with a leading-slash Root Directory). It works locally,
which is exactly the kind of trap that costs a deploy. The root Next app on Vercel has the same constraint.

Options, in order of preference:

1. **Publish to npm under the owner's scope** (`@mrlxwa/agent-contract`, or `@cgheven/...` if the scope is not
   available). `npm publish --access public` from this folder (`prepack` runs the build). agent-server and every
   agent repo then depend on a normal semver range. Best for the "each agent its own repo" layout in §11.
2. **Git dependency** — `"@mrlxwa/agent-contract": "github:<owner>/<repo>#path:packages/agent-contract"` is not
   supported by npm for subdirectories; it would need this package in its own repo (`mrlxwa-agent-contract`)
   and `"github:<owner>/mrlxwa-agent-contract#v0.1.0"` with `prepare` building `dist/`. Fine for private use,
   slower installs.
3. **Copy on build** — change `agent-server/railway.json` `buildCommand` to build with the repo root as Root
   Directory, or add a pre-build step that copies `packages/agent-contract/dist` into `agent-server/vendor/`
   and points a `paths` alias at it. Works, but reintroduces the whole-repo scan + Root Directory gotchas.

Until one is chosen, `agent-server/package.json` is untouched and no existing agent has been ported.
