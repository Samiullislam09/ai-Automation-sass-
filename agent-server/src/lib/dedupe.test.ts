/** Run: cd agent-server && npx tsx --test src/lib/dedupe.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

// dedupe.ts imports the Supabase client, which reads env.ts, which THROWS on a missing
// DATABASE_URL/SUPABASE_URL rather than failing later and mysteriously. That is the right
// behaviour for a server and the wrong behaviour for a unit test of two pure functions, so
// the placeholders go in first and the module is imported dynamically after them. Nothing
// here touches the network or the database: only slugify() and slugOfUrl() are exercised.
process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { slugify, slugOfUrl } = await import("./dedupe.js");

test("slugify: the ordinary case", () => {
  assert.equal(slugify("ISO 9001 Certification Cost in India"), "iso-9001-certification-cost-in-india");
  assert.equal(slugify("  Leading   spaces and  doubles  "), "leading-spaces-and-doubles");
});

test("slugify: punctuation splits, apostrophes join", () => {
  // "company's" must not become "company-s" — that is a different URL to every reader.
  assert.equal(slugify("A company's guide to ISO 27001"), "a-companys-guide-to-iso-27001");
  assert.equal(slugify("A company’s guide"), "a-companys-guide");
  assert.equal(slugify("What is ISO 9001? (And why bother)"), "what-is-iso-9001-and-why-bother");
  assert.equal(slugify("Before / After: our audit process"), "before-after-our-audit-process");
  assert.equal(slugify("--- leading and trailing ---"), "leading-and-trailing");
  assert.equal(slugify("Cost: $500 — worth it?"), "cost-500-worth-it");
});

test("slugify: & becomes and, so the two spellings collide", () => {
  assert.equal(slugify("Sales & Marketing"), slugify("Sales and Marketing"));
  assert.equal(slugify("Sales & Marketing"), "sales-and-marketing");
});

test("slugify: accented Latin folds to ASCII", () => {
  assert.equal(slugify("Café management für Anfänger"), "cafe-management-fur-anfanger");
  // The accented and unaccented spellings are one page, and must therefore be one slug.
  assert.equal(slugify("Résumé"), slugify("Resume"));
  assert.equal(slugify("Ångström measurements"), "angstrom-measurements");
});

test("slugify: a script we cannot transliterate yields an empty slug, not hyphens", () => {
  // "" is the honest answer: there is no slug lock for this title. It must never be "-" or
  // "---", because two unrelated Hindi titles would then collide on the same slug.
  assert.equal(slugify("आईएसओ प्रमाणन"), "");
  assert.equal(slugify("中文标题"), "");
  assert.equal(slugify("!!! ??? ---"), "");
  assert.equal(slugify(""), "");
  assert.equal(slugify("   "), "");
  assert.equal(slugify(null), "");
  assert.equal(slugify(undefined), "");
  // Mixed: the Latin half survives, the rest is dropped.
  assert.equal(slugify("ISO 9001 प्रमाणन"), "iso-9001");
});

test("slugify: emoji and symbols are separators, never content", () => {
  assert.equal(slugify("Our new office 🎉 is open"), "our-new-office-is-open");
  assert.equal(slugify("100% pass rate"), "100-pass-rate");
});

test("slugify: a very long title is cut at a word boundary, never mid-word", () => {
  const title =
    "The complete and utterly exhaustive guide to ISO 27001 information security management " +
    "certification for small and medium businesses in India and the United Arab Emirates";
  const slug = slugify(title);

  assert.ok(slug.length <= 80, `slug was ${slug.length} chars: ${slug}`);
  assert.ok(!slug.startsWith("-") && !slug.endsWith("-"), `slug has a dangling hyphen: ${slug}`);
  // Every piece of the slug must be a whole word from the title.
  const words = new Set(title.toLowerCase().split(/[^a-z0-9]+/));
  for (const part of slug.split("-")) assert.ok(words.has(part), `"${part}" is not a whole word from the title`);

  // A title long enough to be cut exactly on a hyphen still leaves no trailing hyphen.
  const eighty = "a".repeat(78) + " tail";
  assert.equal(slugify(eighty), "a".repeat(78));
});

test("slugify: a single word longer than the cap is truncated rather than lost", () => {
  const long = "x".repeat(120);
  const slug = slugify(long);
  assert.equal(slug.length, 80);
  assert.equal(slug, "x".repeat(80));
});

test("slugify: stable and idempotent — the same title always gives the same slug", () => {
  const title = "ISO 27001: Gap Audit & Certification (2026)";
  const once = slugify(title);
  assert.equal(slugify(title), once);
  // Feeding a slug back through must not change it; the lock compares stored slugs to
  // freshly-computed ones, so any drift here would be a phantom duplicate.
  assert.equal(slugify(once), once);
});

test("slugOfUrl: the last path segment, whatever the URL is wearing", () => {
  assert.equal(slugOfUrl("https://example.com/iso-9001-cost"), "iso-9001-cost");
  assert.equal(slugOfUrl("https://example.com/services/iso-9001-cost/"), "iso-9001-cost");
  assert.equal(slugOfUrl("https://example.com/iso-9001-cost.html"), "iso-9001-cost");
  assert.equal(slugOfUrl("https://example.com/iso-9001-cost.php?utm_source=x"), "iso-9001-cost");
  assert.equal(slugOfUrl("https://example.com/blog/ISO-9001-Cost#section"), "iso-9001-cost");
  assert.equal(slugOfUrl("/services/iso-9001-cost/"), "iso-9001-cost");
  // Percent-encoded segments decode before comparison, so /caf%C3%A9 matches the title "Café".
  assert.equal(slugOfUrl("https://example.com/caf%C3%A9"), "cafe");
  // The homepage has no segment — and therefore no slug to collide with.
  assert.equal(slugOfUrl("https://example.com/"), "");
  assert.equal(slugOfUrl("https://example.com"), "");
  assert.equal(slugOfUrl(""), "");
  assert.equal(slugOfUrl(null), "");
});

test("slugOfUrl and slugify agree — lock 1 compares their outputs directly", () => {
  assert.equal(slugOfUrl("https://example.com/services/iso-9001-cost"), slugify("ISO 9001 Cost"));
});
