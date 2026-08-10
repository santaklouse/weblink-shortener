import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("allows an authenticated owner to edit a destination and slug", async (context) => {
  const linkId = "link12345678901";
  const updates = [];
  const linksService = {
    async getFirstListItem() {
      return {
        id: linkId,
        owner: "user12345678901",
        slug: "old-link",
        url: "https://example.com/old",
        active: true,
      };
    },
    async update(id, update) {
      updates.push({ id, update });
      return { id, ...update, active: true };
    },
  };
  const client = {
    filter(template) { return template; },
    collection(name) {
      if (name === "short_links") return linksService;
      throw new Error(`Unexpected collection: ${name}`);
    },
  };
  const config = {
    nodeEnv: "test",
    trustProxy: false,
    rateLimitMax: 100,
    sessionCookieName: "weblink_session",
    sessionMaxAgeMs: 60_000,
    anonymousLinkTtlMs: 60_000,
    publicBaseUrl: "https://short.example",
    analyticsHashSecret: "link-edit-test-secret-with-32-characters",
  };
  const userClient = {
    collection() {
      return {
        async authRefresh() {
          return {
            token: "refreshed-user-session",
            record: { id: "user12345678901", email: "owner@example.com", verified: true },
          };
        },
      };
    },
  };
  const app = createApp({
    client,
    config,
    geoIpResolver: { lookup: () => "XX" },
    logger: { error() {}, warn() {} },
    userClientFactory: () => userClient,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/links/${linkId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: "weblink_session=existing-user-session",
    },
    body: JSON.stringify({ url: "https://example.com/new", alias: "new-link" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(updates, [{
    id: linkId,
    update: { url: "https://example.com/new", slug: "new-link" },
  }]);
  assert.deepEqual(await response.json(), {
    id: linkId,
    slug: "new-link",
    shortUrl: "https://short.example/new-link",
    targetUrl: "https://example.com/new",
    active: true,
  });
});
