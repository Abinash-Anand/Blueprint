import express from "express";
import type { PrismaClient } from "@prisma/client";
import type { Clock } from "./lib/clock.js";
import { errorHandler, notFoundRoute, requestLog } from "./lib/http.js";
import { curriculumRoutes } from "./modules/curriculum/routes.js";
import { revisionRoutes } from "./modules/revision/routes.js";
import { scheduleRoutes } from "./modules/schedule/routes.js";
import { sessionRoutes } from "./modules/sessions/routes.js";
import { summaryRoutes } from "./modules/summary/routes.js";
import { taskRoutes } from "./modules/tasks/routes.js";

export interface Deps {
  prisma: PrismaClient;
  clock: Clock;
}

export function createApp(deps: Deps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  app.use(requestLog);
  app.use(express.json({ limit: "100kb" }));

  const api = express.Router();
  api.get("/health", async (_req, res) => {
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", today: deps.clock.today() });
    } catch {
      res.status(503).json({ status: "unavailable", today: deps.clock.today() });
    }
  });
  api.use(curriculumRoutes(deps));
  api.use(taskRoutes(deps));
  api.use(sessionRoutes(deps));
  api.use(summaryRoutes(deps));
  api.use(scheduleRoutes(deps));
  api.use(revisionRoutes(deps));

  app.use("/api", api);
  app.use(notFoundRoute);
  app.use(errorHandler);
  return app;
}
