import { test } from "node:test";
import assert from "node:assert/strict";
import { authUser } from "./auth-user";

function fake(o: { claims?: any; claimsError?: any; claimsThrows?: boolean; user?: any }) {
  const calls = { getClaims: 0, getUser: 0 };
  const client: any = {
    auth: {
      async getClaims() { calls.getClaims++; if (o.claimsThrows) throw new Error("boom"); return { data: o.claims ? { claims: o.claims } : null, error: o.claimsError ?? null }; },
      async getUser() { calls.getUser++; return { data: { user: o.user ?? null } }; },
    },
  };
  return { client, calls };
}

test("a valid session is read from its JWT: no call to the Auth server", async () => {
  const { client, calls } = fake({ claims: { sub: "u1", email: "a@b.co" } });
  assert.deepEqual(await authUser(client), { id: "u1", email: "a@b.co" });
  assert.equal(calls.getUser, 0, "the whole point: no network round trip");
});

test("when the JWT cannot be read the server is asked, so the worst case is the old behaviour", async () => {
  for (const o of [{ claimsThrows: true }, { claimsError: new Error("x") }, { claims: { email: "no-sub@x.co" } }]) {
    const { client, calls } = fake({ ...o, user: { id: "u2", email: "c@d.co" } });
    assert.deepEqual(await authUser(client), { id: "u2", email: "c@d.co" });
    assert.equal(calls.getUser, 1);
  }
});

test("nobody signed in stays nobody: never a made-up user", async () => {
  const { client } = fake({});
  assert.equal(await authUser(client), null);
});
