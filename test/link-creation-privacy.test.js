import assert from "node:assert/strict";
import test from "node:test";
import {createApp} from "../src/app.js";

test("creates private owned statistics and public guest statistics by default", async (context) => {
    const createdRecords = [];
    const client = {
        collection(name) {
            if (name !== "short_links") throw new Error(`Unexpected collection: ${name}`);
            return {
                async create(record) {
                    createdRecords.push(record);
                    return {
                        id: `link${createdRecords.length}2345678901`,
                        ...record,
                        created: "2026-08-10T10:00:00Z",
                    };
                },
            };
        },
    };
    const userClient = {
        collection() {
            return {
                async authRefresh() {
                    return {
                        token: "refreshed-user-session",
                        record: {
                            id: "user12345678901",
                            email: "owner@example.com",
                            verified: true,
                        },
                    };
                },
            };
        },
    };
    const app = createApp({
        client,
        config: {
            nodeEnv: "test",
            trustProxy: false,
            rateLimitMax: 100,
            sessionCookieName: "weblink_session",
            sessionMaxAgeMs: 60_000,
            anonymousLinkTtlMs: 60_000,
            publicBaseUrl: "https://short.example",
            analyticsHashSecret: "link-privacy-test-secret-with-32-characters",
        },
        geoIpResolver: {lookup: () => "XX"},
        logger: {error() {}, warn() {}},
        userClientFactory: () => userClient,
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    context.after(() => new Promise((resolve) => server.close(resolve)));

    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}/api/links`;
    const guestResponse = await fetch(endpoint, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({url: "https://example.com/guest"}),
    });
    const ownerResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: "weblink_session=existing-user-session",
        },
        body: JSON.stringify({url: "https://example.com/owner"}),
    });

    assert.equal(guestResponse.status, 201);
    assert.equal(ownerResponse.status, 201);
    assert.equal(createdRecords[0].owner, "");
    assert.equal(createdRecords[0].statsPublic, true);
    assert.equal(createdRecords[1].owner, "user12345678901");
    assert.equal(createdRecords[1].statsPublic, false);
    assert.equal((await guestResponse.json()).statsPublic, true);
    assert.equal((await ownerResponse.json()).statsPublic, false);
});
