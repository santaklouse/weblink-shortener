import assert from "node:assert/strict";
import test from "node:test";
import {loadConfig} from "../src/config.js";

const baseEnvironment = {
    NODE_ENV: "test",
    APP_DOMAIN: "localhost",
    ADMIN_DASHBOARD_DOMAIN: "pb.localhost",
    POCKETBASE_TOKEN: "test-pocketbase-token",
    ANALYTICS_HASH_SECRET: "a-secure-test-secret-with-32-characters",
};

test("hides sensitive analytics data by default", () => {
    assert.equal(loadConfig(baseEnvironment).hideSensitiveHeaders, true);
});

test("allows sensitive analytics output redaction to be disabled", () => {
    const config = loadConfig({
        ...baseEnvironment,
        HIDE_SENSITIVE_HEADERS: "false",
    });

    assert.equal(config.hideSensitiveHeaders, false);
});
