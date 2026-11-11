/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/session.test.ts
 *  How a closed WhatsApp socket is handled: the rules that stop two sockets fighting over one login. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { closeAction, reconnectDelayMs } = await import("./session.js");

test("closeAction: unlinked, banned, replaced by another process, or a blip", () => {
  assert.equal(closeAction(401), "logged_out");
  assert.equal(closeAction(403), "banned");
  assert.equal(closeAction(440), "replaced", "another process opened this login: do not fight it");
  assert.equal(closeAction(428), "reconnect", "connection closed");
  assert.equal(closeAction(515), "reconnect", "restart required");
  assert.equal(closeAction(undefined), "reconnect");
});

test("reconnectDelayMs: slower each time, capped, and a long wait when another process holds the login", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => reconnectDelayMs(n, false)), [3000, 6000, 12000, 24000, 48000, 60000, 60000]);
  assert.equal(reconnectDelayMs(0, true), 10 * 60_000);
});

// ── the connection lease: one process at a time ────────────────────────────────────────────
const { leaseVerdict, INSTANCE_ID } = await import("./session.js");
const { isSecretSessionLog } = await import("../quietLogs.js");

test("leaseVerdict: free or stale -> take, mine -> mine, another LIVE process -> busy (wait, do not fight)", () => {
  const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
  const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
  assert.equal(leaseVerdict(null, "me", NOW), "take", "no row yet");
  assert.equal(leaseVerdict({ owner: null, owner_seen_at: null }, "me", NOW), "take", "nobody holds it");
  assert.equal(leaseVerdict({ owner: "me", owner_seen_at: ago(5) }, "me", NOW), "mine");
  assert.equal(leaseVerdict({ owner: "old-deploy", owner_seen_at: ago(20) }, "me", NOW), "busy", "renewed 20s ago: it is alive");
  assert.equal(leaseVerdict({ owner: "old-deploy", owner_seen_at: ago(119) }, "me", NOW), "busy");
  assert.equal(leaseVerdict({ owner: "old-deploy", owner_seen_at: ago(121) }, "me", NOW), "take", "stopped renewing: it is gone");
  assert.equal(leaseVerdict({ owner: "old-deploy", owner_seen_at: null }, "me", NOW), "take", "never renewed");
  assert.ok(INSTANCE_ID.length > 8);
});

test("secret session dumps from libsignal are recognised so they never reach the logs", () => {
  assert.equal(isSecretSessionLog("Closing session:"), true);
  assert.equal(isSecretSessionLog("Closing open session in favor of incoming prekey bundle"), true);
  assert.equal(isSecretSessionLog("Removing old closed session:"), true);
  assert.equal(isSecretSessionLog("Opening session:"), true);
  assert.equal(isSecretSessionLog("[whatsapp] socket closed (code 440) -> replaced"), false, "our own diagnostics stay");
  assert.equal(isSecretSessionLog("opened connection to WA"), false);
  assert.equal(isSecretSessionLog({ privKey: 1 }), false);
});
