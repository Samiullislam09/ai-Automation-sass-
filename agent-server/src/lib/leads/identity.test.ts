/** Run: cd agent-server && npx tsx --test src/lib/leads/identity.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { senderIdentity } from "./identity.js";
import { buildSignature } from "./compliance.js";

const tenant = { name: "heysamiul09", website_url: "https://wca-global.com", icp_profile: {} };

test("Site Brain's 'Your name' is the person the message is from", () => {
  const id = senderIdentity(tenant, "Samiul");
  assert.equal(id.personName, "Samiul");
  assert.equal(id.businessName, "wca-global.com", "the business is the website, not the account username");
  assert.equal(buildSignature(id).split("\n")[0], "— Samiul, wca-global.com");
  assert.ok(!buildSignature(id).includes("https://wca-global.com"), "the address is not repeated under the business name");
});

test("no name in Site Brain: the older onboarding answer is used, and with neither there is no person", () => {
  assert.equal(senderIdentity({ ...tenant, icp_profile: { contact_name: "Sami" } }, null).personName, "Sami");
  assert.equal(senderIdentity({ ...tenant, icp_profile: { contact_name: "Sami" } }, "Samiul").personName, "Samiul", "Site Brain wins");
  assert.equal(senderIdentity(tenant, null).personName, null);
  assert.equal(senderIdentity(tenant, "   ").personName, null, "blank is empty");
  assert.equal(senderIdentity(null, undefined).businessName, "our team");
});
