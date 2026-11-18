import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found`);

/** Parse a value with a zod schema; failures become 400 VALIDATION_ERROR (LLD §5). */
export function validate<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

function validationError(e: ZodError) {
  return new HttpError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed",
    e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

export const notFoundRoute: RequestHandler = (req, _res, next) =>
  next(new HttpError(404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let e: HttpError;
  if (err instanceof HttpError) e = err;
  else if (err instanceof ZodError) e = validationError(err);
  else if (err?.type === "entity.parse.failed") e = new HttpError(400, "INVALID_JSON", "Request body is not valid JSON");
  else if (err?.type === "entity.too.large") e = new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") e = notFound("Record");
  else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") e = new HttpError(400, "INVALID_REFERENCE", "Referenced record does not exist");
  else if (err instanceof Prisma.PrismaClientUnknownRequestError && /check constraint/i.test(err.message))
    e = new HttpError(400, "CONSTRAINT_VIOLATION", "Value violates a database constraint");
  else {
    console.error(JSON.stringify({ level: "error", method: req.method, path: req.path, error: String(err?.stack ?? err) }));
    e = new HttpError(500, "INTERNAL_ERROR", "Something went wrong");
  }
  res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
};

export const requestLog: RequestHandler = (req, res, next) => {
  const t0 = performance.now();
  res.on("finish", () => {
    if (process.env.NODE_ENV === "test") return;
    console.log(JSON.stringify({ level: "info", method: req.method, path: req.originalUrl, status: res.statusCode, ms: Math.round(performance.now() - t0) }));
  });
  next();
};
