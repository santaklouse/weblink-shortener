import { loadConfig } from "../src/config.js";
import {
  CLICK_EVENTS_COLLECTION,
  LINKS_COLLECTION,
  USERS_COLLECTION,
  authenticatePocketBase,
  createPocketBaseClient,
} from "../src/pocketbase.js";

const config = loadConfig();
const client = createPocketBaseClient(config);

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
  if (existing) return existing;

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
  });
  console.log(`Auth collection ${USERS_COLLECTION} created.`);
  return created;
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

async function ensureClickEventsCollection(linksCollection) {
  const existing = await findCollection(CLICK_EVENTS_COLLECTION);
  if (existing) {
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

async function main() {
  await authenticatePocketBase(client, config);
  const usersCollection = await ensureUsersCollection();
  const linksCollection = await ensureLinksCollection(usersCollection);
  await ensureClickEventsCollection(linksCollection);
}

main().catch((error) => {
  console.error("Failed to initialize PocketBase:", error);
  if (error?.response?.data) {
    console.error("PocketBase details:", JSON.stringify(error.response.data, null, 2));
  }
  process.exitCode = 1;
});
