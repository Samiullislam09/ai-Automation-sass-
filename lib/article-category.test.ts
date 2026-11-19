import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestCategory, neighboursOf } from "./article-category";

test("previous / next are the ids on either side in list order, and null at the ends or when the article is not in the list", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(neighboursOf(ids, "b"), { prev: "a", next: "c" });
  assert.deepEqual(neighboursOf(ids, "a"), { prev: null, next: "b" });
  assert.deepEqual(neighboursOf(ids, "c"), { prev: "b", next: null });
  assert.deepEqual(neighboursOf(ids, "zzz"), { prev: null, next: null });
});

test("the category is the cluster whose name or pages share the most words with the keyword; no overlap is null, never a guess", () => {
  const clusters = [
    { name: "ISO certification", page_urls: ["/iso-9001-certification"] },
    { name: "Web design", page_urls: ["/website-design"] },
  ];
  assert.equal(nearestCategory("iso 9001 audit cost", clusters), "ISO certification");
  assert.equal(nearestCategory("pizza recipes", clusters), null);
  assert.equal(nearestCategory(null, clusters), null);
  assert.equal(nearestCategory("iso", []), null);
});
