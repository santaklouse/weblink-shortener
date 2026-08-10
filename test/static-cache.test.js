import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("disables browser and edge caching for live-mounted public assets", async (context) => {
  const app = createApp({
    client: {
      collection() {
        throw new Error("PocketBase should not be called for static assets");
      },
    },
    config: {
      nodeEnv: "development",
      trustProxy: false,
      staticCache: false,
      rateLimitMax: 100,
      sessionCookieName: "weblink_session",
      sessionMaxAgeMs: 60_000,
      anonymousLinkTtlMs: 60_000,
      publicBaseUrl: "http://localhost",
      analyticsHashSecret: "static-cache-test-secret-with-32-characters",
    },
    geoIpResolver: { lookup: () => "XX" },
    logger: { error() {}, warn() {} },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/telegram-webapp.js`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("last-modified"), null);
});
