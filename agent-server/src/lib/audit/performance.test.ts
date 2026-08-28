import test from "node:test";
import assert from "node:assert/strict";
import { issuesFromVitals, type PageVitals } from "./performance.js";

/** `runPerformanceAudit` itself launches a real Chrome and is not unit-tested (same reason
 *  fetchSite.ts's network calls are not — there is nothing to fixture). `issuesFromVitals` is
 *  the pure half: raw numbers in, the same AuditIssue shape checks.ts uses out. Every threshold
 *  here is web.dev's own published "Good" line, not a number this file invented. */

function vitals(over: Partial<PageVitals> = {}): PageVitals {
  return { url: "https://example.com/", ok: true, performanceScore: 95, lcpMs: 1200, cls: 0.02, tbtMs: 50, ...over };
}

test("a page within Google's 'Good' thresholds produces no issues at all", () => {
  const issues = issuesFromVitals([vitals()]);
  assert.deepEqual(issues, []);
});

test("LCP over 2.5s is its own issue, named for what it is — never called INP or CLS", () => {
  const issues = issuesFromVitals([vitals({ lcpMs: 4000 })]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, "slow-lcp");
  assert.match(issues[0].what, /Largest Contentful Paint/);
});

test("CLS over 0.1 is a separate issue from LCP, both can fire on the same page", () => {
  const issues = issuesFromVitals([vitals({ lcpMs: 4000, cls: 0.3 })]);
  assert.deepEqual(
    issues.map((i) => i.id).sort(),
    ["layout-shift", "slow-lcp"]
  );
});

test("TBT over 200ms is reported as what it is — an interactivity PROXY — never relabelled as real INP", () => {
  const issues = issuesFromVitals([vitals({ tbtMs: 500 })]);
  const found = issues.find((i) => i.id === "slow-interactivity");
  assert.ok(found);
  assert.doesNotMatch(found!.what + found!.fix, /\bINP\b/, "TBT is a lab proxy, not the field metric — the text must never claim otherwise");
});

test("a page that failed to measure is its own issue, distinct from a page that measured badly", () => {
  const issues = issuesFromVitals([vitals({ ok: false, error: "timeout", performanceScore: null, lcpMs: null, cls: null, tbtMs: null })]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, "performance-check-failed");
});

test("counts are exact even when the page sample is capped at 8 in the issue", () => {
  const pages = Array.from({ length: 12 }, (_, i) => vitals({ url: `https://example.com/p${i}`, lcpMs: 5000 }));
  const issues = issuesFromVitals(pages);
  const slow = issues.find((i) => i.id === "slow-lcp")!;
  assert.equal(slow.count, 12);
  assert.equal(slow.pages.length, 8);
});

test("a null LCP (Lighthouse could not compute it) is not silently treated as slow", () => {
  const issues = issuesFromVitals([vitals({ lcpMs: null })]);
  assert.equal(issues.some((i) => i.id === "slow-lcp"), false);
});

test("no pages at all produces no issues, not a crash", () => {
  assert.deepEqual(issuesFromVitals([]), []);
});
