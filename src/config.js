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
    ANALYTICS_HASH_SECRET: optionalString,
    ANALYTICS_MAX_EVENTS: z.coerce.number().int().min(100).max(20_000).default(5_000),
    ANALYTICS_RECENT_EVENTS: z.coerce.number().int().min(10).max(200).default(50),
    GEOIP_DB_PATH: optionalString,
    TRUST_CLOUDFLARE_HEADERS: booleanFromEnv.default(false),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_USERNAME: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_TLS: booleanFromEnv.default(false),
    SMTP_AUTH_METHOD: z.enum(["PLAIN", "LOGIN"]).optional(),
    SMTP_LOCAL_NAME: optionalString,
    MAIL_FROM_NAME: z.string().trim().min(1).max(255).default("Weblink Shortener"),
    MAIL_FROM_ADDRESS: optionalString,
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
    if (!env.ANALYTICS_HASH_SECRET && env.NODE_ENV === "production") {
      context.addIssue({
        code: "custom",
        path: ["ANALYTICS_HASH_SECRET"],
        message: "Set ANALYTICS_HASH_SECRET to at least 32 random characters in production",
      });
    }
    if (env.ANALYTICS_HASH_SECRET && env.ANALYTICS_HASH_SECRET.length < 32) {
      context.addIssue({
        code: "custom",
        path: ["ANALYTICS_HASH_SECRET"],
        message: "ANALYTICS_HASH_SECRET must contain at least 32 characters",
      });
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_ID"],
        message: "Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or leave both empty",
      });
    }
    if (env.SMTP_HOST && !env.MAIL_FROM_ADDRESS) {
      context.addIssue({
        code: "custom",
        path: ["MAIL_FROM_ADDRESS"],
        message: "Set MAIL_FROM_ADDRESS when SMTP_HOST is configured",
      });
    }
    if (Boolean(env.SMTP_USERNAME) !== Boolean(env.SMTP_PASSWORD)) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_USERNAME"],
        message: "Set both SMTP_USERNAME and SMTP_PASSWORD, or leave both empty",
      });
    }
    if (env.MAIL_FROM_ADDRESS && !z.email().safeParse(env.MAIL_FROM_ADDRESS).success) {
      context.addIssue({
        code: "custom",
        path: ["MAIL_FROM_ADDRESS"],
        message: "Enter a valid sender email address",
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
    analyticsHashSecret:
      result.data.ANALYTICS_HASH_SECRET ||
      result.data.POCKETBASE_TOKEN ||
      result.data.POCKETBASE_SUPERUSER_PASSWORD,
    analyticsMaxEvents: result.data.ANALYTICS_MAX_EVENTS,
    analyticsRecentEvents: result.data.ANALYTICS_RECENT_EVENTS,
    geoIpDatabasePath: result.data.GEOIP_DB_PATH,
    trustCloudflareHeaders: result.data.TRUST_CLOUDFLARE_HEADERS,
    googleClientId: result.data.GOOGLE_CLIENT_ID,
    googleClientSecret: result.data.GOOGLE_CLIENT_SECRET,
    smtpHost: result.data.SMTP_HOST,
    smtpPort: result.data.SMTP_PORT,
    smtpUsername: result.data.SMTP_USERNAME,
    smtpPassword: result.data.SMTP_PASSWORD,
    smtpTls: result.data.SMTP_TLS,
    smtpAuthMethod: result.data.SMTP_AUTH_METHOD,
    smtpLocalName: result.data.SMTP_LOCAL_NAME,
    mailFromName: result.data.MAIL_FROM_NAME,
    mailFromAddress: result.data.MAIL_FROM_ADDRESS,
  };
}
