/** Time parsing, in both the languages people actually type.
 *
 *  These cases are not invented. Most of them are messages real users sent, including the
 *  typos ("30mmin bad", "5 minit bad", "40m nbad"), and several exist because the product got
 *  them wrong once: "this is bad" was read as a deadline because of the word "bad"; "write 3
 *  articles" was read as a time because of the number; "in 5 articles" likewise.
 *
 *  They lived in a scratch file for weeks and protected nothing. They are in the repo now
 *  because `lib/when.ts` is the ONLY place in the product that decides what "40 min baad"
 *  means — the brain deliberately never parses a phrase (agent-server/src/brain/types.ts) so
 *  that two implementations can never disagree. That makes this file the single guard on the
 *  one number a user will absolutely notice being wrong.
 *
 *  Fixed clock: Wed 26 Aug 2026, 16:02 Asia/Calcutta = 10:32 UTC. Every expectation below is
 *  minutes from that instant, so the afternoon-rolls-to-tomorrow rules are actually exercised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWhen, describeWhen } from "./when";

const TZ = "Asia/Calcutta";
const NOW = new Date("2026-08-26T10:32:00.000Z");

const minutesFromNow = (msg: string): number | null => {
  const w = parseWhen(msg, TZ, NOW);
  return w ? Math.round((w.at.getTime() - NOW.getTime()) / 60000) : null;
};

function expect(msg: string, want: number | null, why = "") {
  const got = minutesFromNow(msg);
  assert.equal(got, want, `${JSON.stringify(msg)} → ${got} minutes, expected ${want}${why ? ` (${why})` : ""}`);
}

test("the messages real users typed, typos and all", () => {
  expect("mujhe 30mmin bad ek artical ko apne webiset pe published karna ha ok tum schule kar sakte ho", 30);
  expect("no mujhe 30 min bad published karna ha isko", 30);
  expect("40m nbad artical published kardo", 40);
  expect("5 minit bad", 5);
  expect("1hr baad", 60);
});

test("relative time, Hinglish and English alike", () => {
  expect("30 min baad article likho", 30);
  expect("in 30 minutes write an article", 30);
  expect("after 45 mins publish it", 45);
  expect("1 ghante baad publish karo", 60);
  expect("2 hours later", 120);
  expect("2 din baad ek article", 2 * 24 * 60);
  expect("1 hafta baad", 7 * 24 * 60);
});

test("a clock time means the next time that clock reads it", () => {
  expect("kal 9 baje article publish karo", 16 * 60 + 58, "tomorrow 09:00");
  expect("kal subah 9 baje", 16 * 60 + 58);
  expect("aaj shaam 6 baje publish karo", 118, "today 18:00");
  expect("tomorrow at 9am", 16 * 60 + 58);
  expect("raat 9 baje", 4 * 60 + 58, "today 21:00");
  expect("at 5pm", 58, "today 17:00");
  expect("kal", 16 * 60 + 58, "bare 'kal' defaults to tomorrow morning");
  expect("parso subah 9 baje", 40 * 60 + 58);
});

test("a time that has already gone today rolls forward instead of booking the past", () => {
  // 09:00 is behind us at 16:02, and the afternoon rule reads a bare "9 baje" as tonight.
  expect("9 baje publish karo", 4 * 60 + 58, "09:00 has gone, so a bare hour in the afternoon means tonight");
});

test("things that look like times but are not — every one of these was a live bug", () => {
  expect("write an article about solar panels", null, "no time at all");
  expect("this is bad", null, "the English word 'bad', not Hindi 'baad'");
  expect("in 5 articles", null, "a number followed by something that is not a unit");
  expect("30 seconds baad", null, "under a minute is not a schedule");
  expect("kya update hai", null);
  expect("write 3 articles", null, "a count, not a time");
});

test("a date too far out is a misparse, not a plan", () => {
  // 90 days is the horizon (when.ts MAX_AHEAD_MS). Past it, "100 din baad" is far more likely
  // to be a mangled number than someone booking a post for next winter — and booking the
  // wrong thing three months out is a bug nobody would notice until it fired.
  expect("100 din baad", null, "beyond the 90-day horizon");
});

test("what the user is shown reads back as the thing they typed", () => {
  const w = parseWhen("kal subah 9 baje", TZ, NOW);
  assert.ok(w, "should parse");
  const said = describeWhen(w!.at, TZ, NOW);
  assert.match(said, /9/, `"${said}" should mention the hour the user asked for`);
  assert.ok(said.length > 3 && said.length < 60, `"${said}" should be one short phrase`);
});
