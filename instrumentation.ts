/** Runs once when the Next.js server process starts.
 *  On this machine, Node's fetch() tries IPv6 first for external hosts (NVIDIA NIM,
 *  Supabase) and falls back to IPv4 only after a long timeout — adding 15-20s to every
 *  outbound call, even though the same host responds in ~2s over plain IPv4 (curl).
 *  Forcing IPv4-first resolution removes that delay. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dns = await import("dns");
    dns.setDefaultResultOrder("ipv4first");
    console.log("[instrumentation] DNS result order set to ipv4first");
  }
}
