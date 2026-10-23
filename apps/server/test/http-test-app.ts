import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach } from "vitest";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

// Supertest binds the wildcard address for an unlistened server but requests 127.0.0.1,
// where a different local listener can answer. Listen on 127.0.0.1 first and pass that server.
const servers = new Set<Server>();

afterEach(async () => {
  const open = [...servers];
  servers.clear();
  await Promise.all(open.map(closeServer));
});

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export async function listenOnIPv4(app: RequestListener, port = 0): Promise<Server> {
  const server = createServer(app);
  servers.add(server);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    servers.delete(server);
    throw error;
  }
  return server;
}

export async function createListeningApp(config: AppConfig) {
  const runtime = await createApp(config);
  return { ...runtime, app: await listenOnIPv4(runtime.app) };
}
