const message = document.querySelector("#stats-message");
const statsData = document.querySelector("#stats-data");
const token = window.location.pathname.split("/").filter(Boolean).at(-1);

async function loadStats() {
  try {
    const response = await fetch(`/api/stats/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Statistics not found");

    const link = data.link;
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
    message.textContent = "";
    statsData.hidden = false;
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
}

loadStats();
