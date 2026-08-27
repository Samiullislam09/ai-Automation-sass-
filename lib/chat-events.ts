/**
 * lib/chat-events.ts — the chat's SYSTEM channel, as data.
 *
 * The rule this file exists to make structural (docs/MASTER_PLAN.html §10 rule 1, §3 principle 3):
 *
 *     The model's prose and the system's facts are two different channels,
 *     and they must never be mixed.
 *
 *   · Channel 1 — model text. An ordinary assistant bubble. It may explain, ask, chat. It is
 *     NEVER the thing that claims an action happened. (route.ts already strips ticks and
 *     fabricated "queued for…" openings; this file is the other half of that defence.)
 *   · Channel 2 — system. A card built from a `SystemCard` value that something with evidence
 *     produced: a job row, an accepted enqueue, a saved order, a publish result.
 *
 * Nothing here reads model text. `channelOf()` decides which channel a message belongs to by
 * looking at whether it carries a valid `SystemCard` — never by what any string says. That is
 * what lib/chat-events.test.ts guards: "published", "booked", "✓ done" in a reply stay model
 * text forever, because the model has no way to produce a card.
 *
 * Framework-free on purpose (no React, no next/*): app/api/chat/route.ts imports the event
 * shape from here so the server and the browser agree on one contract.
 *
 * PHASE 1: when the brain starts emitting real events (`task_events` / Realtime broadcast),
 * only `cardFromResponse` and `cardFromServerEvent` below change — the renderer does not.
 */

/** What a system card can say. Anything outside this list is not a system fact we can draw. */
export type SystemKind =
  | "booked"        // written to the DB, will run later — "Booked · 5:10 PM (in 39 min)"
  | "running"       // a job was really accepted and is on — "Mr. Keyword running"
  | "progress"      // a running job reporting a step — "section 3/5"
  | "done"          // it finished, and this is what came out
  | "failed"        // it stopped, this is why, and here is the next step
  | "needs_confirm" // irreversible: the echo line + Haan/Nahi
  | "info";         // a settings change, a cancellation — true, but nothing is running

/** Status colour, in the dashboard's existing token vocabulary (--grn/--amb/--red/--mut2). */
export type SystemTone = "ok" | "warn" | "err" | "info";

export type SystemActionKind = "retry" | "cancel" | "confirm" | "open";

export type SystemAction = {
  label: string;
  action: SystemActionKind;
  /** Free-form, read only by the handler for that action kind. `{ text }` is re-sent as chat. */
  payload?: Record<string, any>;
};

export type SystemCard = {
  /** Stable per fact, so the same job can never be announced twice. */
  id: string;
  kind: SystemKind;
  /** One line, user language. "Booked", "Published", not "Enqueued". */
  title: string;
  /** Optional second line. May be markdown — the renderer runs it through the same markdown
   *  pass as a chat bubble, which is how Mr. Keyword's options table survives. */
  detail?: string;
  /** Agent id (AGENTS[].id — "kw", "writer", …). Draws the chip and picks the live line. */
  agent?: string;
  /** The task/job this card is about. Phase 1: the `tasks` row id. */
  task_id?: string;
  href?: { label: string; url: string };
  actions?: SystemAction[];
  /** Epoch ms. Drives the elapsed timer on a running card. */
  at: number;
};

const KINDS: ReadonlySet<string> = new Set<SystemKind>([
  "booked", "running", "progress", "done", "failed", "needs_confirm", "info",
]);

const ACTION_KINDS: ReadonlySet<string> = new Set<SystemActionKind>(["retry", "cancel", "confirm", "open"]);

export const isSystemKind = (v: unknown): v is SystemKind => typeof v === "string" && KINDS.has(v);

/** The only gate into the system channel.
 *
 *  A string that looks like a receipt is not a receipt. Everything the renderer treats as a
 *  system fact has to pass this, and only code holding real evidence builds one. */
export function isSystemCard(v: unknown): v is SystemCard {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  if (typeof c.id !== "string" || !c.id) return false;
  if (!isSystemKind(c.kind)) return false;
  if (typeof c.title !== "string" || !c.title.trim()) return false;
  if (typeof c.at !== "number" || !Number.isFinite(c.at)) return false;
  if (c.detail != null && typeof c.detail !== "string") return false;
  if (c.agent != null && typeof c.agent !== "string") return false;
  if (c.task_id != null && typeof c.task_id !== "string") return false;
  if (c.href != null) {
    const h = c.href as Record<string, unknown>;
    if (!h || typeof h !== "object" || typeof h.label !== "string" || typeof h.url !== "string") return false;
  }
  if (c.actions != null) {
    if (!Array.isArray(c.actions)) return false;
    for (const a of c.actions) {
      if (!a || typeof a !== "object") return false;
      if (typeof (a as any).label !== "string") return false;
      if (!ACTION_KINDS.has((a as any).action)) return false;
    }
  }
  return true;
}

/* ── Which channel is this message on? ───────────────────────────────────────────────── */

export type Channel = "system" | "model" | "user";

/** THE test-guarded function.
 *
 *  It looks at structure, never at words. A bot reply that opens "✓ Published — it's live at
 *  https://…" is model text, and is drawn as an ordinary bubble, because the model cannot
 *  attach a SystemCard to anything. */
export function channelOf(
  m: { who?: string; card?: unknown; [key: string]: unknown } | null | undefined
): Channel {
  if (!m || typeof m !== "object") return "model";
  if (isSystemCard((m as any).card)) return "system";
  return m.who === "me" ? "user" : "model";
}

/* ── Presentation helpers (data → tokens, still framework-free) ───────────────────────── */

export function toneOf(kind: SystemKind): SystemTone {
  switch (kind) {
    case "done":
    case "booked": return "ok";
    case "failed": return "err";
    case "needs_confirm": return "warn";
    default: return "info"; // running, progress, info
  }
}

/** A glyph, not an emoji — the UI audit (§23.1) counted 83 emoji-as-icons as a defect.
 *  `running`/`progress` return "" because they draw a CSS spinner instead. */
export function iconOf(kind: SystemKind): string {
  switch (kind) {
    case "done": return "✓";
    case "failed": return "✕";
    case "booked": return "◷";
    case "needs_confirm": return "?";
    case "running":
    case "progress": return "";
    default: return "•";
  }
}

/** True while a card is expected to keep changing (spinner + ticking timer). */
export const isLiveKind = (kind: SystemKind) => kind === "running" || kind === "progress";

/** "0:07", "4:31", "1:02:03". Fixed shape so the timer never reflows the card. */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/* ── Adapters: today's payloads → SystemCard ─────────────────────────────────────────────
 *
 * Everything below is the seam. Today the server has no event stream: it hands the browser a
 * few response headers, and components/LiveAgents.tsx turns finished jobs_log rows into
 * notices. Both are converted here and nowhere else, so Phase 1 replaces this section — not
 * the renderer, not the store, not the panel.
 */

/** The wire shape carried on `X-Run-Event` (and, in Phase 1, by the brain's event stream).
 *  `id` and `at` are filled in by the adapter if the producer didn't send them. */
export type SystemEventPayload = {
  kind: SystemKind;
  title: string;
  detail?: string;
  agent?: string;
  task_id?: string;
  href?: { label: string; url: string };
  actions?: SystemAction[];
  id?: string;
  at?: number;
};

let seq = 0;
const nextId = (prefix: string) => `${prefix}:${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** A structured event from the server → a card. Returns null for anything malformed: a card
 *  that cannot be trusted must not be drawn, because on this channel being drawn means "this
 *  really happened". */
export function cardFromServerEvent(raw: unknown, at = Date.now()): SystemCard | null {
  let ev: any = raw;
  if (typeof ev === "string") {
    try { ev = JSON.parse(ev); } catch { return null; }
  }
  if (!ev || typeof ev !== "object") return null;
  const card: SystemCard = {
    id: typeof ev.id === "string" && ev.id ? ev.id : nextId(`ev:${ev.kind ?? "x"}`),
    kind: ev.kind,
    title: typeof ev.title === "string" ? ev.title.trim() : "",
    detail: typeof ev.detail === "string" && ev.detail.trim() ? ev.detail.trim() : undefined,
    agent: typeof ev.agent === "string" && ev.agent ? ev.agent : undefined,
    task_id: typeof ev.task_id === "string" && ev.task_id ? ev.task_id : undefined,
    href: ev.href && typeof ev.href.url === "string"
      ? { label: typeof ev.href.label === "string" && ev.href.label ? ev.href.label : "Open", url: ev.href.url }
      : undefined,
    actions: Array.isArray(ev.actions) ? ev.actions.filter((a: any) => a && ACTION_KINDS.has(a.action) && typeof a.label === "string") : undefined,
    at: typeof ev.at === "number" && Number.isFinite(ev.at) ? ev.at : at,
  };
  if (card.actions && !card.actions.length) card.actions = undefined;
  return isSystemCard(card) ? card : null;
}

/** Today's accepted-order headers.
 *
 *  `X-Run-Agent` / `X-Run-Job` / `X-Run-Label` are set by app/api/chat/route.ts ONLY when
 *  enqueueAgentJob really returned a job id (see OrderResult there) — a refused order carries
 *  none of them, which is why a card can never claim work that was not started. */
export function cardFromRun(
  run: { agent?: string | null; job?: string | null; label?: string | null },
  at = Date.now()
): SystemCard | null {
  const agent = run.agent?.trim();
  if (!agent) return null;
  const label = run.label?.trim();
  return {
    id: run.job ? `run:${run.job}` : nextId(`run:${agent}`),
    kind: "running",
    title: "Started",
    detail: label || undefined,
    agent,
    task_id: run.job ?? undefined,
    at,
  };
}

/** One place that reads a chat response. Prefers a structured event; falls back to the three
 *  run headers that exist today. Takes anything with a `get` so it is testable without fetch. */
export function cardFromResponse(headers: { get(name: string): string | null }, at = Date.now()): SystemCard | null {
  const rawEvent = headers.get("X-Run-Event");
  if (rawEvent) {
    let text = rawEvent;
    try { text = decodeURIComponent(rawEvent); } catch { /* header was not encoded — use as-is */ }
    const card = cardFromServerEvent(text, at);
    if (card) return card;
  }
  const label = headers.get("X-Run-Label");
  let decodedLabel = label;
  if (label) { try { decodedLabel = decodeURIComponent(label); } catch { /* keep raw */ } }
  return cardFromRun({ agent: headers.get("X-Run-Agent"), job: headers.get("X-Run-Job"), label: decodedLabel }, at);
}

/** A finished jobs_log row, as components/LiveAgents.tsx announces it.
 *
 *  The text is ours, not the model's: it is built from `j.summary` on a row that exists. The
 *  leading "Mr. Writer — " is peeled off only when the notice also carries the agent id, so
 *  the name becomes a chip instead of being repeated in the title. */
export function cardFromNotice(
  n: { id: string; text: string; tone?: "done" | "error" | string; agentId?: string | null },
  at = Date.now()
): SystemCard {
  const lines = String(n.text ?? "").split("\n");
  const head = (lines.shift() ?? "").trim();
  const stripped = n.agentId ? head.replace(/^[^—\n]{1,28}—\s*/, "") : head;
  const failed = n.tone === "error";
  return {
    id: `notice:${n.id}`,
    kind: failed ? "failed" : "done",
    title: stripped.trim() || (failed ? "Stopped" : "Done"),
    detail: lines.join("\n").trim() || undefined,
    agent: n.agentId ?? undefined,
    at,
  };
}

/** A `kind: "event"` row replayed from the stored transcript (migration 013). Same shape as a
 *  notice; it is the same fact, written down. */
export function cardFromStoredEvent(
  m: { id?: string; content: string; tone?: string | null; at?: number },
  at = Date.now()
): SystemCard {
  // Rows written before the card existed start with the ✓/✕ this UI used to glue on. The mark
  // is the card's icon now, so an old row loses its prefix rather than showing it twice.
  const content = String(m.content ?? "").replace(/^\s*[✓✔✅✕✖❌]\s*/, "");
  return cardFromNotice(
    { id: m.id ?? `stored-${content.slice(0, 40)}`, text: content, tone: m.tone === "error" ? "error" : "done" },
    m.at ?? at
  );
}

/** The reply itself never arrived (commit 9bb2055's try/catch/finally).
 *
 *  "The connection dropped" is a system fact about this app, not something Mr Lxwa should be
 *  made to say in the first person — and the Retry belongs next to the reason. The payload is
 *  the exact text to re-send, so the retry path stays "send that message again". */
export function cardFromStreamFailure(reason: string, retryOf: string, at = Date.now()): SystemCard {
  return {
    id: nextId("chatfail"),
    kind: "failed",
    title: "Reply didn't arrive",
    detail: reason?.trim() || "network error",
    actions: retryOf ? [{ label: "Retry", action: "retry", payload: { text: retryOf } }] : undefined,
    at,
  };
}

/** Echo-before-irreversible (§10 rule 2). No producer on the server yet — the brain sends this
 *  in Phase 1 — but the shape and the renderer are here so that day is a one-line change. */
export function cardNeedsConfirm(
  echo: string,
  opts: { id?: string; task_id?: string; agent?: string; confirmText?: string; cancelText?: string; at?: number } = {}
): SystemCard {
  return {
    id: opts.id ?? nextId("confirm"),
    kind: "needs_confirm",
    title: echo,
    detail: "This one can't be undone, so I'm asking first.",
    agent: opts.agent,
    task_id: opts.task_id,
    actions: [
      { label: "Haan, karo", action: "confirm", payload: { text: opts.confirmText ?? "haan, kar do" } },
      { label: "Nahi", action: "cancel", payload: { text: opts.cancelText ?? "nahi, rehne do" } },
    ],
    at: opts.at ?? Date.now(),
  };
}
