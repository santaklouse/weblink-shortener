import { loadConfig } from "../src/config.js";
import { buildAuthEmailTemplates } from "../src/email-templates.js";
import {
  CLICK_EVENTS_COLLECTION,
  LINKS_COLLECTION,
  TELEGRAM_ACCOUNTS_COLLECTION,
  TELEGRAM_LINK_TOKENS_COLLECTION,
  USERS_COLLECTION,
  authenticatePocketBase,
  createPocketBaseClient,
} from "../src/pocketbase.js";

const config = loadConfig();
const client = createPocketBaseClient(config);
const authEmailTemplates = buildAuthEmailTemplates(config.publicBaseUrl);

function googleOAuthOptions(existing = {}) {
  if (!config.googleClientId || !config.googleClientSecret) return null;

  const providers = (existing.providers || []).filter((provider) => provider.name !== "google");
  providers.push({
    name: "google",
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
  });

  return {
    enabled: true,
    mappedFields: {
      id: existing.mappedFields?.id || "",
      name: "name",
      username: existing.mappedFields?.username || "",
      avatarURL: existing.mappedFields?.avatarURL || "",
    },
    providers,
  };
}

async function findCollection(name) {
  try {
    return await client.collections.getOne(name);
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function ensureUsersCollection() {
  const existing = await findCollection(USERS_COLLECTION);
  if (existing) {
    const oauth2 = googleOAuthOptions(existing.oauth2);
    const updates = { ...authEmailTemplates };
    if (oauth2) updates.oauth2 = oauth2;

    const updated = await client.collections.update(existing.id, updates);
    console.log(`Authentication options configured for ${USERS_COLLECTION}.`);
    return updated;
  }

  const oauth2 = googleOAuthOptions();

  const created = await client.collections.create({
    name: USERS_COLLECTION,
    type: "auth",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "name",
        type: "text",
        required: false,
        presentable: true,
        min: 0,
        max: 80,
        pattern: "",
        autogeneratePattern: "",
      },
    ],
    passwordAuth: {
      enabled: true,
      identityFields: ["email"],
    },
    ...authEmailTemplates,
    ...(oauth2 ? { oauth2 } : {}),
  });
  console.log(`Auth collection ${USERS_COLLECTION} created.`);
  return created;
}

async function ensureApplicationSettings() {
  const settings = await client.settings.getAll();
  const update = {
    meta: {
      ...settings.meta,
      appName: "Weblink Shortener",
      appURL: config.publicBaseUrl || settings.meta.appURL,
      senderName: config.mailFromName || settings.meta.senderName,
      senderAddress: config.mailFromAddress || settings.meta.senderAddress,
    },
  };

  if (config.smtpHost) {
    update.smtp = {
      enabled: true,
      host: config.smtpHost,
      port: config.smtpPort,
      username: config.smtpUsername || "",
      password: config.smtpPassword || "",
      tls: config.smtpTls,
      authMethod: config.smtpAuthMethod || "",
      localName: config.smtpLocalName || "",
    };
  }

  await client.settings.update(update);
  console.log(config.smtpHost ? "Application mail settings configured." : "Application URL configured; existing mail settings preserved.");
}

async function ensureLinksCollection(usersCollection) {
  const existing = await findCollection(LINKS_COLLECTION);
  if (existing) {
    const fieldNames = new Set(existing.fields.map((field) => field.name));
    const additions = [];
    if (!fieldNames.has("owner")) {
      additions.push({
        name: "owner",
        type: "relation",
        required: false,
        presentable: false,
        collectionId: usersCollection.id,
        cascadeDelete: true,
        minSelect: 0,
        maxSelect: 1,
      });
    }
    if (!fieldNames.has("statsToken")) {
      additions.push({
        name: "statsToken",
        type: "text",
        required: false,
        hidden: true,
        min: 0,
        max: 43,
        pattern: "^[A-Za-z0-9_-]*$",
        autogeneratePattern: "",
      });
    }
    if (!fieldNames.has("expiresAt")) {
      additions.push({
        name: "expiresAt",
        type: "date",
        required: false,
      });
    }
    if (!fieldNames.has("created")) {
      additions.push({
        name: "created",
        type: "autodate",
        onCreate: true,
        onUpdate: false,
      });
    }
    if (!fieldNames.has("updated")) {
      additions.push({
        name: "updated",
        type: "autodate",
        onCreate: true,
        onUpdate: true,
      });
    }

    const normalizedFields = existing.fields.map((field) =>
      field.name === "owner"
        ? { ...field, required: false, minSelect: 0, maxSelect: 1 }
        : field,
    );

    if (additions.length > 0 || existing.fields.find((field) => field.name === "owner")?.required) {
      await client.collections.update(existing.id, {
        fields: [...normalizedFields, ...additions],
      });
      console.log(`Collection schema ${LINKS_COLLECTION} updated.`);
    } else {
      console.log(`Collection ${LINKS_COLLECTION} already exists; no changes required.`);
    }
    return findCollection(LINKS_COLLECTION);
  }

  const created = await client.collections.create({
    name: LINKS_COLLECTION,
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "url",
        type: "url",
        required: true,
        presentable: true,
        onlyDomains: null,
        exceptDomains: null,
      },
      {
        name: "slug",
        type: "text",
        required: true,
        presentable: true,
        min: 4,
        max: 32,
        pattern: "^[a-z0-9_-]+$",
        autogeneratePattern: "",
      },
      {
        name: "clicks",
        type: "number",
        required: false,
        min: 0,
        onlyInt: true,
      },
      {
        name: "active",
        type: "bool",
        required: false,
      },
      {
        name: "owner",
        type: "relation",
        required: false,
        presentable: false,
        collectionId: usersCollection.id,
        cascadeDelete: true,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        name: "statsToken",
        type: "text",
        required: true,
        hidden: true,
        min: 43,
        max: 43,
        pattern: "^[A-Za-z0-9_-]+$",
        autogeneratePattern: "",
      },
      {
        name: "expiresAt",
        type: "date",
        required: false,
      },
      {
        name: "created",
        type: "autodate",
        onCreate: true,
        onUpdate: false,
      },
      {
        name: "updated",
        type: "autodate",
        onCreate: true,
        onUpdate: true,
      },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_short_links_slug` ON `short_links` (`slug` COLLATE NOCASE)",
      "CREATE INDEX `idx_short_links_owner` ON `short_links` (`owner`)",
      "CREATE UNIQUE INDEX `idx_short_links_stats_token` ON `short_links` (`statsToken`)",
    ],
  });

  console.log(`Collection ${LINKS_COLLECTION} created.`);
  return created;
}

function requestAnalyticsFields() {
  return [
    {
      name: "requestMethod",
      type: "text",
      required: false,
      min: 0,
      max: 16,
      pattern: "^[A-Z-]*$",
      autogeneratePattern: "",
    },
    {
      name: "requestProtocol",
      type: "text",
      required: false,
      min: 0,
      max: 16,
      pattern: "^[a-z0-9+.-]*$",
      autogeneratePattern: "",
    },
    {
      name: "requestHost",
      type: "text",
      required: false,
      min: 0,
      max: 255,
      pattern: "",
      autogeneratePattern: "",
    },
    {
      name: "requestPath",
      type: "text",
      required: false,
      min: 0,
      max: 2_048,
      pattern: "",
      autogeneratePattern: "",
    },
    {
      name: "httpVersion",
      type: "text",
      required: false,
      min: 0,
      max: 16,
      pattern: "^[0-9.]*$",
      autogeneratePattern: "",
    },
    {
      name: "requestHeaders",
      type: "json",
      required: false,
      maxSize: 32 * 1_024,
    },
  ];
}

async function ensureClickEventsCollection(linksCollection) {
  const existing = await findCollection(CLICK_EVENTS_COLLECTION);
  if (existing) {
    const fieldNames = new Set(existing.fields.map((field) => field.name));
    const additions = requestAnalyticsFields().filter((field) => !fieldNames.has(field.name));
    if (additions.length > 0) {
      await client.collections.update(existing.id, {
        fields: [...existing.fields, ...additions],
      });
      console.log(`Collection schema ${CLICK_EVENTS_COLLECTION} updated.`);
      return findCollection(CLICK_EVENTS_COLLECTION);
    }

    console.log(`Collection ${CLICK_EVENTS_COLLECTION} already exists; no changes required.`);
    return existing;
  }

  const created = await client.collections.create({
    name: CLICK_EVENTS_COLLECTION,
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "link",
        type: "relation",
        required: true,
        presentable: false,
        collectionId: linksCollection.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      },
      {
        name: "countryCode",
        type: "text",
        required: true,
        min: 2,
        max: 2,
        pattern: "^[A-Z0-9]{2}$",
        autogeneratePattern: "",
      },
      {
        name: "referrer",
        type: "url",
        required: false,
        presentable: true,
        onlyDomains: null,
        exceptDomains: null,
      },
      {
        name: "referrerHost",
        type: "text",
        required: false,
        min: 0,
        max: 255,
        pattern: "",
        autogeneratePattern: "",
      },
      {
        name: "ipAddress",
        type: "text",
        required: false,
        hidden: true,
        min: 0,
        max: 64,
        pattern: "",
        autogeneratePattern: "",
      },
      {
        name: "visitorHash",
        type: "text",
        required: false,
        hidden: true,
        min: 0,
        max: 64,
        pattern: "^[a-f0-9]*$",
        autogeneratePattern: "",
      },
      {
        name: "device",
        type: "text",
        required: false,
        min: 0,
        max: 32,
        pattern: "",
        autogeneratePattern: "",
      },
      {
        name: "browser",
        type: "text",
        required: false,
        min: 0,
        max: 64,
        pattern: "",
        autogeneratePattern: "",
      },
      {
        name: "os",
        type: "text",
        required: false,
        min: 0,
        max: 64,
        pattern: "",
        autogeneratePattern: "",
      },
      ...requestAnalyticsFields(),
      {
        name: "created",
        type: "autodate",
        onCreate: true,
        onUpdate: false,
      },
    ],
    indexes: [
      "CREATE INDEX `idx_click_events_link_created` ON `click_events` (`link`, `created`)",
      "CREATE INDEX `idx_click_events_visitor_hash` ON `click_events` (`visitorHash`)",
    ],
  });

  console.log(`Collection ${CLICK_EVENTS_COLLECTION} created.`);
  return created;
}

async function ensureTelegramAccountsCollection(usersCollection) {
  const existing = await findCollection(TELEGRAM_ACCOUNTS_COLLECTION);
  if (existing) {
    console.log(`Collection ${TELEGRAM_ACCOUNTS_COLLECTION} already exists; no changes required.`);
    return existing;
  }

  const created = await client.collections.create({
    name: TELEGRAM_ACCOUNTS_COLLECTION,
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "owner",
        type: "relation",
        required: true,
        collectionId: usersCollection.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      },
      {
        name: "telegramUserId",
        type: "text",
        required: true,
        hidden: true,
        min: 1,
        max: 20,
        pattern: "^[1-9][0-9]*$",
        autogeneratePattern: "",
      },
      {
        name: "chatId",
        type: "text",
        required: true,
        hidden: true,
        min: 1,
        max: 20,
        pattern: "^[1-9][0-9]*$",
        autogeneratePattern: "",
      },
      {
        name: "username",
        type: "text",
        required: false,
        min: 0,
        max: 32,
        pattern: "^[A-Za-z0-9_]*$",
        autogeneratePattern: "",
      },
      {
        name: "firstName",
        type: "text",
        required: false,
        min: 0,
        max: 128,
        pattern: "",
        autogeneratePattern: "",
      },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_telegram_accounts_user` ON `telegram_accounts` (`telegramUserId`)",
      "CREATE UNIQUE INDEX `idx_telegram_accounts_owner` ON `telegram_accounts` (`owner`)",
    ],
  });
  console.log(`Collection ${TELEGRAM_ACCOUNTS_COLLECTION} created.`);
  return created;
}

async function ensureTelegramLinkTokensCollection(usersCollection) {
  const existing = await findCollection(TELEGRAM_LINK_TOKENS_COLLECTION);
  if (existing) {
    console.log(`Collection ${TELEGRAM_LINK_TOKENS_COLLECTION} already exists; no changes required.`);
    return existing;
  }

  const created = await client.collections.create({
    name: TELEGRAM_LINK_TOKENS_COLLECTION,
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "owner",
        type: "relation",
        required: true,
        collectionId: usersCollection.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      },
      {
        name: "tokenHash",
        type: "text",
        required: true,
        hidden: true,
        min: 64,
        max: 64,
        pattern: "^[a-f0-9]{64}$",
        autogeneratePattern: "",
      },
      { name: "expiresAt", type: "date", required: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_telegram_link_tokens_hash` ON `telegram_link_tokens` (`tokenHash`)",
      "CREATE INDEX `idx_telegram_link_tokens_owner` ON `telegram_link_tokens` (`owner`)",
    ],
  });
  console.log(`Collection ${TELEGRAM_LINK_TOKENS_COLLECTION} created.`);
  return created;
}

async function main() {
  await authenticatePocketBase(client, config);
  await ensureApplicationSettings();
  const usersCollection = await ensureUsersCollection();
  const linksCollection = await ensureLinksCollection(usersCollection);
  await ensureClickEventsCollection(linksCollection);
  await ensureTelegramAccountsCollection(usersCollection);
  await ensureTelegramLinkTokensCollection(usersCollection);
}

main().catch((error) => {
  console.error("Failed to initialize PocketBase:", error);
  if (error?.response?.data) {
    console.error("PocketBase details:", JSON.stringify(error.response.data, null, 2));
  }
  process.exitCode = 1;
});
