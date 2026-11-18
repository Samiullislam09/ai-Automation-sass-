/** LIVE check of Phase 2 plumbing against the real model: a yes/no in several languages, and canned Hinglish rewritten into the customer's language.
 *    npx tsx lib/chat-phase2.live.ts      (needs NVIDIA_API_KEY in .env.local; by hand, not CI) */
import { readFileSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch { /* none */ }
}

async function main() {
  const { chatJson } = await import("./chat-llm");
  const { readAnswer, CONFIRM_SLOT } = await import("./chat-conversation");
  const { localizeOrder } = await import("./chat-localize");
  const pending: any = { v: 1, route: "legacy", action: "legacy:unpublish", echo: "Take this article off the live site?", message: "x", legacy: { kind: "unpublish" } };
  const YN: [string, string][] = [
    ["sí, adelante", "yes"], ["no, mejor déjalo", "no"], ["haan kar do", "yes"], ["nahi rehne do", "no"], ["نعم", "yes"], ["না, থাক", "no"],
    ["yes but do not remove it yet", "no"], ["haan lekin abhi mat karna", "no"], ["what is my schedule tomorrow?", "other"],
  ];
  let bad = 0;
  for (const [msg, want] of YN) {
    const r = await readAnswer(msg, pending, CONFIRM_SLOT, chatJson);
    const ok = r?.answer === want;
    if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"}  "${msg}" -> ${r?.answer}  (wanted ${want})`);
  }
  const slotPending: any = { ...pending, echo: "write an article" };
  const v = await readAnswer("pues sobre certificaciones iso", slotPending, "topic", chatJson);
  console.log(`slot: ${JSON.stringify(v)}`);

  const canned = { text: "Ek baar confirm kar dijiye.", event: { title: "Ye article abhi live site se hata dun?", detail: "Ye wapas nahi liya ja sakta, isliye ek baar poochh raha hun.", actions: [{ label: "Haan, karo", action: "confirm", payload: { text: "haan, kar do" } }, { label: "Nahi", action: "cancel", payload: { text: "nahi, rehne do" } }] } };
  for (const msg of ["please take that article down", "retira el artículo de la web", "ye article hata do", "সাইট থেকে আর্টিকেলটি সরাও"]) {
    const o = await localizeOrder(canned, msg);
    console.log(`\n"${msg}"\n  text:   ${o.text}\n  title:  ${o.event?.title}\n  detail: ${o.event?.detail}\n  buttons: ${o.event?.actions?.map((a) => a.label).join(" | ")}`);
  }
  console.log(bad ? `\n${bad} yes/no misread` : "\nAll yes/no read correctly");
  process.exit(bad ? 1 : 0);
}
main();
