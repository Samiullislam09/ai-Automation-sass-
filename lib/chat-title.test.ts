import test from "node:test";
import assert from "node:assert/strict";
import { chatTitle, displayChatTitle, isWeakTitle } from "./chat-title";

test("a greeting names nothing", () => {
  for (const q of ["hi", "Hello", "helo", "ho", "ok", "hey!!", "?"]) assert.equal(chatTitle(q), null, q);
});

test("an article request is named for the job and the topic", () => {
  assert.equal(chatTitle("can you write a new artical for my website"), "New article");
  assert.equal(chatTitle("Please write an article about ISO 9001 certification cost in UAE"), "Article: ISO 9001 certification cost in UAE");
});

test("other jobs get a clear label", () => {
  assert.equal(chatTitle("schedule a post for tomorrow 9am"), "Scheduling");
  assert.equal(chatTitle("run a site audit"), "Site audit");
  assert.equal(chatTitle("find leads for my business"), "Lead generation");
});

test("anything else becomes a short tidy title", () => {
  const t = chatTitle("what does my company do and how can i improve the homepage conversion rate this month?")!;
  assert.ok(t.length <= 53, t);
  assert.match(t, /^What does my company/);
});

test("old titles that said nothing are shown as Quick chat", () => {
  assert.ok(isWeakTitle("hi"));
  assert.equal(displayChatTitle("ho"), "Quick chat");
  assert.equal(displayChatTitle("write a artical for my website"), "Write a artical for my website");
});
