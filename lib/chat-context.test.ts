/** Run: npx tsx --test lib/chat-context.test.ts
 *
 *  The two readers added on 2026-09-18 so Mr Lxwa can see what is happening NOW and what is
 *  actually wrong with the site. Both were previously invisible to the chat even though the
 *  database held them.
 *
 *  A stub Supabase, not a real one: what is worth protecting here is the FORMATTING, because
 *  every line these produce is read by a model that will repeat whatever it is told. The
 *  awaiting_confirm case in particular has to say "NOT started" — reporting an unconfirmed
 *  order as running is the same class of lie as reporting a finished one as in progress.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agoPhrase, loadLiveWork, loadSiteIssues } from "./chat-context";

/** Minimal chainable stub — only the calls these two functions actually make. */
function stub(table: string, rows: any, opts: { single?: boolean } = {}) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => (opts.single ? chain : Promise.resolve({ data: rows })),
    maybeSingle: () => Promise.resolve({ data: rows }),
  };
  return { from: (t: string) => (t === table ? chain : { select: () => chain }) } as any;
}

const MINUTE = 60_000;

/* ── loadLiveWork ─────────────────────────────────────────────────────────────────────────── */

test("loadLiveWork names the subject and distinguishes running from queued", async () => {
  const now = Date.now();
  const out = await loadLiveWork(
    stub("tasks", [
      { kind: "write_article", status: "running", params: { topic: "ISO 9001 audit checklist" }, updated_at: new Date(now - 3 * MINUTE).toISOString() },
      { kind: "find_keywords", status: "queued", params: { seed: "budget laptops" } },
    ]),
    "t1",
  );
  assert.ok(out);
  assert.match(out!, /write_article "ISO 9001 audit checklist" — running, started 3 minutes ago/);
  assert.match(out!, /find_keywords "budget laptops" — queued, not started yet/);
});

test("loadLiveWork says plainly that an unconfirmed order has NOT started", async () => {
  const out = await loadLiveWork(stub("tasks", [{ kind: "publish", status: "awaiting_confirm", params: {} }]), "t1");
  assert.ok(out);
  assert.match(out!, /NOT started/, "an order waiting on a yes must never read as in-progress");
});

test("loadLiveWork reports a scheduled task's own run time", async () => {
  const at = "2026-09-20T09:00:00.000Z";
  const out = await loadLiveWork(stub("tasks", [{ kind: "write_article", status: "scheduled", params: {}, run_at: at }]), "t1");
  assert.match(out!, /scheduled for 2026-09-20T09:00:00\.000Z/);
});

test("loadLiveWork carries a task's last error, so a stuck job is not reported as healthy", async () => {
  const out = await loadLiveWork(stub("tasks", [{ kind: "make_image", status: "queued", params: {}, error: "No route for image.make_image" }]), "t1");
  assert.match(out!, /last error: No route for image\.make_image/);
});

test("loadLiveWork is null when nothing is live, and when there is no tenant", async () => {
  assert.equal(await loadLiveWork(stub("tasks", []), "t1"), null);
  assert.equal(await loadLiveWork(stub("tasks", [{ kind: "x", status: "queued", params: {} }]), null), null);
});

test("loadLiveWork invents no subject for a task that genuinely has none", async () => {
  const out = await loadLiveWork(stub("tasks", [{ kind: "audit_site", status: "running", params: {} }]), "t1");
  assert.match(out!, /^- audit_site — running/m, "no quotes, no made-up label");
});

/* ── loadSiteIssues ───────────────────────────────────────────────────────────────────────── */

const AUDIT = {
  score: 62,
  previous_score: 48,
  pages_checked: 34,
  blocks: 2,
  warns: 5,
  created_at: new Date(Date.now() - 2 * 60 * MINUTE).toISOString(),
  issues: [
    { id: "no-sitemap", what: "There is no sitemap.xml", fix: "Add one and list it in robots.txt." },
    { id: "slow", what: "6 pages load slowly", fix: "Compress the hero images." },
  ],
};

test("loadSiteIssues reports the score, its history and every issue with its fix", async () => {
  const out = await loadSiteIssues(stub("site_audits", AUDIT, { single: true }), "t1");
  assert.ok(out);
  assert.match(out!, /score 62\/100/);
  assert.match(out!, /previous score 48/, "'is it improving' is always the next question");
  assert.match(out!, /34 page\(s\)/);
  assert.match(out!, /2 serious problem\(s\) and 5 warning\(s\)/);
  assert.match(out!, /- There is no sitemap\.xml → fix: Add one/);
  assert.match(out!, /- 6 pages load slowly → fix: Compress/);
  assert.match(out!, /2 hours ago/);
});

test("loadSiteIssues handles an audit that recorded no individual issues", async () => {
  const out = await loadSiteIssues(stub("site_audits", { ...AUDIT, issues: [] }, { single: true }), "t1");
  assert.match(out!, /No individual issues were recorded/);
});

test("loadSiteIssues is null when no audit has ever run", async () => {
  assert.equal(await loadSiteIssues(stub("site_audits", null, { single: true }), "t1"), null);
  assert.equal(await loadSiteIssues(stub("site_audits", AUDIT, { single: true }), null), null);
});

/* ── agoPhrase ────────────────────────────────────────────────────────────────────────────── */

test("agoPhrase reads the past, where untilPhrase would have said 'any moment now'", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  assert.equal(agoPhrase(new Date("2026-09-18T11:59:40Z"), now), "just now");
  assert.equal(agoPhrase(new Date("2026-09-18T11:55:00Z"), now), "5 minutes ago");
  assert.equal(agoPhrase(new Date("2026-09-18T09:00:00Z"), now), "3 hours ago");
  assert.equal(agoPhrase(new Date("2026-09-15T12:00:00Z"), now), "3 days ago");
});
