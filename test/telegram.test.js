import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTelegramDeepLink,
  generateTelegramLinkToken,
  hashTelegramLinkToken,
  matchesInternalSecret,
  normalizeTelegramIdentity,
  parseTelegramLinkParameter,
} from "../src/telegram.js";

const secret = "telegram-internal-secret-with-at-least-32-characters";

test("creates single-use Telegram deep-link tokens without exposing the stored token", () => {
  const token = generateTelegramLinkToken();
  const anotherToken = generateTelegramLinkToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, anotherToken);

  const hash = hashTelegramLinkToken(token, secret);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes(token), false);

  const link = buildTelegramDeepLink("weblink_manager_bot", token);
  assert.equal(link, `https://t.me/weblink_manager_bot?start=link_${token}`);
  assert.equal(parseTelegramLinkParameter(`link_${token}`), token);
});

test("validates private Telegram identities and constant-time internal secrets", () => {
  assert.deepEqual(
    normalizeTelegramIdentity({
      userId: 123456789,
      chatId: "123456789",
      username: "@person_name",
      firstName: " Person ",
    }),
    {
      userId: "123456789",
      chatId: "123456789",
      username: "person_name",
      firstName: "Person",
    },
  );
  assert.throws(
    () => normalizeTelegramIdentity({ userId: "123", chatId: "456" }),
    /private chat/,
  );
  assert.equal(matchesInternalSecret(secret, secret), true);
  assert.equal(matchesInternalSecret(`${secret}x`, secret), false);
  assert.equal(matchesInternalSecret("incorrect", secret), false);
});
