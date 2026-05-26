import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const runtime = await createApp(config);

const server = runtime.app.listen(config.port, () => {
  console.log(`Nytt Trondheim API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await runtime.pool?.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
