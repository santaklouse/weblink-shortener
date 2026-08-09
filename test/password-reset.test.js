import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import {
  normalizePasswordResetConfirmation,
  normalizePasswordResetRequest,
} from "../src/auth.js";

test("normalizes password reset input and rejects mismatched passwords", () => {
  assert.deepEqual(normalizePasswordResetRequest({ email: " Person@Example.COM " }), {
    email: "person@example.com",
  });
  assert.throws(
    () => normalizePasswordResetConfirmation({
      token: "valid.reset.token.with-enough-characters",
      password: "new-password",
      passwordConfirm: "different-password",
    }),
    /match/,
  );
  assert.deepEqual(
    normalizePasswordResetConfirmation({
      token: "valid.reset.token.with-enough-characters",
      password: "new-password",
      passwordConfirm: "new-password",
    }),
    { token: "valid.reset.token.with-enough-characters", password: "new-password" },
  );
});

test("requests and confirms password resets only through Node.js", async (context) => {
  const resetRequests = [];
  const confirmations = [];
  let rejectEmailRequest = false;
  const usersService = {
    async requestPasswordReset(email) {
      resetRequests.push(email);
      if (rejectEmailRequest) throw new Error("Email delivery failed");
      return true;
    },
    async confirmPasswordReset(...args) {
      confirmations.push(args);
      return true;
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
    analyticsHashSecret: "password-reset-test-secret-0123456789abcdef",
  };
  const app = createApp({
    client: { collection: () => { throw new Error("Unexpected superuser client call"); } },
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
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const requestReset = (email) => fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  const requestResponse = await requestReset("Person@Example.com");
  assert.equal(requestResponse.status, 202);
  assert.deepEqual(await requestResponse.json(), {
    message: "If an account exists for that email, a password reset link has been sent.",
  });
  assert.deepEqual(resetRequests, ["person@example.com"]);

  rejectEmailRequest = true;
  const neutralResponse = await requestReset("missing@example.com");
  assert.equal(neutralResponse.status, 202);
  assert.deepEqual(await neutralResponse.json(), {
    message: "If an account exists for that email, a password reset link has been sent.",
  });

  const token = "valid.reset.token.with-enough-characters";
  const confirmationResponse = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "weblink_session=old-session-token",
    },
    body: JSON.stringify({
      token,
      password: "new-password",
      passwordConfirm: "new-password",
    }),
  });
  assert.equal(confirmationResponse.status, 204);
  assert.deepEqual(confirmations, [[token, "new-password", "new-password"]]);
  assert.match(confirmationResponse.headers.getSetCookie().join("\n"), /weblink_session=;/);
});
