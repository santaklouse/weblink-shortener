import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import {
  buildOAuthAuthorizationUrl,
  createOAuthStateToken,
  OAUTH_STATE_TTL_MS,
  verifyOAuthStateToken,
} from "../src/oauth.js";

const secret = "oauth-test-secret-with-at-least-32-characters";
const provider = {
  name: "google",
  state: "state-value-with-at-least-16-characters",
  codeVerifier: "code-verifier-value-with-at-least-thirty-two-characters",
  authURL: "https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=",
};

test("creates and verifies a signed OAuth state token", () => {
  const now = Date.UTC(2026, 7, 9, 12, 0, 0);
  const token = createOAuthStateToken(provider, "https://short.example/api/auth/google-callback", secret, now);
  const payload = verifyOAuthStateToken(token, secret, now + 1_000);

  assert.equal(payload.state, provider.state);
  assert.equal(payload.codeVerifier, provider.codeVerifier);
  assert.equal(payload.redirectUrl, "https://short.example/api/auth/google-callback");
});

test("rejects tampered and expired OAuth state tokens", () => {
  const now = Date.UTC(2026, 7, 9, 12, 0, 0);
  const token = createOAuthStateToken(provider, "https://short.example/api/auth/google-callback", secret, now);
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

  assert.throws(() => verifyOAuthStateToken(tampered, secret, now), /signature/);
  assert.throws(
    () => verifyOAuthStateToken(token, secret, now + OAUTH_STATE_TTL_MS + 1),
    /expired/,
  );
});

test("builds a Google authorization URL without exposing PocketBase", () => {
  const redirectUrl = "https://short.example/api/auth/google-callback";
  const result = buildOAuthAuthorizationUrl(provider.authURL, redirectUrl);

  assert.equal(result, `${provider.authURL}${redirectUrl}`);
  assert.equal(result.includes("pocketbase"), false);
});

test("completes Google OAuth through Node.js and sets the application session", async (context) => {
  const calls = [];
  const usersService = {
    async listAuthMethods() {
      return { oauth2: { enabled: true, providers: [provider] } };
    },
    async authWithOAuth2Code(...args) {
      calls.push(args);
      return {
        token: "pocketbase-user-session-token",
        record: { id: "user12345678901", email: "person@example.com", name: "Person" },
      };
    },
  };
  const client = {
    collection(name) {
      if (name === "users") return usersService;
      throw new Error(`Unexpected collection: ${name}`);
    },
  };
  const config = {
    nodeEnv: "test",
    trustProxy: false,
    rateLimitMax: 100,
    sessionCookieName: "weblink_session",
    sessionMaxAgeMs: 7 * 24 * 60 * 60 * 1_000,
    anonymousLinkTtlMs: 24 * 60 * 60 * 1_000,
    publicBaseUrl: "https://short.example",
    pocketBaseUrl: "http://pocketbase:8090",
    analyticsHashSecret: secret,
  };
  const app = createApp({
    client,
    config,
    geoIpResolver: { lookupCountry: async () => "XX" },
    logger: { error() {}, warn() {} },
    userClientFactory: () => ({ collection: () => usersService }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const localBaseUrl = `http://127.0.0.1:${address.port}`;
  const startResponse = await fetch(`${localBaseUrl}/api/auth/google/start`, {
    redirect: "manual",
  });
  assert.equal(startResponse.status, 302);
  const oauthCookie = startResponse.headers.getSetCookie()[0].split(";", 1)[0];
  const googleUrl = new URL(startResponse.headers.get("location"));
  assert.equal(googleUrl.hostname, "accounts.google.com");
  assert.equal(googleUrl.searchParams.get("redirect_uri"), "https://short.example/api/auth/google-callback");

  const callbackResponse = await fetch(
    `${localBaseUrl}/api/auth/google-callback?state=${encodeURIComponent(provider.state)}&code=google-code`,
    { headers: { Cookie: oauthCookie }, redirect: "manual" },
  );
  assert.equal(callbackResponse.status, 303);
  assert.equal(callbackResponse.headers.get("location"), "/?auth=google-success");
  assert.match(callbackResponse.headers.getSetCookie().join("\n"), /weblink_session=/);
  assert.deepEqual(calls[0], [
    "google",
    "google-code",
    provider.codeVerifier,
    "https://short.example/api/auth/google-callback",
  ]);
});
