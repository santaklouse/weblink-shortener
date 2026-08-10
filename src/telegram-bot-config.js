import "dotenv/config";
import {createHash} from "node:crypto";
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);
const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.url().optional(),
);

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().min(20),
  TELEGRAM_INTERNAL_SECRET: z.string().min(32),
  APP_INTERNAL_URL: z.url().default("http://app:3000"),
  TELEGRAM_WEBAPP_URL: z.url(),
  TELEGRAM_WEBHOOK_URL: optionalUrl,
  TELEGRAM_WEBHOOK_SECRET: optionalString.refine(
    (value) => value === undefined || /^[A-Za-z0-9_-]{32,256}$/.test(value),
    "must contain 32-256 characters using only A-Z, a-z, 0-9, underscores, and hyphens",
  ),
  TELEGRAM_WEBHOOK_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
  TELEGRAM_VALIDATOR_HOST: z.string().trim().min(1).default("0.0.0.0"),
  TELEGRAM_VALIDATOR_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  TELEGRAM_WEBAPP_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().min(300).max(604_800).default(86_400),
});

export function loadTelegramBotConfig(environment = process.env) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid Telegram bot configuration:\n${details}`);
  }

  const webhookUrl = result.data.TELEGRAM_WEBHOOK_URL
    || new URL("/api/telegram/webhook", result.data.TELEGRAM_WEBAPP_URL).toString();
  if (new URL(webhookUrl).protocol !== "https:") {
    throw new Error("Invalid Telegram bot configuration:\nTELEGRAM_WEBHOOK_URL: must use HTTPS");
  }
  const webhookSecret = result.data.TELEGRAM_WEBHOOK_SECRET
    || createHash("sha256").update(result.data.TELEGRAM_INTERNAL_SECRET).digest("base64url");

  return {
    botToken: result.data.TELEGRAM_BOT_TOKEN,
    internalSecret: result.data.TELEGRAM_INTERNAL_SECRET,
    appInternalUrl: result.data.APP_INTERNAL_URL.replace(/\/$/, ""),
    webAppUrl: result.data.TELEGRAM_WEBAPP_URL,
    webhookUrl,
    webhookSecret,
    webhookMaxConnections: result.data.TELEGRAM_WEBHOOK_MAX_CONNECTIONS,
    validatorHost: result.data.TELEGRAM_VALIDATOR_HOST,
    validatorPort: result.data.TELEGRAM_VALIDATOR_PORT,
    webAppAuthMaxAgeSeconds: result.data.TELEGRAM_WEBAPP_AUTH_MAX_AGE_SECONDS,
  };
}
