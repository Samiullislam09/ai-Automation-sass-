import dns from "dns";

/** This dev machine resolves hostnames IPv6-first, which adds real latency (sometimes
 *  several seconds) before a TCP connection even starts — the same issue diagnosed in
 *  the main Next.js app (see lib/dns-fix.ts there). It was never imported into
 *  agent-server before because Redis/DataForSEO/NVIDIA calls had generous timeouts that
 *  usually absorbed it — but pg-boss's Postgres pool has a much tighter 10s connection
 *  timeout by default, so the same latency here showed up as real
 *  "timeout exceeded when trying to connect" errors. Side-effect-only import — safe in
 *  any plain Node.js process (agent-server has no Edge runtime to worry about). */
dns.setDefaultResultOrder("ipv4first");
