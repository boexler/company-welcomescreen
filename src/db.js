import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from './config.js';
import { runMigrations } from './migrate.js';

export const db = new Database(path.join(config.dataDir, 'welcomescreen.db'));
db.pragma('journal_mode = WAL');

await runMigrations(db);
db.pragma('foreign_keys = ON');

/** Runs fn inside a transaction and returns its result. */
export function tx(fn) {
  return db.transaction(fn)();
}
