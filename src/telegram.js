import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TELEGRAM_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const TELEGRAM_USERNAME_PATTERN = /^[A-Za-z0-9_]{0,32}$/;

export function generateTelegramLinkToken() {
  return randomBytes(32).toString("base64url");
}

export function hashTelegramLinkToken(token, secret) {
  if (!LINK_TOKEN_PATTERN.test(token || "")) throw new Error("Invalid Telegram login token");
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Telegram integration is not configured");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function buildTelegramDeepLink(username, token) {
  const normalizedUsername = String(username || "").replace(/^@/, "");
  if (!/^(?=.{5,32}$)[A-Za-z][A-Za-z0-9_]*bot$/i.test(normalizedUsername)) {
    throw new Error("Telegram bot username is not configured");
  }
  if (!LINK_TOKEN_PATTERN.test(token || "")) throw new Error("Invalid Telegram login token");
  return `https://t.me/${normalizedUsername}?start=link_${token}`;
}

export function parseTelegramLinkParameter(value) {
  const match = /^link_([A-Za-z0-9_-]{43})$/.exec(String(value || ""));
  return match?.[1] || null;
}

export function normalizeTelegramIdentity(value) {
  const userId = String(value?.userId ?? "");
  const chatId = String(value?.chatId ?? "");
  if (!TELEGRAM_ID_PATTERN.test(userId) || !TELEGRAM_ID_PATTERN.test(chatId)) {
    throw new Error("Invalid Telegram identity");
  }
  if (userId !== chatId) throw new Error("Telegram account linking is allowed only in a private chat");

  const username = typeof value?.username === "string" ? value.username.trim().replace(/^@/, "") : "";
  if (!TELEGRAM_USERNAME_PATTERN.test(username)) throw new Error("Invalid Telegram username");
  const firstName = typeof value?.firstName === "string"
    ? value.firstName.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 128)
    : "";

  return { userId, chatId, username, firstName };
}

export function matchesInternalSecret(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string" || expected.length < 32) {
    return false;
  }
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}
