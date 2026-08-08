import "dotenv/config";
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.url().optional(),
);

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.toLowerCase() === "true";
}, z.boolean());

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().trim().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    PUBLIC_BASE_URL: optionalUrl,
    POCKETBASE_URL: z.url().default("http://127.0.0.1:8090"),
    POCKETBASE_TOKEN: optionalString,
    POCKETBASE_SUPERUSER_EMAIL: optionalString,
    POCKETBASE_SUPERUSER_PASSWORD: optionalString,
    TRUST_PROXY: booleanFromEnv.default(false),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(30),
    SESSION_COOKIE_NAME: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default("weblink_session"),
    SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    ANONYMOUS_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  })
  .superRefine((env, context) => {
    const hasPasswordAuth = env.POCKETBASE_SUPERUSER_EMAIL && env.POCKETBASE_SUPERUSER_PASSWORD;
    if (!env.POCKETBASE_TOKEN && !hasPasswordAuth) {
      context.addIssue({
        code: "custom",
        path: ["POCKETBASE_TOKEN"],
        message:
          "Set POCKETBASE_TOKEN or both POCKETBASE_SUPERUSER_EMAIL and POCKETBASE_SUPERUSER_PASSWORD",
      });
    }
  });

export function loadConfig(environment = process.env) {
  const result = schema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${details}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    host: result.data.HOST,
    port: result.data.PORT,
    publicBaseUrl: result.data.PUBLIC_BASE_URL?.replace(/\/$/, ""),
    pocketBaseUrl: result.data.POCKETBASE_URL.replace(/\/$/, ""),
    pocketBaseToken: result.data.POCKETBASE_TOKEN,
    pocketBaseEmail: result.data.POCKETBASE_SUPERUSER_EMAIL,
    pocketBasePassword: result.data.POCKETBASE_SUPERUSER_PASSWORD,
    trustProxy: result.data.TRUST_PROXY,
    rateLimitMax: result.data.RATE_LIMIT_MAX,
    sessionCookieName: result.data.SESSION_COOKIE_NAME,
    sessionMaxAgeMs: result.data.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000,
    anonymousLinkTtlMs: result.data.ANONYMOUS_LINK_TTL_HOURS * 60 * 60 * 1_000,
  };
}
