import { type Request, Router } from "express";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { dateQuery } from "../../lib/schemas.js";
import { summaryService } from "./service.js";

export function summaryRoutes({ clock }: Deps) {
  const svc = (req: Request) => summaryService(req.db, clock);
  const r = Router();
  r.get("/today", async (req, res) => {
    res.json(await svc(req).today(validate(dateQuery, req.query).date));
  });
  r.get("/week", async (req, res) => {
    res.json(await svc(req).week(validate(dateQuery, req.query).date));
  });
  r.get("/progress", async (req, res) => {
    res.json(await svc(req).progress());
  });
  return r;
}
