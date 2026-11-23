/** Run: cd agent-server && npx tsx --test src/lib/leads/queryExpand.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { __resetExpandCache, buildExpandPrompt, expandTerms, validateTerms } from "./queryExpand.js";

test("validateTerms drops digits, places, sentences, tiny/huge phrases and anything already had", () => {
  const out = validateTerms(
    {
      terms: [
        "factories",
        "Manufacturers", // already have
        "metal fabricators",
        "top 10 factories", // digit
        "steel mills in Dubai", // a place slipped in
        "ab", // too short
        "we are a large group of many different kinds of industrial firms", // sentence
        "factories", // duplicate
        42, // not a string
      ],
    },
    ["manufacturers"],
  );
  assert.deepEqual(out, ["factories", "metal fabricators"]);
});

test("validateTerms is safe on garbage", () => {
  assert.deepEqual(validateTerms(null, []), []);
  assert.deepEqual(validateTerms({ terms: "nope" }, []), []);
  assert.deepEqual(validateTerms("text", []), []);
});

test("validateTerms caps at 10", () => {
  const terms = Array.from({ length: 30 }, (_, i) => `industrial sector ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
  assert.equal(validateTerms({ terms }, []).length, 10);
});

test("expandTerms returns validated phrases, and a model failure means no expansion, not an error", async () => {
  __resetExpandCache();
  const ok = await expandTerms({ segment: "Manufacturers", have: ["Manufacturers"] }, async () => ({ terms: ["factories", "exporters"] }));
  assert.deepEqual(ok, ["factories", "exporters"]);

  __resetExpandCache();
  const failed = await expandTerms({ segment: "Hotels" }, async () => {
    throw new Error("model down");
  });
  assert.deepEqual(failed, []);
});

test("expandTerms asks the model once per segment+offer", async () => {
  __resetExpandCache();
  let calls = 0;
  const llm = async () => {
    calls++;
    return { terms: ["factories"] };
  };
  await expandTerms({ segment: "Manufacturers", offer: "ISO certification" }, llm);
  await expandTerms({ segment: "Manufacturers", offer: "ISO certification" }, llm);
  assert.equal(calls, 1);
});

test("the prompt tells the model to return buyers only, no places, no sellers of the offer", () => {
  const p = buildExpandPrompt("Manufacturers", "they need certification", "ISO consulting", ["Manufacturers"]);
  assert.match(p, /NO place names/);
  assert.match(p, /Never a phrase for organisations that SELL our offer/);
  assert.match(p, /ISO consulting/);
});
