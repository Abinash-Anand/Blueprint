import express, { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { type AuthConfig, loadAuthConfig } from "./config.js";
import { presentationCatalog } from "./domain/presentation.js";
import type { Clock } from "./lib/clock.js";
import { authenticate, requireCity, requireUser } from "./lib/context.js";
import { requestGuardFor } from "./lib/guard.js";
import { errorHandler, notFoundRoute, requestLog } from "./lib/http.js";
import { AI_DISABLED, type AiConfig } from "./modules/ai/config.js";
import { createProviders } from "./modules/ai/providers/factory.js";
import type { AiProviders } from "./modules/ai/providers/types.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { type IntakeService, intakeService } from "./modules/ai/curriculum/intake.js";
import { type GenerationService, generationService } from "./modules/ai/curriculum/service.js";
import { type UsageService, usageService } from "./modules/ai/usage.js";
import { type Mailer, createMailer } from "./modules/auth/mailer.js";
import { authRoutes } from "./modules/auth/routes.js";
import { type RateLimiter, rateLimiter } from "./modules/auth/security.js";
import { type AuthService, authService } from "./modules/auth/service.js";
import { cityRoutes } from "./modules/cities/routes.js";
import { curriculumRoutes } from "./modules/curriculum/routes.js";
import { type RecallService, recallService } from "./modules/recall/service.js";
import { recallRoutes } from "./modules/recall/routes.js";
import { revisionArchiveRoutes } from "./modules/revision/archive.js";
import { scheduleRoutes } from "./modules/schedule/routes.js";
import { sessionRoutes } from "./modules/sessions/routes.js";
import { summaryRoutes } from "./modules/summary/routes.js";
import { taskRoutes } from "./modules/tasks/routes.js";

export interface Deps {
  prisma: PrismaClient;
  clock: Clock;
  ai: { config: AiConfig; providers: AiProviders };
  authConfig: AuthConfig;
  auth: AuthService;
  limiter: RateLimiter;
  /** One AI usage tracker per app: the hourly limits are counted in memory across requests, users and cities. */
  aiUsage: UsageService;
  generation: GenerationService;
  /** City creation: plan files, dictation and "Here's what I understood" (AI design §10.4). */
  intake: IntakeService;
  /** Recall: due lists, reviews, checklists and grading (docs/Recall-Plan.md). */
  recall: RecallService;
}

export interface AppInput {
  prisma: PrismaClient;
  clock: Clock;
  ai?: Deps["ai"];
  authConfig?: AuthConfig;
  mailer?: Mailer;
  limiter?: RateLimiter;
  /** Tests: shorter waits between grading tries while the provider is busy. */
  recallRetryDelaysMs?: readonly number[];
  /** Reverse proxies in front of the API (config.ts trustProxyHops); 1, the bundled Nginx, by default. */
  trustProxy?: number;
}

export function createApp(input: AppInput) {
  const authConfig = input.authConfig ?? loadAuthConfig();
  const mailer = input.mailer ?? createMailer(authConfig.mail);
  const ai = input.ai ?? { config: AI_DISABLED, providers: createProviders({ ...AI_DISABLED, evaluationProvider: "fake", transcriptionProvider: "fake", generationProvider: "fake" }) };
  const auth = authService(input.prisma, authConfig, mailer, () => input.clock.now());
  const aiUsage = usageService(input.prisma, ai.config, () => input.clock.now());
  const limiter = input.limiter ?? rateLimiter();
  const deps: Deps = {
    prisma: input.prisma,
    clock: input.clock,
    ai,
    authConfig,
    auth,
    limiter,
    aiUsage,
    generation: generationService({ prisma: input.prisma, clock: input.clock, ai, usage: aiUsage, auth }),
    intake: intakeService({ prisma: input.prisma, clock: input.clock, ai, usage: aiUsage, auth, limiter }),
    recall: recallService({ prisma: input.prisma, clock: input.clock, ai, usage: aiUsage, auth, retryDelaysMs: input.recallRetryDelaysMs }),
  };
  const app = express();
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  // The reverse proxies in front (1: the bundled Nginx) append the client's address to X-Forwarded-For; req.ip reads it.
  app.set("trust proxy", input.trustProxy ?? 1);
  app.use(requestLog);
  app.use(express.json({ limit: "1mb" }));

  const api = express.Router();
  api.use(requestGuardFor(authConfig.publicUrl));
  api.use(authenticate(deps.auth, authConfig.cookieSecure));
  api.get("/health", async (_req, res) => {
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", today: deps.clock.today() });
    } catch {
      res.status(503).json({ status: "unavailable", today: deps.clock.today() });
    }
  });
  // The semantic presentation contract (LLD §4.4): tones, variants, icons and every state's style, versioned.
  api.get("/presentation", (_req, res) => {
    res.json(presentationCatalog());
  });
  api.use(authRoutes(deps));
  api.use(cityRoutes(deps));

  // Everything below works inside one of the signed-in user's cities (X-City-Id), through a city-scoped client.
  const city = Router();
  city.use(requireUser, requireCity(deps.prisma));
  city.use(curriculumRoutes(deps));
  city.use(taskRoutes(deps));
  city.use(sessionRoutes(deps));
  city.use(summaryRoutes(deps));
  city.use(scheduleRoutes(deps));
  city.use(revisionArchiveRoutes());
  city.use(recallRoutes(deps));
  city.use(aiRoutes(deps));
  api.use(city);

  app.use("/api", api);
  app.use(notFoundRoute);
  app.use(errorHandler);
  // The server resumes grading that was waiting when it stopped (server.ts).
  app.locals.recall = deps.recall;
  return app;
}
