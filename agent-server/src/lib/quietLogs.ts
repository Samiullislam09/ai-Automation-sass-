/** Keep secrets out of the logs.
 *
 *  libsignal (inside Baileys) prints the whole session object with console.info whenever it closes or opens a
 *  session: "Closing session: SessionEntry { ... privKey: <Buffer ...> ... rootKey ... }". Those are PRIVATE ENCRYPTION KEYS
 *  of a customer's WhatsApp conversations, and Railway keeps and shows logs. Nothing in this project needs those
 *  lines, so they are dropped before they reach the log. Import this file first, before anything that logs. */

const NOISY = /^(Closing|Opening|Removing|Migrating)\b[^\n]*\bsession/i;

function wrap(level: "log" | "info" | "warn" | "debug"): void {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && NOISY.test(args[0])) return;
    original(...args);
  };
}

for (const level of ["log", "info", "warn", "debug"] as const) wrap(level);

export const isSecretSessionLog = (first: unknown): boolean => typeof first === "string" && NOISY.test(first);
