/** lib/schedule-time.ts — the pure date and schedule maths, with NO server-only imports.
 *
 *  WHY IT IS ITS OWN FILE. These helpers used to live in lib/chat-context.ts, which two CLIENT
 *  components import `humanTime` from. On 2026-09-18 chat-context gained one server-side import
 *  (`resolveWebsiteUrl` → lib/crawl → lib/dns-fix → node:dns) and `next build` immediately failed
 *  with "Module not found: Can't resolve 'dns'" — a client bundle cannot contain node:dns, and
 *  webpack follows the whole import chain, not just the symbol that was asked for.
 *
 *  That break is worth naming precisely, because `npx tsc --noEmit` and the whole test suite
 *  passed through all of it: types and unit tests never look at what ends up in a browser bundle.
 *  Only `npm run build` catches it, and it had been broken for three commits before anyone ran
 *  one.
 *
 *  So the rule this file encodes: anything a client component needs from the chat's context layer
 *  belongs HERE, where there is nothing to accidentally drag along. Nothing in this file may
 *  import from lib/chat-context.ts, lib/crawl.ts or anything that touches the network. */

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function humanTime(at: Date, timeZone: string): string {
  try {
    const s = new Intl.DateTimeFormat("en-GB", {
      timeZone, weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(at);
    return `${s} ${timeZone}`;
  } catch {
    return at.toISOString();
  }
}

export function agoPhrase(at: Date, from: Date = new Date()): string {
  const mins = Math.round((from.getTime() - at.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function untilPhrase(at: Date, from: Date = new Date()): string {
  const mins = Math.round((at.getTime() - from.getTime()) / 60000);
  if (mins < 1) return "any moment now";
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${Math.round(hours / 24)} days`;
}

export function localParts(at: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
    dow: DOW[p.weekday] ?? 0,
  };
}

export function nextRunAt(
  s: { frequency: string; day_of_week: number; time_of_day: string; timezone: string },
  from: Date = new Date()
): Date | null {
  const [hh, mm] = String(s.time_of_day ?? "09:00").split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    // Walk forward in real time, then ask what the wall clock says in the tenant's zone —
    // the only way to land on "09:00 in Asia/Dubai" without a date library.
    const probe = new Date(from.getTime() + dayOffset * 86400000);
    let parts;
    try {
      parts = localParts(probe, s.timezone);
    } catch {
      return null; // invalid IANA name; the API rejects these on save
    }
    if (s.frequency === "weekdays" && (parts.dow === 0 || parts.dow === 6)) continue;
    if (s.frequency === "weekly" && parts.dow !== Number(s.day_of_week)) continue;

    // Offset between UTC and the tenant's zone at this moment, so the slot can be expressed
    // as a real instant rather than a wall-clock string.
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hh, mm, 0);
    const zoneOffsetMs = probe.getTime() - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const instant = new Date(asUtc + zoneOffsetMs);
    if (instant.getTime() > from.getTime()) return instant;
  }
  return null;
}
