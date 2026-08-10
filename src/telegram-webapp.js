import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { matchesInternalSecret, normalizeTelegramIdentity } from "./telegram.js";

const INIT_DATA_MAX_LENGTH = 8_192;

function constantTimeHexEqual(candidate, expected) {
  if (!/^[a-f0-9]{64}$/i.test(candidate || "") || !/^[a-f0-9]{64}$/i.test(expected || "")) {
    return false;
  }
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex"));
}

export function validateTelegramWebAppInitData(initData, botToken, {
  now = Date.now(),
  maxAgeSeconds = 86_400,
} = {}) {
  if (typeof initData !== "string" || initData.length === 0 || initData.length > INIT_DATA_MAX_LENGTH) {
    throw new Error("Telegram Mini App authentication data is missing");
  }
  if (typeof botToken !== "string" || botToken.length < 20) {
    throw new Error("Telegram bot token is not configured");
  }

  const parameters = new URLSearchParams(initData);
  const receivedHash = parameters.get("hash");
  if (!receivedHash) throw new Error("Telegram Mini App authentication hash is missing");

  parameters.delete("hash");
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!constantTimeHexEqual(receivedHash, expectedHash)) {
    throw new Error("Telegram Mini App authentication data is invalid");
  }

  const authDate = Number(parameters.get("auth_date"));
  const nowSeconds = Math.floor(now / 1_000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    throw new Error("Telegram Mini App authentication date is invalid");
  }
  if (authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new Error("Telegram Mini App authentication data has expired");
  }

  let user;
  try {
    user = JSON.parse(parameters.get("user") || "");
  } catch {
    throw new Error("Telegram Mini App user data is invalid");
  }
  if (user?.is_bot) throw new Error("Telegram bots cannot use this Mini App");

  return normalizeTelegramIdentity({
    userId: user?.id,
    chatId: user?.id,
    username: user?.username || "",
    firstName: user?.first_name || "",
  });
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createTelegramWebAppValidator({
  botToken,
  internalSecret,
  maxAgeSeconds,
}) {
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/validate") {
      return sendJson(response, 404, { error: "Not found" });
    }
    if (!matchesInternalSecret(request.headers["x-telegram-bot-secret"], internalSecret)) {
      return sendJson(response, 404, { error: "Not found" });
    }

    try {
      const body = await readJsonBody(request);
      const identity = validateTelegramWebAppInitData(body.initData, botToken, { maxAgeSeconds });
      return sendJson(response, 200, { identity });
    } catch (error) {
      return sendJson(response, 401, { error: error.message });
    }
  });
}
