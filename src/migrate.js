// Schema migrations.
//
// Files in /migrations named "<number>_<name>.sql" or "<number>_<name>.js" are applied in
// numeric order, each in its own transaction, and recorded in the schema_migrations table.
// JS migrations export a synchronous `up(db)` function (for data migrations).
//
// Foreign keys are switched off while migrating so tables can be rebuilt the SQLite way
// (create new table, copy, drop old, rename); integrity is verified with
// PRAGMA foreign_key_check before each migration commits.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FILE_PATTERN = /^(\d+)_([\w-]+)\.(sql|js)$/;

export function listMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .map((file) => ({ file, match: file.match(FILE_PATTERN) }))
    .filter(({ match }) => match)
    .map(({ file, match }) => {
      const source = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      return {
        version: Number(match[1]),
        name: match[2],
        type: match[3],
        file,
        source,
        checksum: crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex'),
      };
    })
    .sort((a, b) => a.version - b.version);
  const seen = new Set();
  for (const m of files) {
    if (seen.has(m.version)) throw new Error(`Doppelte Migrationsnummer ${m.version} in ${MIGRATIONS_DIR}`);
    seen.add(m.version);
  }
  return files;
}

function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    checksum    TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

export function migrationStatus(db) {
  ensureTable(db);
  const applied = new Map(db.prepare('SELECT * FROM schema_migrations').all().map((r) => [r.version, r]));
  const files = listMigrationFiles();
  const known = new Set(files.map((m) => m.version));
  return {
    files: files.map((m) => ({ ...m, applied: applied.get(m.version) ?? null, changed: applied.has(m.version) && applied.get(m.version).checksum !== m.checksum })),
    unknown: [...applied.values()].filter((r) => !known.has(r.version)),
  };
}

/** Applies all pending migrations. Returns the list of applied migrations. */
export async function runMigrations(db, { log = console.log } = {}) {
  const { files, unknown } = migrationStatus(db);
  for (const m of files.filter((f) => f.changed)) {
    log(`Warning: migration ${m.file} was changed after it had been applied – the changes are not applied again.`);
  }
  for (const r of unknown) {
    log(`Warning: the database contains migration ${r.version}_${r.name}, which is missing in the code (is the database newer than the app?).`);
  }

  const pending = files.filter((f) => !f.applied);
  if (!pending.length) return [];

  // Load JS migrations up front; the actual migration runs synchronously inside a transaction.
  for (const m of pending) {
    if (m.type === 'js') {
      const mod = await import(pathToFileURL(path.join(MIGRATIONS_DIR, m.file)).href);
      if (typeof mod.up !== 'function') throw new Error(`Migration ${m.file} does not export a function up(db).`);
      m.up = mod.up;
    } else {
      m.up = (conn) => conn.exec(m.source);
    }
  }

  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    for (const m of pending) {
      db.transaction(() => {
        const result = m.up(db);
        if (result && typeof result.then === 'function') throw new Error(`Migration ${m.file}: up(db) must be synchronous.`);
        const violations = db.pragma('foreign_key_check');
        if (violations.length) throw new Error(`Migration ${m.file} violates foreign keys: ${JSON.stringify(violations.slice(0, 5))}`);
        db.prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)').run(m.version, m.name, m.checksum);
      })();
      log(`Migration applied: ${m.file}`);
    }
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }
  return pending.map(({ version, name, file }) => ({ version, name, file }));
}
