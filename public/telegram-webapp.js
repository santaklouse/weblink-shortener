const telegram = window.Telegram?.WebApp;
const initData = telegram?.initData || "";
const loadingPanel = document.querySelector("#loading-panel");
const errorPanel = document.querySelector("#error-panel");
const connectPanel = document.querySelector("#connect-panel");
const appPanel = document.querySelector("#app-panel");
const errorMessage = document.querySelector("#error-message");
const accountLabel = document.querySelector("#account-label");
const linksList = document.querySelector("#links-list");
const linksCount = document.querySelector("#links-count");
const emptyLinks = document.querySelector("#empty-links");
const linksMessage = document.querySelector("#links-message");
const createForm = document.querySelector("#create-form");
const createMessage = document.querySelector("#create-message");
const editDialog = document.querySelector("#edit-dialog");
const editForm = document.querySelector("#edit-form");
const editMessage = document.querySelector("#edit-message");
const statsDialog = document.querySelector("#stats-dialog");
const statsContent = document.querySelector("#stats-content");
const detailedStatsButton = document.querySelector("#open-detailed-stats");
let editingLink = null;
let detailedStatsUrl = "";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function showOnly(panel) {
  for (const item of [loadingPanel, errorPanel, connectPanel, appPanel]) item.hidden = item !== panel;
}

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function haptic(type = "light") {
  telegram?.HapticFeedback?.impactOccurred(type);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Telegram-Init-Data", initData);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error || "The request failed", response.status);
  return data;
}

function button(label, action, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className) element.className = className;
  element.addEventListener("click", action);
  return element;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
  telegram?.HapticFeedback?.notificationOccurred("success");
}

function copyLinkIcon(value) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "copy-link-icon";
  element.title = "Copy short URL";
  element.setAttribute("aria-label", "Copy short URL");

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z");
  icon.append(path);
  element.append(icon);
  element.addEventListener("click", async () => {
    try {
      await copyText(value);
      element.classList.add("copied");
      element.title = "Copied";
      element.setAttribute("aria-label", "Short URL copied");
      window.setTimeout(() => {
        element.classList.remove("copied");
        element.title = "Copy short URL";
        element.setAttribute("aria-label", "Copy short URL");
      }, 1200);
    } catch (error) {
      setMessage(linksMessage, error.message, true);
    }
  });
  return element;
}

function confirmAction(message) {
  if (telegram?.showConfirm) {
    return new Promise((resolve) => telegram.showConfirm(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}

function renderBreakdown(title, items) {
  const section = document.createElement("section");
  section.className = "breakdown";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  if (!items?.length) {
    const empty = document.createElement("p");
    empty.className = "form-message";
    empty.textContent = "No data yet.";
    section.append(empty);
    return section;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    const name = document.createElement("span");
    name.textContent = item.name;
    const clicks = document.createElement("span");
    clicks.textContent = String(item.clicks);
    row.append(name, clicks);
    section.append(row);
  }
  return section;
}

async function showStatistics(link) {
  haptic();
  try {
    const data = await api(`/api/telegram/webapp/links/${encodeURIComponent(link.id)}/stats`);
    document.querySelector("#stats-title").textContent = `Statistics · ${data.link.slug}`;
    statsContent.replaceChildren();
    const totals = document.createElement("div");
    totals.className = "stats-total-grid";
    for (const [value, label] of [
      [data.analytics.totals.clicks, "Total clicks"],
      [data.analytics.totals.uniqueVisitors, "Unique visitors"],
    ]) {
      const card = document.createElement("div");
      card.className = "stats-total";
      const strong = document.createElement("strong");
      strong.textContent = String(value);
      const span = document.createElement("span");
      span.textContent = label;
      card.append(strong, span);
      totals.append(card);
    }
    statsContent.append(
      totals,
      renderBreakdown("Countries", data.analytics.countries),
      renderBreakdown("Referrers", data.analytics.referrers),
      renderBreakdown("Devices", data.analytics.devices),
      renderBreakdown("Browsers", data.analytics.browsers),
      renderBreakdown("Operating systems", data.analytics.operatingSystems),
    );
    detailedStatsUrl = data.link.statsUrl;
    statsDialog.showModal();
  } catch (error) {
    setMessage(linksMessage, error.message, true);
  }
}

function openEditor(link) {
  haptic();
  editingLink = link;
  editForm.elements.url.value = link.targetUrl;
  editForm.elements.slug.value = link.slug;
  editForm.elements.statsPublic.checked = link.statsPublic === true;
  setMessage(editMessage, "");
  editDialog.showModal();
}

async function toggleLink(link) {
  try {
    await api(`/api/telegram/webapp/links/${encodeURIComponent(link.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !link.active }),
    });
    haptic("medium");
    await loadLinks();
  } catch (error) {
    setMessage(linksMessage, error.message, true);
  }
}

async function deleteLink(link) {
  if (!await confirmAction(`Delete ${link.slug}? This cannot be undone.`)) return;
  try {
    await api(`/api/telegram/webapp/links/${encodeURIComponent(link.id)}`, { method: "DELETE" });
    telegram?.HapticFeedback?.notificationOccurred("success");
    await loadLinks();
  } catch (error) {
    setMessage(linksMessage, error.message, true);
  }
}

function renderLink(link) {
  const card = document.createElement("article");
  card.className = "link-card";
  const titleRow = document.createElement("div");
  titleRow.className = "link-title-row";
  const title = document.createElement("h3");
  title.className = "link-title";
  title.textContent = link.slug;
  const status = document.createElement("span");
  status.className = `status-pill${link.active ? "" : " disabled"}`;
  status.textContent = link.active ? "Active" : "Disabled";
  titleRow.append(title, status);

  const shortUrlRow = document.createElement("div");
  shortUrlRow.className = "short-url-row";
  const shortUrl = document.createElement("a");
  shortUrl.className = "short-url";
  shortUrl.href = link.shortUrl;
  shortUrl.target = "_blank";
  shortUrl.rel = "noopener noreferrer";
  shortUrl.textContent = link.shortUrl;
  shortUrlRow.append(shortUrl, copyLinkIcon(link.shortUrl));
  const destination = document.createElement("span");
  destination.className = "destination";
  destination.textContent = `→ ${link.targetUrl}`;
  const meta = document.createElement("p");
  meta.className = "link-meta";
  meta.textContent = `${link.clicks} clicks · ${link.statsPublic ? "Public statistics" : "Private statistics"}${link.created ? ` · ${formatDate(link.created)}` : ""}`;

  const actions = document.createElement("div");
  actions.className = "link-actions";
  actions.append(
    button("Stats", () => showStatistics(link)),
    button("Edit", () => openEditor(link)),
    button(link.active ? "Disable" : "Enable", () => toggleLink(link)),
    button("Delete", () => deleteLink(link), "danger"),
  );
  card.append(titleRow, shortUrlRow, destination, meta, actions);
  return card;
}

async function loadLinks() {
  setMessage(linksMessage, "Refreshing…");
  try {
    const data = await api("/api/telegram/webapp/links");
    linksList.replaceChildren(...data.links.map(renderLink));
    linksCount.textContent = String(data.links.length);
    emptyLinks.hidden = data.links.length !== 0;
    setMessage(linksMessage, "");
  } catch (error) {
    setMessage(linksMessage, error.message, true);
  }
}

async function start() {
  showOnly(loadingPanel);
  if (!telegram || !initData) {
    errorMessage.textContent = "Open this Mini App from @weblink_shortener_bot in Telegram.";
    showOnly(errorPanel);
    return;
  }

  telegram.ready();
  telegram.expand();
  try {
    telegram.setHeaderColor("secondary_bg_color");
    telegram.setBackgroundColor("bg_color");
  } catch {
    // Older Telegram clients may not support dynamic colors.
  }

  try {
    const data = await api("/api/telegram/webapp/me");
    const telegramName = data.telegram.username
      ? `@${data.telegram.username}`
      : data.telegram.firstName || "Telegram";
    accountLabel.textContent = `${telegramName} · ${data.user.email}`;
    showOnly(appPanel);
    await loadLinks();
  } catch (error) {
    if (error.status === 401 && error.message.includes("not connected")) {
      showOnly(connectPanel);
      return;
    }
    errorMessage.textContent = error.message;
    showOnly(errorPanel);
  }
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = createForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  setMessage(createMessage, "Creating…");
  const values = new FormData(createForm);
  try {
    await api("/api/telegram/webapp/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: values.get("url"),
        ...(values.get("slug") ? { alias: values.get("slug") } : {}),
      }),
    });
    createForm.reset();
    setMessage(createMessage, "Link created.");
    telegram?.HapticFeedback?.notificationOccurred("success");
    await loadLinks();
  } catch (error) {
    setMessage(createMessage, error.message, true);
  } finally {
    submit.disabled = false;
  }
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingLink) return;
  const submit = editForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  setMessage(editMessage, "Saving…");
  const values = new FormData(editForm);
  try {
    await api(`/api/telegram/webapp/links/${encodeURIComponent(editingLink.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: values.get("url"),
        alias: values.get("slug"),
        statsPublic: values.get("statsPublic") === "on",
      }),
    });
    editDialog.close();
    editingLink = null;
    telegram?.HapticFeedback?.notificationOccurred("success");
    await loadLinks();
  } catch (error) {
    setMessage(editMessage, error.message, true);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#refresh-button").addEventListener("click", () => loadLinks());
document.querySelector("#retry-button").addEventListener("click", () => start());
document.querySelector("#open-website-button").addEventListener("click", () => telegram.openLink(window.location.origin));
document.querySelector("#edit-close").addEventListener("click", () => editDialog.close());
document.querySelector("#stats-close").addEventListener("click", () => statsDialog.close());
detailedStatsButton.addEventListener("click", () => {
  if (detailedStatsUrl) telegram.openLink(detailedStatsUrl);
});

start();
