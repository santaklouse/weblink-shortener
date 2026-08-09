import { createHmac, timingSafeEqual } from "node:crypto";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function isValidPayload(payload) {
  return (
    payload &&
    typeof payload.state === "string" &&
    payload.state.length >= 16 &&
    typeof payload.codeVerifier === "string" &&
    payload.codeVerifier.length >= 32 &&
    typeof payload.redirectUrl === "string" &&
    payload.redirectUrl.length <= 2_048 &&
    Number.isSafeInteger(payload.issuedAt)
  );
}

export function createOAuthStateToken(provider, redirectUrl, secret, now = Date.now()) {
  const payload = {
    state: provider.state,
    codeVerifier: provider.codeVerifier,
    redirectUrl,
    issuedAt: now,
  };

  if (!isValidPayload(payload)) throw new Error("Invalid OAuth provider response");

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyOAuthStateToken(token, secret, now = Date.now()) {
  if (typeof token !== "string") throw new Error("Missing OAuth state cookie");

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid OAuth state cookie");
  }

  const expected = Buffer.from(sign(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Invalid OAuth state signature");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid OAuth state payload");
  }

  if (!isValidPayload(payload)) throw new Error("Invalid OAuth state payload");
  if (payload.issuedAt > now + 60_000 || now - payload.issuedAt > OAUTH_STATE_TTL_MS) {
    throw new Error("OAuth state has expired");
  }

  return payload;
}

export function buildOAuthAuthorizationUrl(authUrl, redirectUrl) {
  if (typeof authUrl !== "string" || !authUrl.startsWith("https://")) {
    throw new Error("Invalid OAuth authorization URL");
  }
  return `${authUrl}${redirectUrl}`;
}
