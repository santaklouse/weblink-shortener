const shortenForm = document.querySelector("#shorten-form");
const formMessage = document.querySelector("#form-message");
const result = document.querySelector("#result");
const shortUrl = document.querySelector("#short-url");
const statsUrl = document.querySelector("#stats-url");
const copyButton = document.querySelector("#copy-button");
const expiryNote = document.querySelector("#expiry-note");
const aliasField = document.querySelector("#alias-field");
const authCard = document.querySelector("#auth-card");
const dashboard = document.querySelector("#dashboard");
const userSummary = document.querySelector("#user-summary");
const userEmail = document.querySelector("#user-email");
const linksBody = document.querySelector("#links-body");
const linksMessage = document.querySelector("#links-message");
const googleSignIn = document.querySelector("#google-sign-in");
const authDivider = document.querySelector("#auth-divider");
const authMessage = document.querySelector("#auth-message");
const telegramIntegration = document.querySelector("#telegram-integration");
const telegramStatus = document.querySelector("#telegram-status");
const telegramMessage = document.querySelector("#telegram-message");
const telegramConnectButton = document.querySelector("#telegram-connect-button");
const telegramOpenLink = document.querySelector("#telegram-open-link");
const telegramDisconnectButton = document.querySelector("#telegram-disconnect-button");
const editLinkDialog = document.querySelector("#edit-link-dialog");
const editLinkForm = document.querySelector("#edit-link-form");
const editLinkMessage = document.querySelector("#edit-link-message");
let currentUser = null;
let telegramConfigured = false;
let editingLink = null;

document.querySelector("#domain-prefix").textContent = `${window.location.host}/`;

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data?.error || "Request failed");
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

function renderSession() {
  const loggedIn = Boolean(currentUser);
  aliasField.hidden = !loggedIn;
  authCard.hidden = loggedIn;
  dashboard.hidden = !loggedIn;
  userSummary.hidden = !loggedIn;
  userEmail.textContent = currentUser?.email || "";
  telegramIntegration.hidden = !(loggedIn && telegramConfigured);
  if (loggedIn) {
    loadLinks();
    if (telegramConfigured) loadTelegramStatus();
  }
}

async function loadSession() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
  } catch (error) {
    if (error.status !== 401) formMessage.textContent = error.message;
  }
  renderSession();
}

async function loadAuthProviders() {
  try {
    const providers = await api("/api/auth/providers");
    googleSignIn.hidden = !providers.google;
    authDivider.hidden = !providers.google;
    telegramConfigured = Boolean(providers.telegram);
    telegramIntegration.hidden = !(currentUser && telegramConfigured);
    if (currentUser && telegramConfigured) loadTelegramStatus();
  } catch {
    googleSignIn.hidden = true;
    authDivider.hidden = true;
    telegramConfigured = false;
    telegramIntegration.hidden = true;
  }
}

async function loadTelegramStatus() {
  telegramMessage.textContent = "";
  try {
    const data = await api("/api/telegram/status");
    if (data.connected) {
      const accountName = data.account.username
        ? `@${data.account.username}`
        : data.account.firstName || "your Telegram account";
      telegramStatus.textContent = `Connected as ${accountName}.`;
      telegramConnectButton.hidden = true;
      telegramOpenLink.hidden = true;
      telegramDisconnectButton.hidden = false;
    } else {
      telegramStatus.textContent = "Connect Telegram to create, edit, manage, and inspect your links from a private chat.";
      telegramConnectButton.hidden = false;
      telegramOpenLink.hidden = true;
      telegramDisconnectButton.hidden = true;
    }
  } catch (error) {
    telegramMessage.textContent = error.message;
    telegramMessage.classList.add("error");
  }
}

telegramConnectButton.addEventListener("click", async () => {
  telegramMessage.textContent = "";
  telegramMessage.classList.remove("error");
  telegramConnectButton.disabled = true;
  try {
    const data = await api("/api/telegram/link", { method: "POST" });
    telegramOpenLink.href = data.botUrl;
    telegramOpenLink.hidden = false;
    telegramMessage.textContent = `The one-time login link expires at ${new Date(data.expiresAt).toLocaleTimeString("en-US")}.`;
  } catch (error) {
    telegramMessage.textContent = error.message;
    telegramMessage.classList.add("error");
  } finally {
    telegramConnectButton.disabled = false;
  }
});

telegramDisconnectButton.addEventListener("click", async () => {
  if (!window.confirm("Disconnect this Telegram account?")) return;
  telegramDisconnectButton.disabled = true;
  try {
    await api("/api/telegram/link", { method: "DELETE" });
    await loadTelegramStatus();
  } catch (error) {
    telegramMessage.textContent = error.message;
    telegramMessage.classList.add("error");
  } finally {
    telegramDisconnectButton.disabled = false;
  }
});

function showAuthenticationResult() {
  const url = new URL(window.location.href);
  const status = url.searchParams.get("auth");
  if (!status) return;

  if (status === "google-success") {
    formMessage.textContent = "Signed in with Google.";
  } else if (status === "cancelled") {
    authMessage.textContent = "Google sign-in was cancelled.";
  } else if (status === "google-failed") {
    authMessage.textContent = "Google sign-in failed. Please try again.";
    authMessage.classList.add("error");
  }

  url.searchParams.delete("auth");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function bindAuthForm(selector, endpoint) {
  const form = document.querySelector(selector);
  const message = form.querySelector(".message");
  const verificationLink = form.querySelector("#login-verification-link");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    message.classList.remove("error");
    if (verificationLink) verificationLink.hidden = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const values = new FormData(form);
      const data = await api(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
      });
      if (data.verificationRequired) {
        form.reset();
        const status = data.verificationEmailSent ? "sent" : "delivery-failed";
        window.location.assign(`/verify-email?status=${status}`);
        return;
      }
      currentUser = data.user;
      form.reset();
      renderSession();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
      if (verificationLink && error.code === "email_verification_required") {
        verificationLink.hidden = false;
      }
    } finally {
      button.disabled = false;
    }
  });
}

bindAuthForm("#login-form", "/api/auth/login");
bindAuthForm("#register-form", "/api/auth/register");

shortenForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";
  formMessage.classList.remove("error");
  result.hidden = true;
  const button = shortenForm.querySelector('button[type="submit"]');
  button.disabled = true;

  const values = new FormData(shortenForm);
  const payload = { url: values.get("url") };
  if (currentUser && values.get("alias")) payload.alias = values.get("alias");

  try {
    const data = await api("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    shortUrl.href = data.shortUrl;
    shortUrl.textContent = data.shortUrl;
    statsUrl.href = data.statsUrl;
    expiryNote.textContent = data.expiresAt
      ? `This link expires on ${new Date(data.expiresAt).toLocaleString("en-US")}. Save the statistics page URL.`
      : "This permanent link is attached to your account. Its statistics are private by default.";
    copyButton.textContent = "Copy";
    result.hidden = false;
    if (currentUser) loadLinks();
  } catch (error) {
    formMessage.textContent = error.message;
    formMessage.classList.add("error");
  } finally {
    button.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shortUrl.href);
    copyButton.textContent = "Copied";
  } catch {
    formMessage.textContent = "Could not copy automatically. Select the URL and copy it manually.";
    formMessage.classList.add("error");
  }
});

async function loadLinks() {
  linksMessage.textContent = "Loading…";
  try {
    const data = await api("/api/links");
    linksBody.replaceChildren(...data.links.map(createLinkRow));
    linksMessage.textContent = data.links.length ? "" : "You have not created any links yet.";
  } catch (error) {
    linksMessage.textContent = error.message;
    linksMessage.classList.add("error");
  }
}

function createLinkRow(link) {
  const row = document.createElement("tr");
  const shortCell = document.createElement("td");
  const shortAnchor = document.createElement("a");
  shortAnchor.href = link.shortUrl;
  shortAnchor.textContent = link.shortUrl;
  shortAnchor.target = "_blank";
  shortAnchor.rel = "noopener noreferrer";
  shortCell.append(shortAnchor);

  const clicksCell = document.createElement("td");
  clicksCell.textContent = String(link.clicks);
  const createdCell = document.createElement("td");
  createdCell.textContent = new Date(link.created).toLocaleDateString("en-US");
  const statsCell = document.createElement("td");
  const statsAnchor = document.createElement("a");
  statsAnchor.href = link.statsUrl;
  statsAnchor.textContent = link.statsPublic ? "View · Public" : "View · Private";
  statsCell.append(statsAnchor);
  const actionsCell = document.createElement("td");
  const editButton = document.createElement("button");
  editButton.className = "mini-button";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => {
    editingLink = link;
    editLinkForm.elements.url.value = link.targetUrl;
    editLinkForm.elements.slug.value = link.slug;
    editLinkForm.elements.statsPublic.checked = link.statsPublic === true;
    editLinkMessage.textContent = "";
    editLinkMessage.classList.remove("error");
    editLinkDialog.showModal();
  });
  const toggleButton = document.createElement("button");
  toggleButton.className = "mini-button";
  toggleButton.type = "button";
  toggleButton.textContent = link.active ? "Disable" : "Enable";
  toggleButton.addEventListener("click", async () => {
    toggleButton.disabled = true;
    try {
      await api(`/api/links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !link.active }),
      });
      await loadLinks();
    } catch (error) {
      linksMessage.textContent = error.message;
      linksMessage.classList.add("error");
    } finally {
      toggleButton.disabled = false;
    }
  });
  const deleteButton = document.createElement("button");
  deleteButton.className = "mini-button danger";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", async () => {
    if (!window.confirm(`Delete ${link.shortUrl}?`)) return;
    deleteButton.disabled = true;
    try {
      await api(`/api/links/${link.id}`, { method: "DELETE" });
      await loadLinks();
    } catch (error) {
      linksMessage.textContent = error.message;
      linksMessage.classList.add("error");
      deleteButton.disabled = false;
    }
  });
  actionsCell.append(editButton, toggleButton, deleteButton);
  row.append(shortCell, clicksCell, createdCell, statsCell, actionsCell);
  return row;
}

editLinkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingLink) return;
  editLinkMessage.textContent = "";
  editLinkMessage.classList.remove("error");
  const button = editLinkForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const values = new FormData(editLinkForm);
  try {
    await api(`/api/links/${editingLink.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: values.get("url"),
        alias: values.get("slug"),
        statsPublic: values.get("statsPublic") === "on",
      }),
    });
    editLinkDialog.close();
    editingLink = null;
    await loadLinks();
  } catch (error) {
    editLinkMessage.textContent = error.message;
    editLinkMessage.classList.add("error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#edit-link-cancel").addEventListener("click", () => {
  editLinkDialog.close();
  editingLink = null;
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  currentUser = null;
  linksBody.replaceChildren();
  renderSession();
});

document.querySelector("#refresh-button").addEventListener("click", loadLinks);
showAuthenticationResult();
loadAuthProviders();
loadSession();
