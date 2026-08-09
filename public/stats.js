const message = document.querySelector("#stats-message");
const statsData = document.querySelector("#stats-data");
const analyticsData = document.querySelector("#analytics-data");
const token = window.location.pathname.split("/").filter(Boolean).at(-1);
const refreshIntervalMs = 10_000;
let refreshTimer;
let requestInFlight = false;
let hasLoadedStats = false;

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  if (document.hidden) return;
  refreshTimer = window.setTimeout(() => loadStats({ background: true }), refreshIntervalMs);
}

async function loadStats({ background = false } = {}) {
  if (requestInFlight) return;
  requestInFlight = true;

  try {
    const response = await fetch(`/api/stats/${encodeURIComponent(token)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Statistics not found");

    renderLink(data.link);
    renderAnalytics(data.analytics);
    message.textContent = "";
    message.classList.remove("error");
    statsData.hidden = false;
    analyticsData.hidden = false;
    hasLoadedStats = true;
  } catch (error) {
    message.textContent = background && hasLoadedStats
      ? "Live update delayed. Retrying automatically…"
      : error.message;
    message.classList.add("error");
  } finally {
    requestInFlight = false;
    scheduleRefresh();
  }
}

function renderLink(link) {
  const shortAnchor = document.querySelector("#stats-short-url");
  shortAnchor.href = link.shortUrl;
  shortAnchor.textContent = link.shortUrl;
  const targetAnchor = document.querySelector("#stats-target-url");
  targetAnchor.href = link.targetUrl;
  targetAnchor.textContent = link.targetUrl;
  document.querySelector("#stats-clicks").textContent = String(link.clicks);
  document.querySelector("#stats-created").textContent = new Date(link.created).toLocaleString("en-US");
  document.querySelector("#stats-status").textContent = link.expired
    ? "Expired"
    : link.active
      ? link.expiresAt
        ? `Active until ${new Date(link.expiresAt).toLocaleString("en-US")}`
        : "Active"
      : "Disabled";
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy command was rejected");
}

for (const button of document.querySelectorAll(".copy-url-button")) {
  button.addEventListener("click", async () => {
    const anchor = document.querySelector(`#${button.dataset.copyTarget}`);
    if (!anchor?.textContent) return;

    const originalLabel = button.getAttribute("aria-label");
    const originalTitle = button.title;
    button.disabled = true;
    try {
      await copyText(anchor.textContent);
      button.setAttribute("aria-label", "URL copied");
      button.title = "Copied";
      button.classList.add("copied");
      window.setTimeout(() => {
        button.setAttribute("aria-label", originalLabel);
        button.title = originalTitle;
        button.classList.remove("copied");
        button.disabled = false;
      }, 1_500);
    } catch {
      button.disabled = false;
      message.textContent = "Could not copy the URL automatically.";
      message.classList.add("error");
    }
  });
}

function renderAnalytics(analytics) {
  document.querySelector("#total-clicks").textContent = String(analytics.totals.clicks);
  document.querySelector("#unique-visitors").textContent = String(analytics.totals.uniqueVisitors);
  document.querySelector("#recorded-events").textContent = String(analytics.totals.recordedEvents);

  renderBreakdown("#countries-body", analytics.countries, (item) => `${item.name} (${item.code})`);
  renderBreakdown("#referrers-body", analytics.referrers, (item) => item.name);
  renderBreakdown("#devices-body", analytics.devices, (item) => item.name);
  renderBreakdown("#browsers-body", analytics.browsers, (item) => item.name);
  renderBreakdown("#os-body", analytics.operatingSystems, (item) => item.name);

  const recentRows = analytics.recentClicks.map((click) => {
    const row = document.createElement("tr");
    row.append(
      cell(new Date(click.occurredAt).toLocaleString("en-US")),
      cell(`${click.country} (${click.countryCode})`),
      referrerCell(click),
      cell(click.ipAddress),
      cell(`${click.device} · ${click.browser} · ${click.os}`),
    );
    return row;
  });

  if (recentRows.length === 0) recentRows.push(emptyRow(5, "No detailed click events yet."));
  document.querySelector("#recent-clicks-body").replaceChildren(...recentRows);
}

function renderBreakdown(selector, items, label) {
  const rows = items.map((item) => {
    const row = document.createElement("tr");
    row.append(cell(label(item)), cell(String(item.clicks)));
    return row;
  });
  if (rows.length === 0) rows.push(emptyRow(2, "No data yet."));
  document.querySelector(selector).replaceChildren(...rows);
}

function referrerCell(click) {
  const container = document.createElement("td");
  if (!click.referrer) {
    container.textContent = "Direct";
    return container;
  }
  const anchor = document.createElement("a");
  anchor.href = click.referrer;
  anchor.textContent = click.referrerHost;
  anchor.title = click.referrer;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer nofollow";
  container.append(anchor);
  return container;
}

function cell(value) {
  const element = document.createElement("td");
  element.textContent = value;
  return element;
}

function emptyRow(columns, text) {
  const row = document.createElement("tr");
  const element = cell(text);
  element.colSpan = columns;
  row.append(element);
  return row;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    window.clearTimeout(refreshTimer);
  } else {
    loadStats({ background: true });
  }
});

window.addEventListener("online", () => loadStats({ background: true }));
window.addEventListener("beforeunload", () => window.clearTimeout(refreshTimer));

loadStats();
