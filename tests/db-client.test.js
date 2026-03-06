import { describe, expect, it } from "vitest";
import { createDatabaseClient } from "../server/models/dbClient.js";

describe("dbClient", () => {
  it("uses sqlite client by default", () => {
    const old = process.env.DB_CLIENT;
    delete process.env.DB_CLIENT;

    const db = createDatabaseClient({ dbPath: ":memory:" });
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    db.prepare("INSERT INTO t (v) VALUES (?)").run("ok");
    const row = db.prepare("SELECT v FROM t WHERE id = ?").get(1);

    expect(row.v).toBe("ok");

    if (old !== undefined) {
      process.env.DB_CLIENT = old;
    } else {
      delete process.env.DB_CLIENT;
    }
  });

  it("throws on unsupported db client", () => {
    const old = process.env.DB_CLIENT;
    process.env.DB_CLIENT = "oracle";

    expect(() => createDatabaseClient({ dbPath: ":memory:" })).toThrow(
      /不支持的 DB_CLIENT/
    );

    if (old !== undefined) {
      process.env.DB_CLIENT = old;
    } else {
      delete process.env.DB_CLIENT;
    }
  });
});
