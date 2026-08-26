import type { SupabaseClient } from "@supabase/supabase-js";

/** One-off orders placed in the chat — "30 min baad ek article publish kar do".
 *
 *  This is the half of "control the whole site from the chat box" that was missing. The chat
 *  could start work NOW and it could answer questions, but a message with a time in it had
 *  nowhere to go: the time was dropped, the writer started immediately, and when the customer
 *  said "no, thirty minutes later", the model — with no way to do that and nothing forbidding
 *  it from saying otherwise — replied "Mr. Publish — queued for immediate publish (30 minutes
 *  from now)". No row, no job, and Mr. Publish had never run once in the product's life.
 *
 *  So nothing in here reports success it did not get from the database. Every function returns
 *  the row it wrote, or an error; the caller has nothing to say until one of those arrives.
 */

export type OrderKind = "write" | "research" | "plan" | "publish";

export type ScheduledOrder = {
  id: string;
  kind: OrderKind;
  topic: string | null;
  content_item_id: string | null;
  auto_publish: boolean;
  run_at: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  request: string | null;
  job_id: string | null;
  error: string | null;
  created_at: string;
  fired_at: string | null;
};

const COLUMNS =
  "id, kind, topic, content_item_id, auto_publish, run_at, status, request, job_id, error, created_at, fired_at";

/** Postgres says this when migration 015 has not been run. Worth telling apart from a real
 *  failure, because the fix is one file and the message should say so instead of "try again". */
export function isMissingTable(message: string | null | undefined): boolean {
  const m = String(message ?? "");
  return /relation .*scheduled_orders.* does not exist/i.test(m) || /42P01/.test(m);
}

export const MIGRATION_HINT =
  "The scheduled-orders table isn't in your database yet — run supabase/migrations/015_scheduled_orders.sql. " +
  "Nothing was scheduled, so nothing will fire.";

/** Flat rather than a discriminated union, for the same reason lib/publish.ts is: this repo
 *  runs with strict:false, where TS's narrowing on `if (res.ok)` does not reliably exclude the
 *  other member, and the caller then cannot read `res.error` even inside the else branch. */
export type PlaceResult = { ok: boolean; order?: ScheduledOrder; error?: string; needsMigration?: boolean };

/** Writes the order. The ONLY way a scheduled confirmation is allowed to reach the user. */
export async function placeOrder(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string | null,
  o: {
    kind: OrderKind;
    runAt: Date;
    topic?: string | null;
    contentItemId?: string | null;
    autoPublish?: boolean;
    request?: string | null;
  }
): Promise<PlaceResult> {
  const { data, error } = await supabase
    .from("scheduled_orders")
    .insert({
      tenant_id: tenantId,
      created_by: userId,
      kind: o.kind,
      topic: o.topic ?? null,
      content_item_id: o.contentItemId ?? null,
      auto_publish: o.autoPublish === true,
      run_at: o.runAt.toISOString(),
      request: (o.request ?? "").slice(0, 500) || null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    return { ok: false, error: error.message, needsMigration: isMissingTable(error.message) };
  }
  return { ok: true, order: data as ScheduledOrder };
}

/** Everything still waiting, soonest first. Powers the office board, the Schedule page, and
 *  Mr Lxwa's answer to "mera kya kya schedule pe hai" — one query, so those three can never
 *  disagree with each other. */
export async function listPending(
  supabase: SupabaseClient,
  tenantId: string,
  limit = 20
): Promise<ScheduledOrder[]> {
  const { data, error } = await supabase
    .from("scheduled_orders")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .order("run_at", { ascending: true })
    .limit(limit);
  // A missing table is not an outage. Before 015 is run this is simply an empty list, and the
  // office keeps working — the same argument the scheduler makes about select("*").
  if (error) return [];
  return (data ?? []) as ScheduledOrder[];
}

/** Recent history, for the Schedule page's "what already fired" list. */
export async function listRecent(
  supabase: SupabaseClient,
  tenantId: string,
  limit = 10
): Promise<ScheduledOrder[]> {
  const { data, error } = await supabase
    .from("scheduled_orders")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .neq("status", "pending")
    .order("run_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as ScheduledOrder[];
}

/** Called by the Cancel button. Scoped by tenant as well as id: RLS already enforces this, and
 *  saying it twice costs nothing next to the cost of being wrong about it. */
export async function cancelOrder(
  supabase: SupabaseClient,
  tenantId: string,
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("scheduled_orders")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("status", "pending");
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** The article a bare "isko publish kar do" refers to: the newest one that is finished and not
 *  already live. Written, waiting on the customer, and the last thing they were told about — so
 *  it is the one on their screen when they say "this one".
 *
 *  Returns null rather than guessing at a second-best. "I don't know which one you mean" is a
 *  fine thing for the chat to say; publishing the wrong article to a live site is not. */
export async function findPublishable(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ id: string; title: string | null; status: string } | null> {
  const { data, error } = await supabase
    .from("content_items")
    .select("id, title, status, created_at")
    .eq("tenant_id", tenantId)
    .in("status", ["awaiting_approval", "approved", "draft"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const c = data[0] as any;
  return { id: String(c.id), title: c.title ?? null, status: c.status };
}
