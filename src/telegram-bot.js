import { loadTelegramBotConfig } from "./telegram-bot-config.js";
import { parseTelegramLinkParameter } from "./telegram.js";

const config = loadTelegramBotConfig();
const telegramApiUrl = `https://api.telegram.org/bot${config.botToken}`;
let nextUpdateId = 0;
let stopping = false;
let activeRequestController;

class InternalApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function compactUrl(value, length = 120) {
  const text = String(value || "");
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

async function telegram(method, payload = {}, signal) {
  const timeoutSignal = AbortSignal.timeout((config.pollTimeoutSeconds + 10) * 1_000);
  const response = await fetch(`${telegramApiUrl}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || response.status}`);
  }
  return data.result;
}

async function sendMessage(chatId, text, replyMarkup) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function internalApi(path, identity, { method = "POST", body = {} } = {}) {
  const response = await fetch(`${config.appInternalUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Secret": config.internalSecret,
    },
    body: JSON.stringify({ ...identity, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new InternalApiError(data?.error || "The shortener API request failed", response.status);
  return data;
}

function identityFrom(message) {
  return {
    userId: String(message.from.id),
    chatId: String(message.chat.id),
    username: message.from.username || "",
    firstName: message.from.first_name || "",
  };
}

function commandParts(text) {
  const [rawCommand = "", ...args] = String(text || "").trim().split(/\s+/);
  return {
    command: rawCommand.toLowerCase().replace(/@[^\s]+$/, ""),
    args,
  };
}

function helpText() {
  return `<b>Weblink Shortener</b>\n\n` +
    `/new &lt;URL&gt; [slug] — create a link\n` +
    `/links — list and manage links\n` +
    `/stats &lt;slug&gt; — show statistics\n` +
    `/edit &lt;slug&gt; &lt;URL&gt; [new-slug] — change a link\n` +
    `/enable &lt;slug&gt; — enable a link\n` +
    `/disable &lt;slug&gt; — disable a link\n` +
    `/delete &lt;slug&gt; — delete a link\n` +
    `/account — show the connected account\n` +
    `/logout — disconnect Telegram\n` +
    `/help — show this help`;
}

function loginRequiredText() {
  return "Telegram is not connected. Sign in on the website, select <b>Connect Telegram</b>, and open the one-time bot link.";
}

function linkButtons(link) {
  return [
    { text: "Statistics", callback_data: `stats:${link.id}` },
    { text: link.active ? "Disable" : "Enable", callback_data: `active:${link.id}:${link.active ? 0 : 1}` },
    { text: "Delete", callback_data: `delete:${link.id}` },
  ];
}

function formatLink(link) {
  return `<b>${escapeHtml(link.slug)}</b> · ${link.active ? "active" : "disabled"} · ${link.clicks} clicks\n` +
    `<a href="${escapeHtml(link.shortUrl)}">${escapeHtml(link.shortUrl)}</a>\n` +
    `→ ${escapeHtml(compactUrl(link.targetUrl))}`;
}

function formatBreakdown(items, label) {
  if (!items?.length) return "No data";
  return items.map((item) => `${escapeHtml(label(item))}: ${item.clicks}`).join("\n");
}

async function showStats(chatId, identity, reference) {
  const data = await internalApi(`/api/internal/telegram/links/${encodeURIComponent(reference)}/stats`, identity);
  const { link, analytics } = data;
  await sendMessage(
    chatId,
    `<b>Statistics: ${escapeHtml(link.slug)}</b>\n` +
      `${link.active ? "Active" : "Disabled"}\n` +
      `Clicks: <b>${analytics.totals.clicks}</b>\n` +
      `Unique visitors: <b>${analytics.totals.uniqueVisitors}</b>\n\n` +
      `<b>Countries</b>\n${formatBreakdown(analytics.countries, (item) => item.name)}\n\n` +
      `<b>Referrers</b>\n${formatBreakdown(analytics.referrers, (item) => item.name)}\n\n` +
      `<a href="${escapeHtml(link.statsUrl)}">Open detailed statistics</a>`,
    { inline_keyboard: [linkButtons(link)] },
  );
}

async function showLinks(chatId, identity) {
  const data = await internalApi("/api/internal/telegram/links/list", identity);
  if (data.links.length === 0) {
    await sendMessage(chatId, "You have not created any links yet. Use /new &lt;URL&gt; [slug].");
    return;
  }

  const visibleLinks = data.links.slice(0, 10);
  const text = visibleLinks.map(formatLink).join("\n\n");
  const suffix = data.total > visibleLinks.length
    ? `\n\nShowing ${visibleLinks.length} of ${data.total} links.`
    : "";
  await sendMessage(chatId, text + suffix, {
    inline_keyboard: visibleLinks.map(linkButtons),
  });
}

async function connectAccount(message, token) {
  const parsedToken = parseTelegramLinkParameter(token) || token;
  const data = await internalApi("/api/internal/telegram/connect", identityFrom(message), {
    body: { token: parsedToken },
  });
  await sendMessage(
    message.chat.id,
    `Connected to <b>${escapeHtml(data.user.email)}</b>.\n\n${helpText()}`,
  );
}

async function handleCommand(message) {
  if (message.chat.type !== "private") {
    await sendMessage(message.chat.id, "For account security, use this bot in a private chat.");
    return;
  }
  const identity = identityFrom(message);
  const { command, args } = commandParts(message.text);

  if (command === "/start") {
    if (args[0]?.startsWith("link_")) {
      await connectAccount(message, args[0]);
      return;
    }
    await sendMessage(message.chat.id, `${helpText()}\n\n${loginRequiredText()}`);
    return;
  }
  if (command === "/help") {
    await sendMessage(message.chat.id, helpText());
    return;
  }
  if (command === "/login") {
    if (!args[0]) throw new Error("Use /login <one-time-token> or open the link generated on the website.");
    await connectAccount(message, args[0]);
    return;
  }
  if (command === "/account") {
    const data = await internalApi("/api/internal/telegram/me", identity);
    await sendMessage(message.chat.id, `Connected to <b>${escapeHtml(data.user.email)}</b>.`);
    return;
  }
  if (command === "/links") {
    await showLinks(message.chat.id, identity);
    return;
  }
  if (command === "/new") {
    if (!args[0]) throw new Error("Use /new <URL> [slug]");
    const data = await internalApi("/api/internal/telegram/links", identity, {
      body: { url: args[0], ...(args[1] ? { alias: args[1] } : {}) },
    });
    await sendMessage(message.chat.id, `<b>Link created</b>\n${formatLink(data.link)}`, {
      inline_keyboard: [linkButtons(data.link)],
    });
    return;
  }
  if (command === "/stats") {
    if (!args[0]) throw new Error("Use /stats <slug>");
    await showStats(message.chat.id, identity, args[0]);
    return;
  }
  if (command === "/edit") {
    if (!args[0] || !args[1]) throw new Error("Use /edit <slug> <URL> [new-slug]");
    const data = await internalApi(`/api/internal/telegram/links/${encodeURIComponent(args[0])}`, identity, {
      method: "PATCH",
      body: { url: args[1], ...(args[2] ? { alias: args[2] } : {}) },
    });
    await sendMessage(message.chat.id, `<b>Link updated</b>\n${formatLink(data.link)}`, {
      inline_keyboard: [linkButtons(data.link)],
    });
    return;
  }
  if (command === "/enable" || command === "/disable") {
    if (!args[0]) throw new Error(`Use ${command} <slug>`);
    const data = await internalApi(`/api/internal/telegram/links/${encodeURIComponent(args[0])}`, identity, {
      method: "PATCH",
      body: { active: command === "/enable" },
    });
    await sendMessage(message.chat.id, `${data.link.active ? "Enabled" : "Disabled"}: ${escapeHtml(data.link.shortUrl)}`);
    return;
  }
  if (command === "/delete") {
    if (!args[0]) throw new Error("Use /delete <slug>");
    const data = await internalApi("/api/internal/telegram/links/list", identity);
    const link = data.links.find((item) => item.slug === args[0].toLowerCase());
    if (!link) throw new Error("Link not found");
    await sendMessage(message.chat.id, `Delete <b>${escapeHtml(link.slug)}</b>? This cannot be undone.`, {
      inline_keyboard: [[
        { text: "Cancel", callback_data: `cancel:${link.id}` },
        { text: "Delete", callback_data: `delete-confirm:${link.id}` },
      ]],
    });
    return;
  }
  if (command === "/logout") {
    await sendMessage(message.chat.id, "Disconnect this Telegram account?", {
      inline_keyboard: [[
        { text: "Cancel", callback_data: "cancel:logout" },
        { text: "Disconnect", callback_data: "logout-confirm" },
      ]],
    });
    return;
  }
  await sendMessage(message.chat.id, `Unknown command.\n\n${helpText()}`);
}

async function handleCallback(query) {
  const message = query.message;
  if (!message || message.chat.type !== "private") {
    await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Use a private chat", show_alert: true });
    return;
  }
  await telegram("answerCallbackQuery", { callback_query_id: query.id });
  const identity = identityFrom({ ...message, from: query.from });
  const [action, reference, value] = String(query.data || "").split(":");

  if (action === "stats") {
    await showStats(message.chat.id, identity, reference);
  } else if (action === "active") {
    const data = await internalApi(`/api/internal/telegram/links/${encodeURIComponent(reference)}`, identity, {
      method: "PATCH",
      body: { active: value === "1" },
    });
    await sendMessage(message.chat.id, `${data.link.active ? "Enabled" : "Disabled"}: ${escapeHtml(data.link.shortUrl)}`);
  } else if (action === "delete") {
    await sendMessage(message.chat.id, "Delete this link? This cannot be undone.", {
      inline_keyboard: [[
        { text: "Cancel", callback_data: `cancel:${reference}` },
        { text: "Delete", callback_data: `delete-confirm:${reference}` },
      ]],
    });
  } else if (action === "delete-confirm") {
    await internalApi(`/api/internal/telegram/links/${encodeURIComponent(reference)}/delete`, identity);
    await sendMessage(message.chat.id, "Link deleted.");
  } else if (action === "logout-confirm") {
    await internalApi("/api/internal/telegram/logout", identity);
    await sendMessage(message.chat.id, "Telegram disconnected. Generate a new one-time link on the website to reconnect.");
  } else if (action === "cancel") {
    await sendMessage(message.chat.id, "Cancelled.");
  }
}

async function handleUpdate(update) {
  try {
    if (update.message?.text?.startsWith("/") && !update.message.from?.is_bot) {
      await handleCommand(update.message);
    } else if (update.callback_query && !update.callback_query.from?.is_bot) {
      await handleCallback(update.callback_query);
    }
  } catch (error) {
    const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
    if (!chatId) {
      console.error("Telegram update failed without a reply target:", error.message);
      return;
    }
    const text = error instanceof InternalApiError && error.status === 401
      ? loginRequiredText()
      : escapeHtml(error.message || "The request failed");
    await sendMessage(chatId, text).catch((replyError) =>
      console.error("Could not send Telegram error response:", replyError.message));
  }
}

async function poll() {
  while (!stopping) {
    activeRequestController = new AbortController();
    try {
      const updates = await telegram("getUpdates", {
        offset: nextUpdateId,
        timeout: config.pollTimeoutSeconds,
        allowed_updates: ["message", "callback_query"],
      }, activeRequestController.signal);
      for (const update of updates) {
        nextUpdateId = Math.max(nextUpdateId, update.update_id + 1);
        await handleUpdate(update);
      }
    } catch (error) {
      if (stopping) break;
      console.error("Telegram polling failed:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } finally {
      activeRequestController = undefined;
    }
  }
}

async function main() {
  const bot = await telegram("getMe");
  await telegram("deleteWebhook", { drop_pending_updates: false });
  await telegram("setMyCommands", {
    commands: [
      { command: "new", description: "Create a short link" },
      { command: "links", description: "List and manage links" },
      { command: "stats", description: "View link statistics" },
      { command: "edit", description: "Change a destination or slug" },
      { command: "account", description: "Show the connected account" },
      { command: "logout", description: "Disconnect Telegram" },
      { command: "help", description: "Show commands" },
    ],
  });
  console.log(`Telegram bot @${bot.username} started with long polling.`);
  await poll();
}

function shutdown(signal) {
  console.log(`Received ${signal}, stopping Telegram bot...`);
  stopping = true;
  activeRequestController?.abort();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error("Failed to start Telegram bot:", error.message);
  process.exitCode = 1;
});
