import { randomBytes, randomInt } from "node:crypto";

const RANDOM_ALPHABET = "23456789abcdefghijkmnopqrstuvwxyz";
const ALIAS_PATTERN = /^[a-z0-9_-]{4,32}$/;
const RESERVED_ALIASES = new Set(["api", "health", "admin", "robots", "assets"]);

export function normalizeTargetUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("The URL must be a string no longer than 2048 characters");
  }

  const trimmed = value.trim();
  let parsed;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a complete URL, for example https://example.com/page");
  }

  if (!(["http:", "https:"].includes(parsed.protocol))) {
    throw new Error("Only http and https URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs containing embedded credentials are not supported");
  }

  return parsed.toString();
}

export function normalizeAlias(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("The slug must be a string");

  const alias = value.trim().toLowerCase();

  if (!ALIAS_PATTERN.test(alias)) {
    throw new Error("Slug: 4–32 characters using only a–z, 0–9, hyphens, and underscores");
  }

  if (RESERVED_ALIASES.has(alias)) {
    throw new Error("This slug is reserved by the service");
  }

  return alias;
}

export function generateSlug(length = 7) {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += RANDOM_ALPHABET[randomInt(RANDOM_ALPHABET.length)];
  }
  return result;
}

export function generateStatsToken() {
  return randomBytes(32).toString("base64url");
}

export function isValidSlug(value) {
  return typeof value === "string" && ALIAS_PATTERN.test(value);
}

export function getPublicBaseUrl(request, configuredBaseUrl) {
  if (configuredBaseUrl) return configuredBaseUrl;
  return `${request.protocol}://${request.get("host")}`;
}

export function isUniqueSlugError(error) {
  return error?.response?.data?.slug?.code === "validation_not_unique";
}
