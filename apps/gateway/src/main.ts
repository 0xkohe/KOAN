import { AgentManager } from "./agents/manager.ts";
import { PairingAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { Store } from "./db.ts";
import { Scheduler } from "./scheduler.ts";
import { GatewayServer } from "./server.ts";

const config = loadConfig();
const store = new Store(config.dataDir);
const draftAttachmentMaxAge = 24 * 60 * 60 * 1000;
const cleanupDraftAttachments = () =>
  store.cleanupDraftAttachments(new Date(Date.now() - draftAttachmentMaxAge).toISOString());
cleanupDraftAttachments();
const cleanupTimer = setInterval(cleanupDraftAttachments, 60 * 60 * 1000);
const auth = new PairingAuth(store, config);
const agents = new AgentManager();
await agents.probe();

const serverRef: { current?: GatewayServer } = {};
const scheduler = new Scheduler(
  store,
  agents,
  (event) => serverRef.current?.publish(event),
  config.allowedRoots,
);
const server = new GatewayServer(config, store, auth, agents, scheduler);
serverRef.current = server;

auth.printCode();
console.log(`KOAN Gateway listening on http://${config.host}:${config.port}`);
console.log(`Allowed roots: ${config.allowedRoots.join(", ")}`);
for (const agent of agents.states()) {
  console.log(`${agent.available ? "✓" : "–"} ${agent.label}: ${agent.version ?? agent.reason}`);
}

const httpServer = Deno.serve(
  { hostname: config.host, port: config.port },
  (request, info) => server.handle(request, info.remoteAddr.hostname),
);
let shutdownPromise: Promise<void> | null = null;
const shutdown = () => {
  shutdownPromise ??= (async () => {
    clearInterval(cleanupTimer);
    await scheduler.shutdown();
    await httpServer.shutdown();
  })();
};
const onSignal = () => void shutdown();
Deno.addSignalListener("SIGINT", onSignal);
Deno.addSignalListener("SIGTERM", onSignal);
try {
  await httpServer.finished;
} finally {
  shutdown();
  await shutdownPromise;
  Deno.removeSignalListener("SIGINT", onSignal);
  Deno.removeSignalListener("SIGTERM", onSignal);
  store.close();
}
