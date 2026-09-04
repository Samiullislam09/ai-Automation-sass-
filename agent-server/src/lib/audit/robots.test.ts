import test from "node:test";
import assert from "node:assert/strict";
import { parseRobotsTxt, isBlocked, aiSearchAccess, AI_BOTS } from "./robots.js";

test("no groups at all — nothing is blocked for anyone", () => {
  const groups = parseRobotsTxt("");
  assert.equal(isBlocked("/anything", "Googlebot", groups), false);
});

test("a blanket 'Disallow: /' under '*' blocks every path for every unnamed bot", () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow: /\n");
  assert.equal(isBlocked("/", "Googlebot", groups), true);
  assert.equal(isBlocked("/anything/deep/path", "GPTBot", groups), true);
});

test("a named group overrides the wildcard group for that bot specifically", () => {
  const groups = parseRobotsTxt(["User-agent: *", "Disallow: /", "", "User-agent: GPTBot", "Allow: /"].join("\n"));
  assert.equal(isBlocked("/", "GPTBot", groups), false, "GPTBot has its own group that allows everything");
  assert.equal(isBlocked("/", "Googlebot", groups), true, "an unnamed bot still falls to the wildcard group");
});

test("the LONGEST matching rule wins, not the first one written", () => {
  const groups = parseRobotsTxt(["User-agent: *", "Disallow: /private", "Allow: /private/public-page"].join("\n"));
  assert.equal(isBlocked("/private/secret", "Googlebot", groups), true);
  assert.equal(isBlocked("/private/public-page", "Googlebot", groups), false, "the more specific Allow beats the shorter Disallow");
});

test("an exact-length tie between Allow and Disallow goes to Allow", () => {
  const groups = parseRobotsTxt(["User-agent: *", "Disallow: /page", "Allow: /page"].join("\n"));
  assert.equal(isBlocked("/page", "Googlebot", groups), false);
});

test("'Disallow:' with nothing after it blocks nothing — a common real idiom, not ignored as a typo", () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow:\n");
  assert.equal(isBlocked("/anything", "Googlebot", groups), false);
});

test("a wildcard '*' inside a pattern matches any run of characters", () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf\n");
  assert.equal(isBlocked("/files/report.pdf", "Googlebot", groups), true);
  assert.equal(isBlocked("/files/report.pdf.html", "Googlebot", groups), true);
});

test("a trailing '$' anchors the pattern to the end of the path", () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow: /files/report.pdf$\n");
  assert.equal(isBlocked("/files/report.pdf", "Googlebot", groups), true);
  assert.equal(isBlocked("/files/report.pdf.html", "Googlebot", groups), false, "the $ anchor means this should NOT match");
});

test("consecutive User-agent lines with no rules between them share one rule set", () => {
  const groups = parseRobotsTxt(["User-agent: GPTBot", "User-agent: ChatGPT-User", "Disallow: /"].join("\n"));
  assert.equal(isBlocked("/", "GPTBot", groups), true);
  assert.equal(isBlocked("/", "ChatGPT-User", groups), true);
});

test("comments and malformed lines are skipped, never thrown on", () => {
  assert.doesNotThrow(() => parseRobotsTxt("# a comment\nnot a valid line at all\nUser-agent: *\nDisallow: /\n"));
});

test("aiSearchAccess: no robots.txt at all is reported as null, never guessed as fully allowed", () => {
  assert.equal(aiSearchAccess(null), null);
});

test("aiSearchAccess: an empty robots.txt means every named bot is genuinely allowed — the real answer, not skipped", () => {
  const access = aiSearchAccess("");
  assert.ok(access);
  assert.equal(access!.length, AI_BOTS.length);
  assert.ok(access!.every((a) => a.allowed));
});

test("aiSearchAccess: a bot explicitly disallowed shows up as blocked, by its own real id", () => {
  const access = aiSearchAccess("User-agent: GPTBot\nDisallow: /\n");
  const gptbot = access!.find((a) => a.bot === "GPTBot");
  assert.equal(gptbot!.allowed, false);
  // Every other named bot falls through to "no wildcard group at all" — genuinely allowed.
  const chatgptUser = access!.find((a) => a.bot === "ChatGPT-User");
  assert.equal(chatgptUser!.allowed, true);
});
