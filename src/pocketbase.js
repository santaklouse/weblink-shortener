import PocketBase from "pocketbase";

export const LINKS_COLLECTION = "short_links";
export const USERS_COLLECTION = "users";

export function createPocketBaseClient(config) {
  const client = new PocketBase(config.pocketBaseUrl);
  client.autoCancellation(false);
  return client;
}

export async function authenticatePocketBase(client, config) {
  if (config.pocketBaseToken) {
    client.authStore.save(config.pocketBaseToken);
    return;
  }

  await client.collection("_superusers").authWithPassword(
    config.pocketBaseEmail,
    config.pocketBasePassword,
    { autoRefreshThreshold: 30 * 60 },
  );
}

export async function connectPocketBase(client, config) {
  await authenticatePocketBase(client, config);
  await Promise.all([
    client.collections.getOne(LINKS_COLLECTION),
    client.collections.getOne(USERS_COLLECTION),
  ]);
}

export function createUserClient(config, token) {
  const client = new PocketBase(config.pocketBaseUrl);
  client.autoCancellation(false);
  if (token) client.authStore.save(token);
  return client;
}
