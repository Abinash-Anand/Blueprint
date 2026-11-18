import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPrisma } from "./db.js";
import { systemClock } from "./lib/clock.js";
import { loadAiConfig } from "./modules/ai/config.js";
import { createProviders } from "./modules/ai/providers/factory.js";
import { aiService } from "./modules/ai/service.js";

const config = loadConfig();
const prisma = createPrisma();
const clock = systemClock(config.appToday);
const aiConfig = loadAiConfig();
const providers = createProviders(aiConfig);
const app = createApp({ prisma, clock, ai: { config: aiConfig, providers } });

// AI design §8.3: unfinished checks become failed; old unlinked checks and old usage rows are deleted.
void aiService(prisma, clock, aiConfig, providers)
  .cleanup()
  .then((r) => console.log(JSON.stringify({ level: "info", msg: "AI housekeeping", ...r })))
  .catch((e) => console.error(JSON.stringify({ level: "error", msg: "AI housekeeping failed", error: String(e) })));
console.log(JSON.stringify({
  level: "info", msg: "AI configuration", enabled: aiConfig.enabled,
  evaluation: `${aiConfig.evaluationProvider}:${aiConfig.evaluationModel}`, transcription: `${aiConfig.transcriptionProvider}:${aiConfig.transcriptionModel}`,
  keys: { gemini: !!aiConfig.geminiApiKey, anthropic: !!aiConfig.anthropicApiKey },
}));

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
