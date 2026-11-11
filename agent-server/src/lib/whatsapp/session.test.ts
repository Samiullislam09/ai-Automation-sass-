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
const { leaseDecision, shouldYield, whatsappHostEnabled, INSTANCE_ID } = await import("./session.js");
const { isSecretSessionLog } = await import("../quietLogs.js");

test("leaseDecision: free or gone -> take, mine -> mine, a live OLDER holder -> request a handover, a live NEWER one -> wait", () => {
  const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
  const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
  const T0 = NOW - 3600_000; // this process started an hour ago
  const older = ago(7200), newer = ago(60);
  assert.equal(leaseDecision(null, "me", T0, NOW), "take", "no row yet");
  assert.equal(leaseDecision({ owner: null, owner_seen_at: null }, "me", T0, NOW), "take", "nobody holds it");
  assert.equal(leaseDecision({ owner: "me", owner_seen_at: ago(5) }, "me", T0, NOW), "mine");
  assert.equal(leaseDecision({ owner: "old", owner_seen_at: ago(20), owner_started_at: older }, "me", T0, NOW), "request", "the holder is older: ask it to step aside");
  assert.equal(leaseDecision({ owner: "newer", owner_seen_at: ago(20), owner_started_at: newer }, "me", T0, NOW), "wait", "an older process never takes a login from a newer one");
  assert.equal(leaseDecision({ owner: "old", owner_seen_at: ago(59), owner_started_at: older }, "me", T0, NOW), "request");
  assert.equal(leaseDecision({ owner: "old", owner_seen_at: ago(61), owner_started_at: older }, "me", T0, NOW), "take", "stopped renewing: it is gone");
  assert.equal(leaseDecision({ owner: "old", owner_seen_at: null }, "me", T0, NOW), "take", "never renewed");
  assert.equal(leaseDecision({ owner: "unknown-age", owner_seen_at: ago(5) }, "me", T0, NOW), "request", "an old build that wrote no start time counts as oldest");
  assert.ok(INSTANCE_ID.length > 8);
});

test("shouldYield: the holder hands over only when ANOTHER process asked", () => {
  assert.equal(shouldYield({ takeover_by: "newer" }, "me"), true);
  assert.equal(shouldYield({ takeover_by: "me" }, "me"), false);
  assert.equal(shouldYield({ takeover_by: null }, "me"), false);
  assert.equal(shouldYield(null, "me"), false);
});

test("whatsappHostEnabled: a developer's Windows/macOS machine never takes the production login", () => {
  assert.equal(whatsappHostEnabled({}, "linux"), true, "a Linux container (Railway) takes part by default");
  assert.equal(whatsappHostEnabled({}, "win32"), false, "a Windows PC does not");
  assert.equal(whatsappHostEnabled({}, "darwin"), false, "nor a Mac");
  assert.equal(whatsappHostEnabled({ WHATSAPP_ENABLED: "1" }, "win32"), true, "unless asked to");
  assert.equal(whatsappHostEnabled({ WHATSAPP_ENABLED: "0" }, "linux"), false, "or switched off");
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
