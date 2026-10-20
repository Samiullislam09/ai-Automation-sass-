/** Run: cd agent-server && npx tsx --test src/lib/errors.test.ts
 *
 *  The error explainer turns a raw thrown Error into a calm sentence for the dashboard. The one
 *  that leaked raw NVIDIA JSON to the user (a per-account 404) is pinned here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { explainAgentError } from "./errors.js";

test("a per-account model 404 becomes a calm sentence, not raw provider JSON", () => {
  const raw = `NVIDIA NIM chat completion failed (404): {"status":404,"title":"Not Found","detail":"Function 'ac74040f-9fc9': Not found for account 'edsx'"}`;
  const e = explainAgentError("boss", new Error(raw), 500);
  assert.match(e.message, /temporarily unavailable/i);
  assert.doesNotMatch(e.message, /404|Function|account '|\{/, "the user-facing message must not contain the raw JSON/status");
  assert.equal(e.cause, raw, "raw cause is still kept for debugging");
  assert.ok(e.hint && /NVIDIA_MODEL|model/i.test(e.hint));
});

test("the fallback 'no candidate model' message is also mapped calmly", () => {
  const e = explainAgentError("writer", new Error("NVIDIA NIM: no candidate model is available for this account. Last: ..."), 500);
  assert.match(e.message, /temporarily unavailable/i);
  assert.doesNotMatch(e.message, /candidate|Last:/);
});

test("a timeout still reads as a timeout (existing behaviour intact)", () => {
  const e = explainAgentError("writer", new Error("The operation was aborted due to timeout"), 60000);
  assert.match(e.message, /waiting for the AI model/i);
});
