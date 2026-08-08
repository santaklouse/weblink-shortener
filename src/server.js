import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectPocketBase, createPocketBaseClient } from "./pocketbase.js";

async function main() {
  const config = loadConfig();
  const client = createPocketBaseClient(config);

  await connectPocketBase(client, config);

  const app = createApp({ client, config });
  const server = app.listen(config.port, config.host, () => {
    console.log(`URL shortener started at http://${config.host}:${config.port}`);
  });

  const shutdown = (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Failed to start the application:", error);
  process.exitCode = 1;
});
