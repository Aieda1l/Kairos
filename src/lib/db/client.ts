import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

let singleton: Database.Database | null = null;
let singletonPath: string | null = null;

function resolveDatabasePath(input?: string): string {
  const requested = input ?? process.env.ASSIGNMENTS_DB_PATH ?? ".data/assignments.sqlite";
  if (requested === ":memory:") return requested;
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), requested);
}

export function openDatabase(databasePath?: string): Database.Database {
  const resolved = resolveDatabasePath(databasePath);
  if (resolved !== ":memory:") fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  return db;
}

export function getDatabase(): Database.Database {
  const resolved = resolveDatabasePath();
  if (!singleton || singletonPath !== resolved) {
    singleton?.close();
    singleton = openDatabase(resolved);
    singletonPath = resolved;
  }
  return singleton;
}

export function resetDatabaseSingletonForTests(): void {
  singleton?.close();
  singleton = null;
  singletonPath = null;
}
