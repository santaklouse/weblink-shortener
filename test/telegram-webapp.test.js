import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createTelegramBotServer,
  createTelegramWebAppValidator,
  validateTelegramWebAppInitData,
} from "../src/telegram-webapp.js";

const botToken = "1234567890:telegram-bot-token-used-only-for-tests";
const internalSecret = "telegram-webapp-internal-secret-with-32-characters";
const authDate = 1_786_339_200;

function signedInitData(overrides = {}) {
  const user = JSON.stringify({
    id: 123456789,
    first_name: "Person",
    username: "person_name",
    ...overrides.user,
  });
  const parameters = new URLSearchParams({
    auth_date: String(overrides.authDate ?? authDate),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user,
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  parameters.set("hash", hash);
  return parameters.toString();
}

test("validates signed Telegram Mini App initData and returns a private identity", () => {
  assert.deepEqual(
    validateTelegramWebAppInitData(signedInitData(), botToken, {
      now: authDate * 1_000 + 60_000,
      maxAgeSeconds: 300,
    }),
    {
      userId: "123456789",
      chatId: "123456789",
      username: "person_name",
      firstName: "Person",
    },
  );
});

test("accepts Telegram webhook updates only with the configured secret", async (context) => {
  const updates = [];
  const webhookSecret = "telegram_webhook_secret_used_only_for_tests";
  const server = createTelegramBotServer({
    botToken,
    internalSecret,
    maxAgeSeconds: 300,
    webhookSecret,
    async handleWebhookUpdate(update) {
      updates.push(update);
    },
    logger: {error() {}},
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/webhook`;
  const update = {update_id: 123, message: {text: "/start"}};

  const hidden = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(update),
  });
  assert.equal(hidden.status, 404);

  const accepted = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
    },
    body: JSON.stringify(update),
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), {ok: true});
  assert.deepEqual(updates, [update]);
});

test("rejects tampered and expired Telegram Mini App initData", () => {
  const tampered = new URLSearchParams(signedInitData());
  tampered.set("user", JSON.stringify({ id: 987654321, first_name: "Attacker" }));
  assert.throws(
    () => validateTelegramWebAppInitData(tampered.toString(), botToken, { now: authDate * 1_000 }),
    /invalid/,
  );
  assert.throws(
    () => validateTelegramWebAppInitData(signedInitData(), botToken, {
      now: (authDate + 301) * 1_000,
      maxAgeSeconds: 300,
    }),
    /expired/,
  );
});

test("keeps Telegram bot token validation inside the private validator service", async (context) => {
  const server = createTelegramWebAppValidator({
    botToken,
    internalSecret,
    maxAgeSeconds: 300,
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/validate`;
  const body = JSON.stringify({
    initData: signedInitData({ authDate: Math.floor(Date.now() / 1_000) }),
  });

  const hidden = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  assert.equal(hidden.status, 404);

  const validated = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Secret": internalSecret,
    },
    body,
  });
  assert.equal(validated.status, 200);
  assert.deepEqual(await validated.json(), {
    identity: {
      userId: "123456789",
      chatId: "123456789",
      username: "person_name",
      firstName: "Person",
    },
  });
});
