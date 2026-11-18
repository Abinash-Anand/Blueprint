import { type DistrictDef, roadmap, docs, course, article } from "./types.js";

const PG = roadmap("roadmap.sh — PostgreSQL", "https://roadmap.sh/postgresql-dba");
const RM = roadmap("roadmap.sh — Backend (databases)", "https://roadmap.sh/backend");

export const database: DistrictDef = {
  slug: "db",
  name: "Database",
  subtitle: "PostgreSQL first, then scaling and NoSQL",
  layer: 1,
  color: "#c2ab80",
  cols: 3,
  goal: "Understand where data lives, how it is modelled and queried, how it stays correct under concurrent use, and how to keep it fast.",
  note: "A separate skill area from backend CRUD. Learned in alternation with Backend Engineering, Jan–Mar.",
  topics: [
    {
      slug: "db.relational", name: "Relational fundamentals", priority: "CORE", hours: 8,
      description: "The relational model and the constraints that keep data correct no matter which application writes it.",
      subtopics: ["Relational model", "Tables, types and constraints", "Primary and foreign keys", "Normalisation (1NF–3NF)"],
      exercise: "Model a library system on paper to 3NF, create it in PostgreSQL with all constraints, and show three inserts the constraints reject.",
      resources: [docs("PostgreSQL — Tutorial", "https://www.postgresql.org/docs/current/tutorial.html"), docs("PostgreSQL — Constraints", "https://www.postgresql.org/docs/current/ddl-constraints.html"), PG],
    },
    {
      slug: "db.sql", name: "SQL querying", priority: "CORE", hours: 16,
      description: "Asking precise questions of data. Joins, aggregation and window functions cover almost every reporting need.",
      subtopics: ["SELECT, filtering and sorting", "Joins", "Aggregation and GROUP BY", "Subqueries and CTEs", "Window functions"],
      exercise: "Solve the PostgreSQL Exercises joins, aggregates and window sections, then write five reporting queries against your own schema.",
      resources: [course("PostgreSQL Exercises", "https://pgexercises.com/"), course("SQLBolt", "https://sqlbolt.com/"), docs("PostgreSQL — Queries", "https://www.postgresql.org/docs/current/queries.html"), docs("PostgreSQL — Window functions", "https://www.postgresql.org/docs/current/tutorial-window.html"), roadmap("roadmap.sh — SQL", "https://roadmap.sh/sql")],
      dependsOn: ["db.relational"],
    },
    {
      slug: "db.modelling", name: "Data modelling and relationships", priority: "CORE", hours: 8,
      description: "Turning requirements into tables: cardinality, join tables, and knowing when to denormalise.",
      subtopics: ["One-to-many relationships", "Many-to-many and join tables", "ER diagrams", "Denormalisation trade-offs"],
      exercise: "Draw the ER diagram for a course-booking system, implement it, and justify one deliberate denormalisation.",
      resources: [docs("PostgreSQL — Data definition", "https://www.postgresql.org/docs/current/ddl.html"), docs("Prisma — Relations", "https://www.prisma.io/docs/orm/prisma-schema/data-model/relations")],
      dependsOn: ["db.relational"],
    },
    {
      slug: "db.migrations", name: "Schema migrations", priority: "CORE", hours: 5,
      description: "Changing a live schema without losing data or taking the application down.",
      subtopics: ["Versioned migration workflow", "Safe schema changes", "Seed and reference data"],
      exercise: "Rename a column in a populated table using an expand-and-contract migration sequence with no data loss.",
      resources: [docs("Prisma — Migrate", "https://www.prisma.io/docs/orm/prisma-migrate"), article("Martin Fowler — Evolutionary database design", "https://martinfowler.com/articles/evodb.html")],
      dependsOn: ["db.modelling"],
    },
    {
      slug: "db.transactions", name: "Transactions and concurrency", priority: "CORE", hours: 12,
      description: "What happens when two operations touch the same data at once, and how PostgreSQL keeps it consistent.",
      subtopics: ["ACID", "Isolation levels", "Locks and deadlocks", "Optimistic concurrency control"],
      exercise: "Reproduce a lost-update bug with two concurrent sessions, then fix it twice: once with SELECT … FOR UPDATE and once with a version column.",
      resources: [docs("PostgreSQL — Transactions", "https://www.postgresql.org/docs/current/tutorial-transactions.html"), docs("PostgreSQL — Transaction isolation", "https://www.postgresql.org/docs/current/transaction-iso.html"), docs("PostgreSQL — Explicit locking", "https://www.postgresql.org/docs/current/explicit-locking.html"), docs("Prisma — Transactions", "https://www.prisma.io/docs/orm/prisma-client/queries/transactions")],
      dependsOn: ["db.sql"],
    },
    {
      slug: "db.indexes", name: "Indexes and query performance", priority: "CORE", hours: 12,
      description: "Making queries fast by reading query plans rather than guessing.",
      subtopics: ["B-tree indexes", "Reading EXPLAIN ANALYZE", "Composite and partial indexes", "Connection pooling"],
      exercise: "Load one million rows, find three slow queries with EXPLAIN ANALYZE, fix them with indexes and record the before/after timings.",
      resources: [article("Use The Index, Luke!", "https://use-the-index-luke.com/"), docs("PostgreSQL — Indexes", "https://www.postgresql.org/docs/current/indexes.html"), docs("PostgreSQL — Using EXPLAIN", "https://www.postgresql.org/docs/current/using-explain.html")],
      dependsOn: ["db.sql"],
    },
    {
      slug: "db.operations", name: "Backup, restore and roles", priority: "IMPORTANT", hours: 5,
      description: "Operating a database you care about: backups you have actually restored, and least-privilege roles.",
      subtopics: ["pg_dump and pg_restore", "Roles and privileges", "Basic monitoring (pg_stat views)"],
      exercise: "Back up Engineering City's database, restore it into a fresh container and verify the data; create a read-only role.",
      resources: [docs("PostgreSQL — Backup and restore", "https://www.postgresql.org/docs/current/backup-dump.html"), docs("PostgreSQL — Database roles", "https://www.postgresql.org/docs/current/user-manag.html")],
      dependsOn: ["db.migrations"],
    },
    {
      slug: "db.scaling", name: "Scaling databases", priority: "IMPORTANT", hours: 6,
      description: "What to do when one database server is no longer enough, and what each option costs.",
      subtopics: ["Replication", "Partitioning", "Sharding strategies", "CAP trade-offs in practice"],
      exercise: "Set up a PostgreSQL primary with one streaming replica in Docker and observe replication lag under load.",
      resources: [docs("PostgreSQL — High availability and replication", "https://www.postgresql.org/docs/current/high-availability.html"), docs("PostgreSQL — Partitioning", "https://www.postgresql.org/docs/current/ddl-partitioning.html"), RM],
      dependsOn: ["db.indexes"],
    },
    {
      slug: "db.nosql", name: "NoSQL landscape", priority: "OPTIONAL", hours: 6,
      description: "Document, key-value, wide-column, graph and time-series stores: what problems each one is shaped for.",
      subtopics: ["Document stores (MongoDB)", "Key-value stores", "Wide-column stores", "Graph and time-series databases"],
      exercise: "Model the same small dataset in PostgreSQL and MongoDB and compare two queries.",
      resources: [docs("MongoDB — Introduction", "https://www.mongodb.com/docs/manual/introduction/"), RM],
    },
  ],
};
