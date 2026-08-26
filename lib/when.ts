/** "30 min baad", "kal subah 9 baje", "in 2 hours" -> an exact instant.
 *
 *  WHY THIS EXISTS. The chat could start work and it could answer questions, but it had no
 *  concept of WHEN. "mujhe 30 min baad ek article publish karna hai" was read as "write an
 *  article", the time was dropped on the floor, and Mr. Keyword started immediately. The user
 *  then said "no, 30 minutes later" and the model — having no way to do that and no
 *  instruction not to pretend — replied "Mr. Publish — queued for immediate publish (30
 *  minutes from now)". Nothing was queued. Mr. Publish has never run a single job.
 *
 *  So the time has to be understood HERE, in code, before any confirmation is written.
 *
 *  DESIGN RULES
 *  · Two languages, badly typed. Real messages in this product look like "30mmin bad",
 *    "40m nbad", "kal subha 9 bje". A parser that only accepts "in 30 minutes" is a parser
 *    that fails every real customer.
 *  · Say null when unsure. A missed time means the user rephrases. A WRONG time publishes to
 *    their live website at the wrong moment, which is not recoverable by rephrasing.
 *  · Never return the past. A bare "9 baje" that has already gone today means tomorrow —
 *    that is what a person means by it, and it is also the only safe reading.
 */

export type When = {
  /** The exact instant, in UTC. */
  at: Date;
  /** How it was said — the confirmation reads differently for each. */
  kind: "relative" | "absolute";
  /** The fragment that was matched, so the reply can quote the user back to themselves. */
  matched: string;
};

/** Under a minute is not a schedule, it is "now" — and rounding it to a schedule would put a
 *  row in the table that fires before the user has finished reading the confirmation. */
const MIN_AHEAD_MS = 60_000;
/** Ninety days. Past this it is almost certainly a misparse ("2024 baje"), not a plan. */
const MAX_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/* ── Relative: "<n> <unit> baad" ──────────────────────────────────────────────────────── */

// "baad" is the Urdu/Hindi "after", and people type it bad / bd / baadh. It is also the
// English word "bad", which is why a bare "bad" is never enough on its own — it only counts
// when it follows a number and a time unit, which "this is bad" never does.
const AFTER_WORD = "(?:baad|bad|baadh|bd|ke\\s*baad|later|after|se)";
const BEFORE_WORD = "(?:in|after|within|baad)";

// The unit is deliberately sloppy: 1-10 letters, normalised below rather than enumerated.
// "30mmin", "5 minit", "2 ghante", "1hr" all arrive here as (number, letters).
const REL_AFTER = new RegExp(`(\\d{1,4})\\s*([a-z]{1,10})\\.?\\s*\\bn?${AFTER_WORD}\\b`, "i");
const REL_BEFORE = new RegExp(`\\b${BEFORE_WORD}\\s+(\\d{1,4})\\s*([a-z]{1,10})\\b`, "i");

/** Collapses a doubled first letter ("mmin" -> "min") and matches on prefix. The doubling is
 *  the single most common typo in this box — the shift key is held a fraction too long. */
function unitMs(raw: string): number | null {
  const u = raw.toLowerCase().replace(/^(.)\1+/, "$1");
  if (/^(?:m|min|mins|minute|minutes|minit|minat|mnt|mint)$/.test(u)) return MINUTE;
  if (/^(?:h|hr|hrs|hour|hours|ghanta|ghante|ghanto|ghnt|gante)$/.test(u)) return HOUR;
  if (/^(?:d|day|days|din|dino)$/.test(u)) return DAY;
  if (/^(?:w|week|weeks|hafta|hafte|hafto)$/.test(u)) return 7 * DAY;
  return null;
}

/* ── Absolute: "kal subah 9 baje", "tomorrow at 9am", "shaam 6 baje" ──────────────────── */

const DAY_WORD = /\b(aaj|today|kal|tomorrow|parso|parson|day after tomorrow)\b/i;
// Named parts of the day, for "kal subah" with no clock time attached. These are opinions,
// not measurements, so they are the same opinions the Schedule page already ships with.
const PART_WORD = /\b(subah|subha|savere|morning|dopahar|dopeher|afternoon|shaam|sham|evening|raat|rat|night)\b/i;
const PART_HOUR: Record<string, number> = { morning: 9, afternoon: 14, evening: 18, night: 21 };
// "9 baje", "9:30 baje", "at 9am", "9 pm", "21:00". `baje` is the Hindi/Urdu "o'clock" and is
// what makes a bare number a time at all — without it, "30" in "30 min" would read as 30:00.
const CLOCK = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|baje|bje|baja|bajay)\b/i;

function partOf(word: string): number | null {
  const w = word.toLowerCase();
  if (/^(?:subah|subha|savere|morning)$/.test(w)) return PART_HOUR.morning;
  if (/^(?:dopahar|dopeher|afternoon)$/.test(w)) return PART_HOUR.afternoon;
  if (/^(?:shaam|sham|evening)$/.test(w)) return PART_HOUR.evening;
  if (/^(?:raat|rat|night)$/.test(w)) return PART_HOUR.night;
  return null;
}

/* ── Timezone arithmetic ──────────────────────────────────────────────────────────────── */

/** The wall-clock date in `tz` at instant `d`. */
export function localParts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? "0");
  return { y: g("year"), m: g("month"), d: g("day"), hour: g("hour"), minute: g("minute"), second: g("second") };
}

/** The UTC instant at which `tz`'s wall clock reads the given local date and time.
 *
 *  Done by guessing UTC, measuring how far off the guess lands in `tz`, and correcting — twice,
 *  because a correction that steps across a DST boundary changes the offset it was correcting
 *  for. Two passes settle every real zone; a third would only matter inside the one ambiguous
 *  hour a year, where either answer is defensible. */
export function zonedTimeToUtc(y: number, mo: number, d: number, hh: number, mi: number, tz: string): Date {
  let guess = Date.UTC(y, mo - 1, d, hh, mi, 0);
  for (let i = 0; i < 2; i++) {
    const got = localParts(new Date(guess), tz);
    const drift =
      Date.UTC(got.y, got.m - 1, got.d, got.hour, got.minute, got.second) - Date.UTC(y, mo - 1, d, hh, mi, 0);
    if (drift === 0) break;
    guess -= drift;
  }
  return new Date(guess);
}

/* ── The parser ───────────────────────────────────────────────────────────────────────── */

/** Reads a time out of a free-form message, or returns null.
 *
 *  @param tz  The tenant's IANA zone. Absolute times mean nothing without it: "9 baje" is a
 *             different instant in Karachi than in London, and the customer means theirs. */
export function parseWhen(raw: string, tz: string, now: Date = new Date()): When | null {
  const q = String(raw ?? "").toLowerCase();
  if (!q.trim()) return null;

  const rel = relative(q, now);
  if (rel) return guard(rel, now);

  const abs = absolute(q, tz, now);
  if (abs) return guard(abs, now);

  return null;
}

function relative(q: string, now: Date): When | null {
  for (const re of [REL_AFTER, REL_BEFORE]) {
    const m = q.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    const ms = unitMs(m[2]);
    // "in 5 articles" reaches here with a number and a word that is not a unit. That is not a
    // time, and treating an unrecognised word as minutes is how a parser starts inventing.
    if (!ms || !Number.isFinite(n) || n <= 0) continue;
    return { at: new Date(now.getTime() + n * ms), kind: "relative", matched: m[0].trim() };
  }
  return null;
}

function absolute(q: string, tz: string, now: Date): When | null {
  const dayM = q.match(DAY_WORD);
  const clockM = q.match(CLOCK);
  const partM = q.match(PART_WORD);

  // A day or a part of the day on its own is a time ("kal" = tomorrow morning). A clock on its
  // own is a time today. Nothing at all is not.
  if (!dayM && !clockM && !partM) return null;

  const here = localParts(now, tz);
  let dayShift = 0;
  if (dayM) {
    const w = dayM[1].toLowerCase();
    if (/^(?:kal|tomorrow)$/.test(w)) dayShift = 1;
    else if (/^(?:parso|parson|day after tomorrow)$/.test(w)) dayShift = 2;
  }

  let hh: number | null = null;
  let mi = 0;

  if (clockM) {
    hh = Number(clockM[1]);
    mi = clockM[2] ? Number(clockM[2]) : 0;
    if (hh > 23 || mi > 59) return null;
    const suffix = clockM[3].toLowerCase();
    const isAm = suffix.startsWith("a");
    const isPm = suffix.startsWith("p");
    if (isPm && hh < 12) hh += 12;
    if (isAm && hh === 12) hh = 0;
    // "9 baje" with no am/pm. Three readings, in order of how strongly they are meant:
    //
    //  1. They named a part of the day — "raat 9 baje" is 21:00 and there is nothing to guess.
    //  2. They named ANOTHER day — "kal 9 baje" is 9am. This clause exists because it did not:
    //     asked at 16:02, the rule below turned tomorrow's nine into 9pm, which is twelve hours
    //     from what anyone means by it. Guessing from the hour it happens to be RIGHT NOW only
    //     makes sense for a time today; tomorrow's clock starts again at midnight.
    //  3. Neither — "9 baje" said at 16:02 means tonight, not a moment that has already gone.
    if (!isAm && !isPm) {
      const part = partM ? partOf(partM[1]) : null;
      if (part != null && part >= 12 && hh < 12) hh += 12;
      else if (part == null && !dayM && hh < 12 && here.hour >= 12) hh += 12;
    }
  } else if (partM) {
    hh = partOf(partM[1]);
  }

  if (hh == null) hh = 9; // "kal" with no time at all — the working day starts at nine.

  let at = zonedTimeToUtc(here.y, here.m, here.d + dayShift, hh, mi, tz);

  // Already gone today and they didn't name a day: they meant the next one. Nobody asks for
  // something to happen at a moment that has passed.
  if (!dayM && at.getTime() <= now.getTime()) {
    at = zonedTimeToUtc(here.y, here.m, here.d + 1, hh, mi, tz);
  }

  const matched = [dayM?.[0], partM?.[0], clockM?.[0]].filter(Boolean).join(" ");
  return { at, kind: "absolute", matched };
}

/** The last gate. Everything above can be fooled; this cannot be talked around. */
function guard(w: When, now: Date): When | null {
  const ahead = w.at.getTime() - now.getTime();
  if (!Number.isFinite(ahead)) return null;
  if (ahead < MIN_AHEAD_MS) return null;
  if (ahead > MAX_AHEAD_MS) return null;
  return w;
}

/* ── Saying it back ───────────────────────────────────────────────────────────────────── */

/** "in 30 minutes (4:32 PM)" — both halves on purpose. The relative half is what they asked
 *  for and can check at a glance; the absolute half is what was actually written to the
 *  database, and is the one that is true after they have left the tab open for an hour. */
export function describeWhen(at: Date, tz: string, now: Date = new Date()): string {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h12",
  }).format(at);

  const here = localParts(now, tz);
  const there = localParts(at, tz);
  const sameDay = here.y === there.y && here.m === there.m && here.d === there.d;

  const day = sameDay
    ? "today"
    : new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(at);

  const mins = Math.round((at.getTime() - now.getTime()) / MINUTE);
  const gap =
    mins < 60 ? `in ${mins} minute${mins === 1 ? "" : "s"}`
    : mins < 24 * 60 ? `in ${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? "" : "s"}`
    : `in ${Math.round(mins / (24 * 60))} day${Math.round(mins / (24 * 60)) === 1 ? "" : "s"}`;

  return `${gap} — ${day} at ${clock}`;
}
