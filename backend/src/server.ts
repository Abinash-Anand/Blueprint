import { createApp } from "./app.js";
import { describeMail, loadConfig } from "./config.js";
import { createPrisma } from "./db.js";
import { systemClock } from "./lib/clock.js";
import { loadAiConfig } from "./modules/ai/config.js";
import { createProviders } from "./modules/ai/providers/factory.js";
import { aiService } from "./modules/ai/service.js";
import { createMailer } from "./modules/auth/mailer.js";
import { recoverGenerations } from "./modules/ai/curriculum/service.js";
import { recoverPacks } from "./modules/revision/packService.js";
import { authService } from "./modules/auth/service.js";

const config = loadConfig();
const prisma = createPrisma();
const clock = systemClock(config.appToday);
const aiConfig = loadAiConfig();
const providers = createProviders(aiConfig);
const app = createApp({ prisma, clock, ai: { config: aiConfig, providers }, authConfig: config.auth });

// Sessions and one-time tokens that have expired are removed on start (they are rejected anyway when used).
void authService(prisma, config.auth, { send: async () => {} })
  .cleanup()
  .then((r) => console.log(JSON.stringify({ level: "info", msg: "Auth housekeeping", ...r })))
  .catch((e) => console.error(JSON.stringify({ level: "error", msg: "Auth housekeeping failed", error: String(e) })));
console.log(JSON.stringify({
  level: "info", msg: "Auth configuration", cookieSecure: config.auth.cookieSecure, publicUrl: config.auth.publicUrl,
  requireVerifiedEmail: config.auth.requireVerifiedEmail, ...describeMail(config.auth.mail), legacyOwner: config.auth.legacyOwnerEmail ? "set" : "first verified account",
}));
// Curriculum generations interrupted by the restart are marked failed, so the learner can start them again.
void recoverGenerations(prisma).then((n) => n && console.log(JSON.stringify({ level: "info", msg: "Interrupted curriculum generations marked failed", count: n })));
void recoverPacks(prisma).then((n) => n && console.log(JSON.stringify({ level: "info", msg: "Interrupted revision pack builds marked failed", count: n })));

// Check the mail server once at start-up, so a wrong password shows in the log before anyone registers.
const startupMailer = createMailer(config.auth.mail);
if (startupMailer.verify)
  void startupMailer.verify().then(
    () => console.log(JSON.stringify({ level: "info", msg: "Mail server reachable and login accepted" })),
    (e) => console.error(JSON.stringify({ level: "error", msg: "Mail server check failed", code: String((e as { code?: string }).code ?? "unknown") })),
  );
if (config.production && !config.auth.cookieSecure)
  console.warn(JSON.stringify({ level: "warn", msg: "COOKIE_SECURE is off in production: serve over HTTPS and set COOKIE_SECURE=true" }));

// AI design §8.3: unfinished checks become failed; old unlinked checks and old usage rows are deleted.
void aiService(prisma, clock, aiConfig, providers)
  .cleanup()
  .then((r) => console.log(JSON.stringify({ level: "info", msg: "AI housekeeping", ...r })))
  .catch((e) => console.error(JSON.stringify({ level: "error", msg: "AI housekeeping failed", error: String(e) })));
console.log(JSON.stringify({
  level: "info", msg: "AI configuration", enabled: aiConfig.enabled,
  evaluation: `${aiConfig.evaluationProvider}:${aiConfig.evaluationModel}`, transcription: `${aiConfig.transcriptionProvider}:${aiConfig.transcriptionModel}`,
  generation: `${aiConfig.generationProvider}:${aiConfig.generationModel}`,
  keys: { gemini: !!aiConfig.geminiApiKey, anthropic: !!aiConfig.anthropicApiKey, gwdg: !!aiConfig.gwdg.apiKey },
}));

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ level: "info", msg: "Blueprint API listening", port: config.port, today: clock.today() }));
});

const shutdown = async (signal: string) => {
  console.log(JSON.stringify({ level: "info", msg: `Received ${signal}, shutting down` }));
  server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
