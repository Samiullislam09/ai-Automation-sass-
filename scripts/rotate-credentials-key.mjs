#!/usr/bin/env node
/**
 * Rotate CREDENTIALS_ENCRYPTION_KEY without losing anyone's WordPress / webhook / Google
 * credentials.
 *
 * WHY THIS EXISTS. The key was pasted into a chat on 2026-08-27. A key that has been seen
 * is a key that has been leaked — it decrypts every customer's WordPress app password in
 * `integrations.encrypted_credentials`. Rotating means: decrypt every secret with the old
 * key, re-encrypt with a new one, then retire the old one everywhere it is set.
 *
 * USAGE (from the repo root, with the service-role key — this bypasses RLS on purpose):
 *
 *   1. Make a new key:
 *        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   2. Dry run (touches nothing, tells you what it WOULD change):
 *        OLD_KEY=<current 64-hex> NEW_KEY=<new 64-hex> \
 *        NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *        node scripts/rotate-credentials-key.mjs
 *   3. Apply:
 *        ... node scripts/rotate-credentials-key.mjs --apply
 *   4. Set CREDENTIALS_ENCRYPTION_KEY=<new> on Vercel AND Railway (agent-server decrypts
 *      WordPress passwords when it publishes — agent-server/src/lib/publish.ts). Redeploy both.
 *   5. Run once more with --verify and ONLY the new key to prove every secret opens.
 *   6. Delete the old key from .env.local, the chat, and anywhere else it was typed.
 *
 * Between steps 3 and 4 a publish would fail to decrypt (wrong key) — it fails loudly, it
 * does not publish garbage. Do 3 and 4 back to back.
 *
 * The script is idempotent: a value that already opens with NEW_KEY is left alone, so a
 * crash halfway can simply be re-run.
 */
import crypto from "node:crypto";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const oldHex = process.env.OLD_KEY;
const newHex = process.env.NEW_KEY || (VERIFY ? process.env.CREDENTIALS_ENCRYPTION_KEY : undefined);

function die(msg) { console.error("✕ " + msg); process.exit(1); }
if (!url || !svc) die("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!newHex || newHex.length !== 64) die("NEW_KEY must be a 64-char hex string (32 bytes)");
if (!VERIFY && (!oldHex || oldHex.length !== 64)) die("OLD_KEY must be a 64-char hex string (32 bytes)");
if (!VERIFY && oldHex === newHex) die("OLD_KEY and NEW_KEY are the same — that is not a rotation");

const ALGO = "aes-256-gcm";
const key = (hex) => Buffer.from(hex, "hex");
function decrypt(payload, hex) {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  const d = crypto.createDecipheriv(ALGO, key(hex), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(dataB64, "base64")), d.final()]).toString("utf8");
}
function encrypt(plain, hex) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key(hex), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}
// An encrypted value is exactly three base64 parts (iv:tag:ciphertext). Anything else in the
// JSON (siteUrl, username, network) is plaintext by design and must not be touched.
const looksEncrypted = (v) => typeof v === "string" && /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(v) && v.split(":")[0].length >= 12;
const opens = (v, hex) => { try { decrypt(v, hex); return true; } catch { return false; } };

const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
const rest = (path, init) => fetch(url + "/rest/v1/" + path, { ...init, headers: { ...H, ...(init?.headers || {}) } });

const res = await rest("integrations?select=id,tenant_id,type,encrypted_credentials");
if (!res.ok) die(`could not read integrations: ${res.status} ${await res.text()}`);
const rows = await res.json();
console.log(`${rows.length} integration row(s)\n`);

let changed = 0, alreadyNew = 0, unreadable = 0, plain = 0;
for (const row of rows) {
  const creds = row.encrypted_credentials ?? {};
  const next = { ...creds };
  const notes = [];
  for (const [k, v] of Object.entries(creds)) {
    if (!looksEncrypted(v)) { plain++; continue; }
    if (opens(v, newHex)) { alreadyNew++; notes.push(`${k}: ok(new)`); continue; }
    if (VERIFY) { unreadable++; notes.push(`${k}: ✕ DOES NOT OPEN WITH NEW KEY`); continue; }
    if (!opens(v, oldHex)) { unreadable++; notes.push(`${k}: ✕ opens with neither key`); continue; }
    next[k] = encrypt(decrypt(v, oldHex), newHex);
    if (decrypt(next[k], newHex) !== decrypt(v, oldHex)) die(`round-trip mismatch on ${row.id}/${k} — aborting before writing anything`);
    notes.push(`${k}: rotate`);
    changed++;
  }
  console.log(`${row.type.padEnd(12)} ${row.id}  ${notes.join(", ") || "(no encrypted fields)"}`);
  if (APPLY && notes.some((n) => n.endsWith("rotate"))) {
    const up = await rest(`integrations?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ encrypted_credentials: next }), headers: { Prefer: "return=minimal" } });
    if (!up.ok) die(`update failed for ${row.id}: ${up.status} ${await up.text()}`);
  }
}

console.log(`\n${changed} field(s) ${APPLY ? "rotated" : "would be rotated (dry run — add --apply)"}, ${alreadyNew} already on the new key, ${unreadable} unreadable, ${plain} plaintext fields untouched.`);
if (unreadable) { console.error("\n✕ Some secrets could not be opened. Do NOT retire the old key until this is 0."); process.exit(2); }
if (VERIFY) console.log("✓ every encrypted field opens with the new key — the old key can be deleted.");
