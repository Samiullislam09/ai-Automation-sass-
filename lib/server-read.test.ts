import { test } from "node:test";
import assert from "node:assert/strict";
import { readRoute } from "./server-read";
import { loadChats } from "./whatsapp-chats";

test("readRoute gives the JSON a route handler would send, and null (never a throw) when it fails", async () => {
  assert.deepEqual(await readRoute(async () => Response.json({ ok: true, n: 3 })), { ok: true, n: 3 });
  assert.equal(await readRoute(async () => { throw new Error("boom"); }), null);
  assert.equal(await readRoute(async () => new Response("<html>not json</html>")), null);
});

function fakeDb(tables: Record<string, { data?: any[]; error?: { message: string } | null }>) {
  return {
    from(table: string) {
      const t = tables[table] ?? { data: [] };
      const q: any = {
        select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { return q; },
        then(r: any) { r({ data: t.data ?? [], error: t.error ?? null }); },
      };
      return q;
    },
  } as any;
}

test("the chat list: last message and unread count per lead, and a dialable number", async () => {
  const r: any = await loadChats(fakeDb({
    leads: { data: [{ id: "a", company: "Alpha", whatsapp: "+971 50 123 4567", phone: null, country: "United Arab Emirates" }, { id: "b", company: "Beta", whatsapp: null, phone: "0504608157", country: "United Arab Emirates" }] },
    outreach_messages: { data: [
      { lead_id: "a", direction: "in", status: "received", body: "second", created_at: "2026-11-18T12:00:00Z" },
      { lead_id: "a", direction: "in", status: "received", body: "first", created_at: "2026-11-18T11:00:00Z" },
      { lead_id: "a", direction: "out", status: "read", body: "hello", created_at: "2026-11-18T10:00:00Z" },
    ] },
  }), "t1");
  assert.equal(r.items.length, 2);
  const inbox = r.inbox.find((m: any) => m.lead_id === "a");
  assert.equal(inbox.body, "second");
  assert.equal(inbox.unanswered, 2, "their two messages after our last one");
  assert.equal(r.items.find((l: any) => l.id === "a").dial, "971501234567");
  assert.equal(r.items.find((l: any) => l.id === "b").dial, "971504608157", "a local number is made dialable from the country");
});

test("a failed read is a value, not a throw", async () => {
  const r: any = await loadChats(fakeDb({ leads: { error: { message: "boom" } } }), "t1");
  assert.equal(r.error, "boom");
});
