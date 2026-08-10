import assert from "node:assert/strict";
import test from "node:test";
import {loadTelegramBotConfig} from "../src/telegram-bot-config.js";

const environment = {
    TELEGRAM_BOT_TOKEN: "1234567890:telegram-bot-token-used-only-for-tests",
    TELEGRAM_INTERNAL_SECRET: "telegram-internal-secret-with-32-characters",
    TELEGRAM_WEBAPP_URL: "https://short.example/telegram",
};

test("derives a secure HTTPS webhook configuration", () => {
    const config = loadTelegramBotConfig(environment);

    assert.equal(config.webhookUrl, "https://short.example/api/telegram/webhook");
    assert.match(config.webhookSecret, /^[A-Za-z0-9_-]{32,256}$/);
    assert.notEqual(config.webhookSecret, environment.TELEGRAM_INTERNAL_SECRET);
    assert.equal(config.webhookMaxConnections, 10);
});

test("accepts an explicit webhook URL and secret", () => {
    const config = loadTelegramBotConfig({
        ...environment,
        TELEGRAM_WEBHOOK_URL: "https://hooks.example/telegram",
        TELEGRAM_WEBHOOK_SECRET: "explicit_telegram_webhook_secret_123456",
        TELEGRAM_WEBHOOK_MAX_CONNECTIONS: "4",
    });

    assert.equal(config.webhookUrl, "https://hooks.example/telegram");
    assert.equal(config.webhookSecret, "explicit_telegram_webhook_secret_123456");
    assert.equal(config.webhookMaxConnections, 4);
});

test("rejects non-HTTPS webhook URLs", () => {
    assert.throws(
        () => loadTelegramBotConfig({
            ...environment,
            TELEGRAM_WEBHOOK_URL: "http://short.example/api/telegram/webhook",
        }),
        /must use HTTPS/,
    );
});
