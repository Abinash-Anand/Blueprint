import type { StageDef } from "./types.js";

const MON_SAT = [1, 2, 3, 4, 5, 6];

/** Initial roadmap timeline (SRS FR-CAL-02). Dates are editable later in the app. */
export const stages: StageDef[] = [
  { slug: "fe", name: "Frontend Engineering", kind: "MAIN", start: "2026-11-17", end: "2026-12-31", districts: ["fe"], queue: "fe", weekdays: MON_SAT },
  { slug: "ar-parallel", name: "Architecture coursework (Saturdays)", kind: "PARALLEL", start: "2026-12-01", end: "2027-03-31", districts: ["ar"], queue: "ar", weekdays: [6] },
  { slug: "bedb", name: "Backend + Database", kind: "MAIN", start: "2027-01-01", end: "2027-03-31", districts: ["be", "db"], queue: "bedb", weekdays: MON_SAT },
  { slug: "ar", name: "Architecture consolidation", kind: "MAIN", start: "2027-04-01", end: "2027-05-15", districts: ["ar"], queue: "ar", weekdays: MON_SAT },
  { slug: "cl", name: "Cloud Engineering", kind: "MAIN", start: "2027-05-16", end: "2027-06-19", districts: ["cl"], queue: "cl", weekdays: MON_SAT },
  { slug: "ai", name: "Applied AI Engineering", kind: "MAIN", start: "2027-06-20", end: "2027-07-24", districts: ["ai"], queue: "ai", weekdays: MON_SAT },
  { slug: "ec", name: "Engineering Consolidation", kind: "MAIN", start: "2027-07-25", end: "2027-08-17", districts: ["ec"], queue: "ec", weekdays: MON_SAT },
];

/** Interleaved Backend ↔ Database sequence (SRS FR-CUR-05). */
export const BEDB_SEQUENCE = [
  "be.web", "be.node", "db.relational", // fundamentals
  "be.express", "be.api", // API development
  "db.sql", "db.modelling", // SQL and relationships
  "be.prisma", "db.migrations", "be.errors", // integration
  "db.transactions", // transactions
  "be.auth", "be.authz", "be.security", // authentication
  "db.indexes", // indexes and performance
  "be.testing", "db.operations", "be.caching", "be.messaging", "db.scaling", // advanced
];

export const JOURNEY = { start: "2026-11-17", end: "2027-08-17", timezone: "Europe/Berlin" } as const;

/** ISO weekday → target minutes (SRS FR-WEEK-01). */
export const DEFAULT_TARGETS: Record<number, number> = { 1: 240, 2: 240, 3: 240, 4: 240, 5: 240, 6: 240, 7: 0 };
