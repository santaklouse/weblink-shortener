import assert from "node:assert/strict";
import test from "node:test";
import {createApp} from "../src/app.js";
import {createTelegramBotServer} from "../src/telegram-webapp.js";

test("forwards the public Telegram webhook to the private bot service", async (context) => {
    const internalSecret = "telegram-internal-secret-with-32-characters";
    const webhookSecret = "telegram_webhook_secret_used_only_for_tests";
    const updates = [];
    const telegramServer = createTelegramBotServer({
        botToken: "1234567890:telegram-bot-token-used-only-for-tests",
        internalSecret,
        maxAgeSeconds: 300,
        webhookSecret,
        async handleWebhookUpdate(update) {
            updates.push(update);
        },
        logger: {error() {}},
    });
    telegramServer.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        telegramServer.once("listening", resolve);
        telegramServer.once("error", reject);
    });
    context.after(() => new Promise((resolve) => telegramServer.close(resolve)));
    const telegramAddress = telegramServer.address();

    const app = createApp({
        client: {
            collection() {
                throw new Error("PocketBase should not be called for Telegram webhooks");
            },
        },
        config: {
            nodeEnv: "test",
            trustProxy: false,
            rateLimitMax: 100,
            sessionCookieName: "weblink_session",
            sessionMaxAgeMs: 60_000,
            anonymousLinkTtlMs: 60_000,
            publicBaseUrl: "https://short.example",
            analyticsHashSecret: "webhook-proxy-test-secret-with-32-characters",
            telegramBotUsername: "test_shortener_bot",
            telegramInternalSecret: internalSecret,
            telegramValidatorUrl: `http://127.0.0.1:${telegramAddress.port}`,
        },
        geoIpResolver: {lookup: () => "XX"},
        logger: {error() {}, warn() {}},
    });
    const appServer = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        appServer.once("listening", resolve);
        appServer.once("error", reject);
    });
    context.after(() => new Promise((resolve) => appServer.close(resolve)));
    const appAddress = appServer.address();
    const url = `http://127.0.0.1:${appAddress.port}/api/telegram/webhook`;
    const update = {update_id: 456, message: {text: "/help"}};

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
