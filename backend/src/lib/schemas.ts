import { z } from "zod";
import { isValidISODate } from "../domain/dates.js";

export const isoDate = z.string().refine(isValidISODate, { message: "Expected a real date in YYYY-MM-DD format" });
export const intId = z.coerce.number().int().positive();
export const slug = z.string().regex(/^[a-z0-9.-]{1,40}$/, "Invalid id");
export const idParam = z.object({ id: intId });
export const slugParam = z.object({ id: slug });
export const dateQuery = z.object({ date: isoDate.optional() }).strict();
