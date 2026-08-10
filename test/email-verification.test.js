import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import {
  normalizeEmailChangeConfirmation,
  normalizeEmailVerificationConfirmation,
  normalizeVerificationRequest,
} from "../src/auth.js";
import { buildAuthEmailTemplates } from "../src/email-templates.js";

const verificationToken = "valid.verification.token.with-enough-characters";

test("builds every link-bearing auth template with the public application origin", () => {
  const templates = buildAuthEmailTemplates("https://app.example.com");
  const bodies = Object.values(templates).map((template) => template.body);

  assert.match(templates.verificationTemplate.body, /https:\/\/app\.example\.com\/verify-email\?token=\{TOKEN\}/);
  assert.match(templates.resetPasswordTemplate.body, /https:\/\/app\.example\.com\/reset-password\?token=\{TOKEN\}/);
  assert.match(templates.confirmEmailChangeTemplate.body, /https:\/\/app\.example\.com\/confirm-email-change\?token=\{TOKEN\}/);
  assert.equal(bodies.some((body) => body.includes("{APP_URL}")), false);
  assert.equal(bodies.some((body) => body.includes("/_/")), false);
  assert.throws(
    () => buildAuthEmailTemplates("https://app.example.com/unexpected-path"),
    /origin/,
  );
});

test("normalizes email verification and email change input", () => {
  assert.deepEqual(normalizeVerificationRequest({ email: " Person@Example.COM " }), {
    email: "person@example.com",
  });
  assert.deepEqual(normalizeEmailVerificationConfirmation({ token: verificationToken }), {
    token: verificationToken,
  });
  assert.deepEqual(
    normalizeEmailChangeConfirmation({ token: verificationToken, password: "current-password" }),
    { token: verificationToken, password: "current-password" },
  );
  assert.throws(
    () => normalizeEmailVerificationConfirmation({ token: "invalid token" }),
    /invalid/,
  );
});

test("requires email verification before password sign-in", async (context) => {
  const createdUsers = [];
  const verificationRequests = [];
  const verificationConfirmations = [];
  const emailChangeConfirmations = [];
  let verified = false;
  let authStoreClears = 0;

  const usersService = {
    async create(payload) {
      createdUsers.push(payload);
      return { id: "user12345678901", email: payload.email, verified: false };
    },
    async requestVerification(email) {
      verificationRequests.push(email);
    },
    async confirmVerification(token) {
      verificationConfirmations.push(token);
      verified = true;
    },
    async confirmEmailChange(...args) {
      emailChangeConfirmations.push(args);
    },
    async authWithPassword(email) {
      return {
        token: "pocketbase-user-session-token",
        record: { id: "user12345678901", email, name: "", verified },
      };
    },
  };
  const userClient = {
    authStore: { clear() { authStoreClears += 1; } },
    collection: () => usersService,
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
    publicBaseUrl: "https://app.example.com",
    pocketBaseUrl: "http://pocketbase:8090",
    analyticsHashSecret: "verification-test-secret-0123456789abcdef",
  };
  const app = createApp({
    client,
    config,
    geoIpResolver: { lookupCountry: async () => "XX" },
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
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "Person@Example.com", password: "new-password" }),
  });
  assert.equal(registerResponse.status, 201);
  assert.deepEqual(await registerResponse.json(), {
    verificationRequired: true,
    verificationEmailSent: true,
  });
  assert.equal(registerResponse.headers.getSetCookie().length, 0);
  assert.equal(createdUsers[0].email, "person@example.com");
  assert.deepEqual(verificationRequests, ["person@example.com"]);

  const unverifiedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", password: "new-password" }),
  });
  assert.equal(unverifiedLogin.status, 403);
  assert.deepEqual(await unverifiedLogin.json(), {
    error: "Verify your email before signing in",
    code: "email_verification_required",
  });
  assert.equal(authStoreClears, 1);

  const resendResponse = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "person@example.com" }),
  });
  assert.equal(resendResponse.status, 202);
  assert.deepEqual(verificationRequests, ["person@example.com", "person@example.com"]);

  const verificationResponse = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verificationToken }),
  });
  assert.equal(verificationResponse.status, 204);
  assert.deepEqual(verificationConfirmations, [verificationToken]);

  const verifiedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", password: "new-password" }),
  });
  assert.equal(verifiedLogin.status, 200);
  assert.match(verifiedLogin.headers.getSetCookie().join("\n"), /weblink_session=/);

  const emailChangeResponse = await fetch(`${baseUrl}/api/auth/confirm-email-change`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verificationToken, password: "current-password" }),
  });
  assert.equal(emailChangeResponse.status, 204);
  assert.deepEqual(emailChangeConfirmations, [[verificationToken, "current-password"]]);
});
