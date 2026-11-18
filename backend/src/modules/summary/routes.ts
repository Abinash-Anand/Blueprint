import { Router } from "express";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { dateQuery } from "../../lib/schemas.js";
import { summaryService } from "./service.js";

export function summaryRoutes({ prisma, clock }: Deps) {
  const svc = summaryService(prisma, clock);
  const r = Router();
  r.get("/today", async (req, res) => {
    res.json(await svc.today(validate(dateQuery, req.query).date));
  });
  r.get("/week", async (req, res) => {
    res.json(await svc.week(validate(dateQuery, req.query).date));
  });
  r.get("/progress", async (_req, res) => {
    res.json(await svc.progress());
  });
  return r;
}
