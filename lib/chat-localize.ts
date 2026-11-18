/** lib/chat-localize.ts — system messages in the customer's own language.
 *
 *  The brain's plumbing speaks in fixed Hinglish sentences: "Kis topic pe? Ek line me bata do…", "Main pakka nahi hun — aapka matlab ye hai?",
 *  "Theek hai — nahi kiya.", the card titles and buttons. An English-speaking customer got Hinglish back, a Spanish one even more so — the same
 *  failure the owner named for the WhatsApp assistant. Rather than hand-translating every string into every language (a list that is never
 *  finished), these messages are marked `canned` and passed through here once: the model rewrites them in the language of the customer's own
 *  message, keeping every name, number, time and emoji. If the model is unreachable the original sentence goes out unchanged — a Hinglish
 *  sentence is better than silence. The CARD'S button payloads are not touched: they are what a click sends back, and the follow-up reader
 *  understands any language. */
import { chatJson } from "@/lib/chat-llm";

export type Localizable = {
  text: string;
  event?: { title?: string; detail?: string; actions?: { label: string; action: string; payload?: unknown }[] } & Record<string, unknown>;
};

const SYSTEM = [
  "You rewrite short system messages from a product into the language of the customer's own message.",
  "Rules:",
  "- Detect the language and script of the customer's message (English, Hinglish in Roman letters, Hindi, Urdu, Spanish, Arabic, Bengali, anything) and write EVERY field in that same language and script. If it is plain English, write plain English.",
  "- Keep the meaning exactly. Keep every name, number, date, time, amount, product name and emoji unchanged. Do not add, remove or soften anything, and do not add any promise.",
  "- Keep each field about as short as it was. No greetings, no explanations.",
  "- An empty or missing field stays empty. Button labels stay short (1-3 words).",
  'Reply with ONLY JSON of the same shape: {"text":"...","title":"...","detail":"...","labels":["...", "..."]}',
].join("\n");

/** Rewrite `order` (text, card title/detail, button labels) into the language of `userMessage`. Never throws; returns the input on any failure. */
export async function localizeOrder<T extends Localizable>(
  order: T,
  userMessage: string,
  opts: { chatJsonImpl?: typeof chatJson; text?: boolean; event?: boolean } = {},
): Promise<T> {
  const call = opts.chatJsonImpl ?? chatJson;
  const msg = String(userMessage ?? "").trim();
  if (!msg) return order;
  const doText = opts.text !== false;
  const doEvent = opts.event !== false && !!order.event;
  if (!doText && !doEvent) return order;
  const labels = doEvent ? (order.event?.actions ?? []).map((a) => a.label) : [];
  const payload = { text: doText ? order.text ?? "" : "", title: doEvent ? order.event?.title ?? "" : "", detail: doEvent ? order.event?.detail ?? "" : "", labels };
  if (!payload.text && !payload.title && !payload.detail && !labels.length) return order;
  const out = await call<{ text?: unknown; title?: unknown; detail?: unknown; labels?: unknown }>(
    SYSTEM,
    `CUSTOMER'S MESSAGE:\n${msg.slice(0, 400)}\n\nSYSTEM MESSAGE TO REWRITE (JSON):\n${JSON.stringify(payload)}`,
    { timeoutMs: 5000, maxTokens: 400 },
  );
  if (!out) return order;
  const s = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  const next: T = { ...order, text: doText ? s(out.text, order.text) : order.text };
  if (doEvent && order.event) {
    const outLabels = Array.isArray(out.labels) ? out.labels : [];
    next.event = {
      ...order.event,
      ...(order.event.title ? { title: s(out.title, order.event.title) } : {}),
      ...(order.event.detail ? { detail: s(out.detail, order.event.detail) } : {}),
      ...(order.event.actions ? { actions: order.event.actions.map((a, i) => ({ ...a, label: s(outLabels[i], a.label) })) } : {}),
    };
  }
  return next;
}
