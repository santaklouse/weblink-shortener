const message = document.querySelector("#stats-message");
const statsData = document.querySelector("#stats-data");
const analyticsData = document.querySelector("#analytics-data");
const token = window.location.pathname.split("/").filter(Boolean).at(-1);
const refreshIntervalMs = 10_000;
let refreshTimer;
let requestInFlight = false;
let hasLoadedStats = false;
const expandedClickIds = new Set();

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
  document.querySelector("#privacy-note").hidden = analytics.sensitiveDataHidden !== true;
  document.querySelector("#total-clicks").textContent = String(analytics.totals.clicks);
  document.querySelector("#unique-visitors").textContent = String(analytics.totals.uniqueVisitors);
  document.querySelector("#recorded-events").textContent = String(analytics.totals.recordedEvents);

  renderBreakdown("#countries-body", analytics.countries, (item) => `${item.name} (${item.code})`);
  renderBreakdown("#referrers-body", analytics.referrers, (item) => item.name);
  renderBreakdown("#devices-body", analytics.devices, (item) => item.name);
  renderBreakdown("#browsers-body", analytics.browsers, (item) => item.name);
  renderBreakdown("#os-body", analytics.operatingSystems, (item) => item.name);

  const recentRows = analytics.recentClicks.flatMap((click, index) => {
    const clickId = click.id || `${click.occurredAt}-${index}`;
    const detailId = `click-details-${clickId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    const summaryRow = document.createElement("tr");
    summaryRow.className = "click-summary-row";

    const timeCell = document.createElement("td");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "click-details-toggle";
    toggle.setAttribute("aria-controls", detailId);
    toggle.append(
      requestChevron(),
      document.createTextNode(new Date(click.occurredAt).toLocaleString("en-US")),
    );
    timeCell.append(toggle);

    summaryRow.append(
      timeCell,
      cell(`${click.country} (${click.countryCode})`),
      referrerCell(click),
      cell(click.ipAddress),
      cell(`${click.device} · ${click.browser} · ${click.os}`),
    );
    const detailsRow = requestDetailsRow(click, detailId);

    const setExpanded = (expanded) => {
      toggle.setAttribute("aria-expanded", String(expanded));
      detailsRow.hidden = !expanded;
      summaryRow.classList.toggle("expanded", expanded);
      if (expanded) expandedClickIds.add(clickId);
      else expandedClickIds.delete(clickId);
    };
    const toggleExpanded = () => setExpanded(toggle.getAttribute("aria-expanded") !== "true");

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleExpanded();
    });
    summaryRow.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      toggleExpanded();
    });
    setExpanded(expandedClickIds.has(clickId));
    return [summaryRow, detailsRow];
  });

  if (recentRows.length === 0) recentRows.push(emptyRow(5, "No detailed click events yet."));
  document.querySelector("#recent-clicks-body").replaceChildren(...recentRows);
}

function requestChevron() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m9 6 6 6-6 6");
  svg.append(path);
  return svg;
}

function requestDetailsRow(click, detailId) {
  const row = document.createElement("tr");
  row.id = detailId;
  row.className = "click-details-row";

  const containerCell = document.createElement("td");
  containerCell.colSpan = 5;
  const panel = document.createElement("div");
  panel.className = "request-details-panel";

  const heading = document.createElement("h3");
  heading.textContent = "Request details";
  const requestLine = document.createElement("code");
  requestLine.className = "request-line";
  requestLine.textContent = formatRequestLine(click.request);
  panel.append(heading, requestLine, requestMetadata(click));

  const headersHeading = document.createElement("h4");
  headersHeading.textContent = "Request headers";
  panel.append(headersHeading, requestHeadersTable(click.request?.headers));
  containerCell.append(panel);
  row.append(containerCell);
  return row;
}

function formatRequestLine(request = {}) {
  const method = request.method || "GET";
  const origin = request.protocol && request.host ? `${request.protocol}://${request.host}` : "";
  const target = request.path ? `${origin}${request.path}` : "Request target not recorded";
  const version = request.httpVersion ? ` HTTP/${request.httpVersion}` : "";
  return `${method} ${target}${version}`;
}

function requestMetadata(click) {
  const list = document.createElement("dl");
  list.className = "request-metadata";
  const entries = [
    ["Event ID", click.id || "Not recorded"],
    ["Occurred", new Date(click.occurredAt).toLocaleString("en-US")],
    ["Country", `${click.country} (${click.countryCode})`],
    ["Visitor address", click.ipAddress],
    ["Referrer", click.referrer || "Direct"],
    ["Client", `${click.device} · ${click.browser} · ${click.os}`],
  ];

  for (const [term, value] of entries) {
    const group = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    group.append(dt, dd);
    list.append(group);
  }
  return list;
}

function requestHeadersTable(headers) {
  const entries = headers && typeof headers === "object"
    ? Object.entries(headers).sort(([left], [right]) => left.localeCompare(right))
    : [];
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "request-headers-empty";
    empty.textContent = "No request headers were recorded for this event.";
    return empty;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "request-headers-wrap";
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const nameHeading = document.createElement("th");
  nameHeading.textContent = "Header";
  const valueHeading = document.createElement("th");
  valueHeading.textContent = "Value";
  headRow.append(nameHeading, valueHeading);
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const [name, value] of entries) {
    const row = document.createElement("tr");
    row.append(cell(name), cell(String(value)));
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
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
