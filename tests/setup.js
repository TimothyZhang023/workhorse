import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `timo-vitest-${process.pid}.db`);

process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.REFRESH_SECRET = process.env.REFRESH_SECRET || 'test-refresh-secret';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';

if (fs.existsSync(dbPath)) {
  fs.rmSync(dbPath, { force: true });
}
