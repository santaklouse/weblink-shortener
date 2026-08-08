import assert from "node:assert/strict";
import test from "node:test";
import {
  generateSlug,
  generateStatsToken,
  isValidSlug,
  normalizeAlias,
  normalizeTargetUrl,
} from "../src/links.js";

test("normalizes a valid URL", () => {
  assert.equal(normalizeTargetUrl(" https://example.com/page?q=1 "), "https://example.com/page?q=1");
});

test("rejects unsafe protocols and embedded URL credentials", () => {
  assert.throws(() => normalizeTargetUrl("javascript:alert(1)"), /http/);
  assert.throws(() => normalizeTargetUrl("https://user:secret@example.com"), /credentials/);
});

test("normalizes a custom slug", () => {
  assert.equal(normalizeAlias(" My_Link "), "my_link");
  assert.equal(normalizeAlias(""), undefined);
});

test("rejects invalid and reserved slugs", () => {
  assert.throws(() => normalizeAlias("bad slug"), /Slug/);
  assert.throws(() => normalizeAlias("health"), /reserved/);
});

test("generates a valid random slug", () => {
  const first = generateSlug();
  const second = generateSlug();
  assert.equal(first.length, 7);
  assert.ok(isValidSlug(first));
  assert.notEqual(first, second);
});

test("generates an unpredictable statistics token", () => {
  const token = generateStatsToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, generateStatsToken());
});
