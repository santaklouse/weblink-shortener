import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export async function captureClickDetails(request, config, geoIpResolver) {
  const ipAddress = getClientIp(request, config.trustCloudflareHeaders);
  const countryCode = geoIpResolver.lookup(ipAddress, request.get("cf-ipcountry"));
  const referrer = normalizeReferrer(request.get("referer"));
  const userAgent = parseUserAgent(request.get("user-agent"));

  return {
    countryCode,
    referrer: referrer.url,
    referrerHost: referrer.host,
    ipAddress: maskIpAddress(ipAddress),
    visitorHash: hashVisitor(ipAddress, config.analyticsHashSecret),
    device: userAgent.device,
    browser: userAgent.browser,
    os: userAgent.os,
  };
}

export function getClientIp(request, trustCloudflareHeaders = false) {
  const candidate = trustCloudflareHeaders
    ? request.get("cf-connecting-ip") || request.ip
    : request.ip;
  if (typeof candidate !== "string") return "";
  const withoutMappedPrefix = candidate.trim().replace(/^::ffff:/i, "");
  return withoutMappedPrefix.split("%")[0];
}

export function maskIpAddress(value) {
  if (!value) return "Unknown";
  const version = isIP(value);

  if (version === 4) {
    const octets = value.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }

  if (version === 6) {
    const expanded = expandIpv6(value);
    if (!expanded) return "Unknown";
    return `${expanded.slice(0, 3).join(":")}::`;
  }

  return "Unknown";
}

function expandIpv6(value) {
  const halves = value.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map((part) =>
    part.padStart(4, "0"),
  );
}

export function hashVisitor(ipAddress, secret) {
  if (!ipAddress || !secret) return "";
  return createHmac("sha256", secret).update(ipAddress).digest("hex");
}

export function normalizeReferrer(value) {
  if (typeof value !== "string" || !value.trim()) return { url: "", host: "Direct" };

  try {
    const parsed = new URL(value.trim());
    if (!(["http:", "https:"].includes(parsed.protocol))) {
      return { url: "", host: "Direct" };
    }
    return {
      url: parsed.toString().slice(0, 2_048),
      host: parsed.hostname.toLowerCase().slice(0, 255),
    };
  } catch {
    return { url: "", host: "Direct" };
  }
}

export function parseUserAgent(value) {
  const ua = typeof value === "string" ? value : "";
  const device = /bot|crawler|spider|slurp/i.test(ua)
    ? "Bot"
    : /ipad|tablet/i.test(ua)
      ? "Tablet"
      : /mobile|android|iphone|ipod/i.test(ua)
        ? "Mobile"
        : "Desktop";

  let browser = "Other";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\//i.test(ua)) browser = "Opera";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/chrome\//i.test(ua) || /crios\//i.test(ua)) browser = "Chrome";
  else if (/safari\//i.test(ua)) browser = "Safari";

  let os = "Other";
  if (/windows nt/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  return { device, browser, os };
}

export function countryName(code) {
  if (!code || code === "XX") return "Unknown";
  if (code === "T1") return "Tor network";
  try {
    return countryNames.of(code) || code;
  } catch {
    return code;
  }
}

export function buildAnalytics(events, totalClicks, recentLimit = 50) {
  const uniqueVisitors = new Set();
  const countries = new Map();
  const referrers = new Map();
  const devices = new Map();
  const browsers = new Map();
  const operatingSystems = new Map();

  for (const event of events) {
    if (event.visitorHash) uniqueVisitors.add(event.visitorHash);
    increment(countries, event.countryCode || "XX");
    increment(referrers, event.referrerHost || "Direct");
    increment(devices, event.device || "Other");
    increment(browsers, event.browser || "Other");
    increment(operatingSystems, event.os || "Other");
  }

  return {
    totals: {
      clicks: totalClicks,
      recordedEvents: events.length,
      uniqueVisitors: uniqueVisitors.size,
    },
    countries: sortedBreakdown(countries).map((item) => ({
      code: item.name,
      name: countryName(item.name),
      clicks: item.clicks,
    })),
    referrers: sortedBreakdown(referrers),
    devices: sortedBreakdown(devices),
    browsers: sortedBreakdown(browsers),
    operatingSystems: sortedBreakdown(operatingSystems),
    recentClicks: events.slice(0, recentLimit).map((event) => ({
      occurredAt: event.created,
      countryCode: event.countryCode || "XX",
      country: countryName(event.countryCode),
      referrer: event.referrer || null,
      referrerHost: event.referrerHost || "Direct",
      ipAddress: event.ipAddress || "Unknown",
      device: event.device || "Other",
      browser: event.browser || "Other",
      os: event.os || "Other",
    })),
  };
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function sortedBreakdown(map) {
  return [...map.entries()]
    .map(([name, clicks]) => ({ name, clicks }))
    .sort((left, right) => right.clicks - left.clicks || left.name.localeCompare(right.name));
}
