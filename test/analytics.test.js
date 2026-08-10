import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnalytics,
  captureClickDetails,
  hashVisitor,
  maskIpAddress,
  normalizeReferrer,
  parseUserAgent,
  sanitizeRequestHeaders,
} from "../src/analytics.js";

test("masks IPv4 and IPv6 visitor addresses", () => {
  assert.equal(maskIpAddress("203.0.113.74"), "203.0.113.0");
  assert.equal(maskIpAddress("2001:db8:abcd:12::1"), "2001:0db8:abcd::");
  assert.equal(maskIpAddress("not-an-ip"), "Unknown");
});

test("creates stable keyed visitor hashes", () => {
  const secret = "a-secure-test-secret-with-32-characters";
  const first = hashVisitor("203.0.113.74", secret);
  assert.equal(first, hashVisitor("203.0.113.74", secret));
  assert.notEqual(first, hashVisitor("203.0.113.75", secret));
  assert.equal(first.length, 64);
});

test("normalizes HTTP referrers and rejects other schemes", () => {
  assert.deepEqual(normalizeReferrer("https://news.example.com/page?q=1"), {
    url: "https://news.example.com/page?q=1",
    host: "news.example.com",
  });
  assert.deepEqual(normalizeReferrer("data:text/plain,test"), { url: "", host: "Direct" });
});

test("classifies common browser, operating system, and device values", () => {
  const chromeAndroid = parseUserAgent(
    "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
  );
  assert.deepEqual(chromeAndroid, { device: "Mobile", browser: "Chrome", os: "Android" });
});

test("captures request metadata while redacting credentials and full client IP headers", async () => {
  const headers = {
    accept: "text/html",
    authorization: "Bearer visitor-secret-token",
    cookie: "weblink_session=visitor-session-token",
    "cf-warp-tag-id": "visitor-warp-identifier",
    "user-agent": "Mozilla/5.0 Firefox/141.0",
    "x-forwarded-for": "203.0.113.74",
  };
  const request = {
    headers,
    httpVersion: "1.1",
    ip: "203.0.113.74",
    method: "GET",
    originalUrl: "/docs?utm_source=newsletter&token=private-value",
    protocol: "https",
    get(name) {
      return headers[name.toLowerCase()] || (name.toLowerCase() === "host" ? "app.example.com" : undefined);
    },
  };

  const details = await captureClickDetails(
    request,
    { analyticsHashSecret: "a-secure-test-secret-with-32-characters", trustCloudflareHeaders: false },
    { lookup: () => "US" },
  );

  assert.equal(details.requestMethod, "GET");
  assert.equal(details.requestProtocol, "https");
  assert.equal(details.requestHost, "app.example.com");
  assert.equal(details.requestPath, "/docs?utm_source=newsletter&token=%5Bredacted%5D");
  assert.equal(details.httpVersion, "1.1");
  assert.equal(details.requestHeaders.authorization, "[redacted]");
  assert.equal(details.requestHeaders.cookie, "[redacted]");
  assert.equal(details.requestHeaders["cf-warp-tag-id"], "[redacted for privacy]");
  assert.equal(details.requestHeaders["x-forwarded-for"], "[redacted for privacy]");
  assert.equal(JSON.stringify(details).includes("visitor-secret-token"), false);
  assert.equal(JSON.stringify(details).includes("visitor-session-token"), false);
  assert.equal(JSON.stringify(details).includes("visitor-warp-identifier"), false);
  assert.equal(JSON.stringify(details).includes("private-value"), false);
});

test("normalizes request header names and values", () => {
  assert.deepEqual(
    sanitizeRequestHeaders({ "X-Custom Header": "line one\nline two", "X-API-Key": "secret" }),
    { "x-customheader": "line one line two", "x-api-key": "[redacted]" },
  );
});

test("uses trusted Cloudflare visitor metadata for the public request protocol", async () => {
  const headers = { "cf-visitor": '{"scheme":"https"}', host: "app.example.com" };
  const request = {
    headers,
    httpVersion: "1.1",
    ip: "203.0.113.74",
    method: "GET",
    originalUrl: "/short",
    protocol: "http",
    get(name) { return headers[name.toLowerCase()]; },
  };
  const details = await captureClickDetails(
    request,
    { analyticsHashSecret: "a-secure-test-secret-with-32-characters", trustCloudflareHeaders: true },
    { lookup: () => "US" },
  );
  assert.equal(details.requestProtocol, "https");
});

test("aggregates detailed click analytics", () => {
  const events = [
    {
      created: "2026-08-09T10:00:00Z",
      visitorHash: "visitor-a",
      countryCode: "US",
      referrerHost: "news.example.com",
      referrer: "https://news.example.com/story",
      ipAddress: "203.0.113.0",
      device: "Mobile",
      browser: "Chrome",
      os: "Android",
      requestMethod: "GET",
      requestProtocol: "https",
      requestHost: "app.example.com",
      requestPath: "/short",
      httpVersion: "1.1",
      requestHeaders: { accept: "text/html" },
    },
    {
      created: "2026-08-09T09:00:00Z",
      visitorHash: "visitor-a",
      countryCode: "US",
      referrerHost: "Direct",
      ipAddress: "203.0.113.0",
      device: "Desktop",
      browser: "Firefox",
      os: "Linux",
    },
  ];

  const analytics = buildAnalytics(events, 2, 10);
  assert.deepEqual(analytics.totals, { clicks: 2, recordedEvents: 2, uniqueVisitors: 1 });
  assert.equal(analytics.countries[0].code, "US");
  assert.equal(analytics.countries[0].clicks, 2);
  assert.equal(analytics.recentClicks.length, 2);
  assert.deepEqual(analytics.recentClicks[0].request, {
    method: "GET",
    protocol: "https",
    host: "app.example.com",
    path: "/short",
    httpVersion: "1.1",
    headers: { accept: "text/html" },
  });
});
