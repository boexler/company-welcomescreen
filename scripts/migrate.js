// Migration CLI.
//   npm run migrate                 -> apply pending migrations and show status
//   npm run migrate -- status       -> show status only
//   npm run migrate -- new <name>   -> create migrations/<next>_<name>.sql
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_DIR, listMigrationFiles } from '../src/migrate.js';

const [command = 'up', ...args] = process.argv.slice(2);

if (command === 'new') {
  const name = args.join('_').toLowerCase().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!name) {
    console.error('Please specify a name: npm run migrate -- new add_company_website');
    process.exit(1);
  }
  const next = Math.max(0, ...listMigrationFiles().map((m) => m.version)) + 1;
  const file = path.join(MIGRATIONS_DIR, `${String(next).padStart(3, '0')}_${name}.sql`);
  fs.writeFileSync(file, `-- ${name}\n-- Applied automatically in a transaction on the next start.\n-- Example: ALTER TABLE companies ADD COLUMN website TEXT;\n\n`);
  console.log(`Created: ${path.relative(process.cwd(), file)}`);
  process.exit(0);
}

if (command !== 'up' && command !== 'status') {
  console.error(`Unknown command "${command}". Allowed: up, status, new <name>`);
  process.exit(1);
}

// Importing db.js applies pending migrations; for "status" we inspect without it.
const { migrationStatus } = await import('../src/migrate.js');
let db;
if (command === 'up') {
  ({ db } = await import('../src/db.js'));
} else {
  const Database = (await import('better-sqlite3')).default;
  const { config } = await import('../src/config.js');
  db = new Database(path.join(config.dataDir, 'welcomescreen.db'));
}

const { files, unknown } = migrationStatus(db);
for (const m of files) {
  const state = m.applied ? `applied ${m.applied.applied_at}${m.changed ? '  (file changed afterwards!)' : ''}` : 'pending';
  console.log(`${m.applied ? '✓' : '·'} ${m.file.padEnd(40)} ${state}`);
}
for (const r of unknown) console.log(`? ${`${r.version}_${r.name}`.padEnd(40)} only present in the database`);
db.close();
