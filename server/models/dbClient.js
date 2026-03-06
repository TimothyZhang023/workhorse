import Database from "better-sqlite3";

function waitForPromise(promise) {
  const lock = new Int32Array(new SharedArrayBuffer(4));
  let result;
  let error;

  promise
    .then((value) => {
      result = value;
      Atomics.store(lock, 0, 1);
      Atomics.notify(lock, 0, 1);
    })
    .catch((err) => {
      error = err;
      Atomics.store(lock, 0, 1);
      Atomics.notify(lock, 0, 1);
    });

  while (Atomics.load(lock, 0) === 0) {
    Atomics.wait(lock, 0, 0, 100);
  }

  if (error) {
    throw error;
  }

  return result;
}

function createSqliteClient(dbPath) {
  return new Database(dbPath);
}

function createMysqlClient() {
  let mysql;
  try {
    mysql = waitForPromise(import("mysql2/promise"));
  } catch (error) {
    throw new Error(
      `DB_CLIENT=mysql 需要依赖 mysql2，请先安装。原始错误: ${error.message}`
    );
  }

  const pool = waitForPromise(
    mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "gemini_chat",
      connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
      timezone: "Z",
      multipleStatements: true,
      dateStrings: true,
    })
  );

  const normalizeSql = (sql) =>
    sql
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "BIGINT PRIMARY KEY AUTO_INCREMENT")
      .replace(/\bDATETIME\b/g, "TIMESTAMP")
      .replace(/CREATE INDEX IF NOT EXISTS/gi, "CREATE INDEX")
      .replace(/\bBOOLEAN\b/g, "TINYINT(1)");

  return {
    exec(sql) {
      waitForPromise(pool.query(normalizeSql(sql)));
    },
    prepare(sql) {
      const normalized = normalizeSql(sql);
      return {
        run(...params) {
          const [result] = waitForPromise(pool.execute(normalized, params));
          return {
            lastInsertRowid: result?.insertId,
            changes: result?.affectedRows ?? 0,
          };
        },
        get(...params) {
          const [rows] = waitForPromise(pool.execute(normalized, params));
          return Array.isArray(rows) ? rows[0] : undefined;
        },
        all(...params) {
          const [rows] = waitForPromise(pool.execute(normalized, params));
          return Array.isArray(rows) ? rows : [];
        },
      };
    },
  };
}

export function createDatabaseClient({ dbPath }) {
  const client = (process.env.DB_CLIENT || "sqlite").toLowerCase();

  if (client === "sqlite") {
    return createSqliteClient(dbPath);
  }

  if (client === "mysql") {
    return createMysqlClient();
  }

  throw new Error(`不支持的 DB_CLIENT: ${client}。当前支持: sqlite, mysql`);
}
