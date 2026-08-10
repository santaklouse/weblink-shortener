import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().min(20),
  TELEGRAM_INTERNAL_SECRET: z.string().min(32),
  APP_INTERNAL_URL: z.url().default("http://app:3000"),
  TELEGRAM_POLL_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(50).default(25),
});

export function loadTelegramBotConfig(environment = process.env) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid Telegram bot configuration:\n${details}`);
  }

  return {
    botToken: result.data.TELEGRAM_BOT_TOKEN,
    internalSecret: result.data.TELEGRAM_INTERNAL_SECRET,
    appInternalUrl: result.data.APP_INTERNAL_URL.replace(/\/$/, ""),
    pollTimeoutSeconds: result.data.TELEGRAM_POLL_TIMEOUT_SECONDS,
  };
}
