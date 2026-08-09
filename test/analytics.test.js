import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnalytics,
  hashVisitor,
  maskIpAddress,
  normalizeReferrer,
  parseUserAgent,
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
});
