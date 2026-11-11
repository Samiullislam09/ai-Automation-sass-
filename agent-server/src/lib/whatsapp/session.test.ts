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
