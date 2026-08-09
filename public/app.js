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
let currentUser = null;

document.querySelector("#domain-prefix").textContent = `${window.location.host}/`;

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data?.error || "Request failed");
    error.status = response.status;
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
  if (loggedIn) loadLinks();
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
  } catch {
    googleSignIn.hidden = true;
    authDivider.hidden = true;
  }
}

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
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    message.classList.remove("error");
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const values = new FormData(form);
      const data = await api(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
      });
      currentUser = data.user;
      form.reset();
      renderSession();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
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
      : "This permanent link is attached to your account.";
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
  statsAnchor.textContent = "View";
  statsCell.append(statsAnchor);
  const actionsCell = document.createElement("td");
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
  actionsCell.append(toggleButton, deleteButton);
  row.append(shortCell, clicksCell, createdCell, statsCell, actionsCell);
  return row;
}

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
