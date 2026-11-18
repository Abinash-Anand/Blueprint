import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPrisma } from "./db.js";
import { systemClock } from "./lib/clock.js";

const config = loadConfig();
const prisma = createPrisma();
const clock = systemClock(config.appToday);
const app = createApp({ prisma, clock });

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ level: "info", msg: "Engineering City API listening", port: config.port, today: clock.today() }));
});

const shutdown = async (signal: string) => {
  console.log(JSON.stringify({ level: "info", msg: `Received ${signal}, shutting down` }));
  server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
