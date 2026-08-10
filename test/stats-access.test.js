import assert from "node:assert/strict";
import test from "node:test";
import {createApp} from "../src/app.js";

test("restricts owned link statistics unless public access is enabled", async (context) => {
    const statsToken = "A".repeat(43);
    const record = {
        id: "link12345678901",
        owner: "user12345678901",
        slug: "private-link",
        url: "https://example.com/",
        clicks: 0,
        active: true,
        statsPublic: false,
        created: "2026-08-10T10:00:00Z",
        expiresAt: "",
    };
    const client = {
        filter(template) {
            return template;
        },
        collection(name) {
            if (name === "short_links") {
                return {
                    async getFirstListItem() {
                        return record;
                    },
                };
            }
            if (name === "click_events") {
                return {
                    async getList() {
                        return {items: []};
                    },
                };
            }
            throw new Error(`Unexpected collection: ${name}`);
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
            analyticsHashSecret: "stats-access-test-secret-with-32-characters",
            analyticsMaxEvents: 5_000,
            analyticsRecentEvents: 50,
            hideSensitiveHeaders: true,
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
    const statsUrl = `http://127.0.0.1:${address.port}/api/stats/${statsToken}`;

    const anonymousResponse = await fetch(statsUrl);
    assert.equal(anonymousResponse.status, 403);
    assert.deepEqual(await anonymousResponse.json(), {
        error: "Only the link owner can view these statistics",
    });

    const ownerResponse = await fetch(statsUrl, {
        headers: {Cookie: "weblink_session=existing-user-session"},
    });
    assert.equal(ownerResponse.status, 200);
    assert.equal((await ownerResponse.json()).link.statsPublic, false);

    record.statsPublic = true;
    const publicResponse = await fetch(statsUrl);
    assert.equal(publicResponse.status, 200);
    assert.equal((await publicResponse.json()).link.statsPublic, true);

    record.owner = "";
    record.statsPublic = false;
    const guestLinkResponse = await fetch(statsUrl);
    assert.equal(guestLinkResponse.status, 200);
});
