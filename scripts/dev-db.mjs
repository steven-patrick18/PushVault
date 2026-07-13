/**
 * Local dev database: real PostgreSQL via embedded-postgres (no Docker needed).
 * Runs on port 5433 with data dir ./.pgdata — keep this process running while developing.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve(process.cwd(), ".pgdata");
const PORT = 5433;

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--no-locale"],
});

const alreadyInitialised = existsSync(resolve(DATA_DIR, "PG_VERSION"));

if (!alreadyInitialised) {
  console.log("[dev-db] initialising PostgreSQL data directory...");
  await pg.initialise();
}

console.log("[dev-db] starting PostgreSQL on port " + PORT + "...");
await pg.start();

try {
  await pg.createDatabase("pushvault");
  console.log("[dev-db] created database 'pushvault'");
} catch {
  console.log("[dev-db] database 'pushvault' already exists");
}

console.log("[dev-db] READY — postgres://postgres:postgres@localhost:5433/pushvault");

const shutdown = async () => {
  console.log("[dev-db] stopping...");
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
