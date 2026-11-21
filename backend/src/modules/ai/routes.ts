import { type Request, Router } from "express";
import type { Deps } from "../../app.js";
import { aiService } from "./service.js";

export function aiRoutes(deps: Deps) {
  const { ai } = deps;
  const usage = deps.aiUsage;
  // City-scoped data plus the signed-in user's AI consent record (GDPR Art. 7: given and withdrawn per person).
  const svc = (req: Request) =>
    aiService(req.db, deps.clock, ai.config, ai.providers, {
      get: () => deps.auth.hasConsent(req.user!.id, "AI_PROCESSING"),
      grant: async () => {
        await deps.auth.setConsent(req.user!.id, "AI_PROCESSING", true);
        return (await deps.auth.hasConsent(req.user!.id, "AI_PROCESSING"))!;
      },
    }, usage);
  const r = Router();
  r.get("/ai/status", async (req, res) => {
    res.json(await svc(req).status());
  });
  r.post("/ai/consent", async (req, res) => {
    res.json(await svc(req).consent());
  });
  return r;
}
