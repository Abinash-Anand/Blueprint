import { PrismaClient } from "@prisma/client";
import { type ISODate, fromDate, toDate } from "./domain/dates.js";

export const createPrisma = () => new PrismaClient();

/** Prisma @db.Date ↔ ISO date string (LLD §12.1). */
export const d2i = (d: Date): ISODate => fromDate(d);
export const i2d = (s: ISODate): Date => toDate(s);
