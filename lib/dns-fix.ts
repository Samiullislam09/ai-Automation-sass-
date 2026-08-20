/** Side-effect-only import — forces Node to try IPv4 before IPv6 when resolving hosts.
 *  On this dev machine, fetch() to external hosts (NVIDIA NIM, Supabase) was trying
 *  IPv6 first and timing out for ~15-20s before falling back to IPv4, even though the
 *  same host answers in ~2s over plain IPv4. Import this once at the top of any file
 *  that makes an external fetch() call — Node caches the module, so it only runs once.
 *  (instrumentation.ts alone wasn't reliably firing before every route on this Next
 *  version/setup, so this is the belt-and-suspenders guaranteed fix.) */
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
