import Database from "better-sqlite3";

function createSqliteClient(dbPath) {
  return new Database(dbPath);
}

export function createDatabaseClient({ dbPath }) {
  // Only SQLite is supported now.
  return createSqliteClient(dbPath);
}
