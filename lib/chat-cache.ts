import { createHash } from "node:crypto";

/** A small in-process cache for the things the chat re-reads on every single message.
 *
 *  MEASURED, NOT GUESSED. With the database reads already running in parallel, a warm reply
 *  broke down like this on a real signed-in request:
 *
 *      auth          615-680ms   ← auth.getUser() then the memberships row, strictly serial
 *      conversation  +200-400ms  ← "does this thread exist and is it mine"
 *      context       (same window, parallel)
 *      stream open   +280ms
 *      first word    ~1.5s total
 *
 *  Two thirds of that is re-establishing facts that did not change since the previous
 *  message thirty seconds ago: who you are, which workspace you own, what your business is,
 *  what your schedule says. Caching them takes a warm reply down to roughly the model's own
 *  latency, which is the floor.
 *
 *  WHAT IS AND ISN'T SAFE TO CACHE.
 *  · The auth entry is keyed by a hash of the session cookie itself. A different (or expired,
 *    or forged) token is a different key and gets a real verification. Signing out rotates the
 *    cookie, so the old entry can never be reached again. The token is never stored — only its
 *    SHA-256 — and the TTL is deliberately shorter than a Supabase access token's lifetime.
 *  · Recent work has a very short TTL, because "kya update hai" must not answer with a job
 *    list from a minute ago. Five seconds is already inside the dashboard's own 4s poll, so
 *    the chat can never be more stale than the office the user is looking at.
 *  · Nothing here is shared between tenants: every key includes the tenant id.
 *
 *  This is per-process. On serverless that means per warm instance, which is exactly the case
 *  a conversation hits — a cold instance simply does the work.
 */

type Entry<T> = { value: T; expires: number };

const store = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

// A conversation is a handful of keys; this only exists so a long-lived process cannot grow
// without bound. Oldest-inserted goes first — Map preserves insertion order.
const MAX_ENTRIES = 500;

function evictIfNeeded() {
  if (store.size <= MAX_ENTRIES) return;
  const drop = store.size - MAX_ENTRIES;
  let i = 0;
  for (const k of Array.from(store.keys())) {
    store.delete(k);
    if (++i >= drop) break;
  }
}

/** Drop an entry the moment the thing behind it changes.
 *
 *  Every TTL here is a bet that the underlying fact did not change, and the bet is sound right
 *  up until the chat itself changes it. Someone who says "roz 9 baje kar do" and then asks
 *  "kab chalta hai?" ten seconds later would be told the OLD time — by the same conversation
 *  that just changed it — for the rest of the schedule TTL. A stale answer to a question the
 *  user is asking precisely to check your work is worse than no cache at all.
 *
 *  Any in-flight load is dropped too: it was started against the old state and would otherwise
 *  land afterwards and reinstate it. */
export function invalidate(key: string) {
  store.delete(key);
  inFlight.delete(key);
}

/** Read through the cache, collapsing concurrent misses onto one load. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const running = inFlight.get(key);
  if (running) return running as Promise<T>;

  const p = (async () => {
    try {
      const value = await load();
      store.set(key, { value, expires: Date.now() + ttlMs });
      evictIfNeeded();
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

export function forget(prefix: string) {
  for (const k of Array.from(store.keys())) if (k.startsWith(prefix)) store.delete(k);
}

/** The cache key for a session. Built from the Supabase auth cookies only, so an unrelated
 *  cookie changing (a theme preference, an analytics id) cannot invalidate it. */
export function sessionKey(cookies: { name: string; value: string }[]): string | null {
  const auth = cookies
    .filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
    .join("|");
  if (!auth) return null;
  return "sess:" + createHash("sha256").update(auth).digest("hex").slice(0, 32);
}

export const TTL = {
  /** Shorter than a Supabase access token's own lifetime, so an expiring session is
   *  re-verified rather than ridden out. */
  session: 60_000,
  /** Onboarding answers and crawled page titles. These change when someone edits their
   *  profile, which is not something they then immediately ask the chat about. */
  business: 120_000,
  /** Edited on the Schedule page, and the page reloads its own copy from the API afterwards. */
  schedule: 60_000,
  /** Job status. Deliberately tiny — see the note above. */
  work: 5_000,
  /** "This conversation exists and belongs to this tenant." Only ever more true with time;
   *  a deleted thread returns 404 from its own route and the panel starts a new one. */
  conversation: 300_000,
};
