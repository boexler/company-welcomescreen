// Pool of default pictures ("avatars") that employees can use instead of their own photo, plus a custom
// background color for the initials. The pool starts with the pictures in assets/avatars.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'avatars');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

/** "02-lama.jpg" → "Lama" */
const nameOf = (file) => path.basename(file, path.extname(file)).replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function up(db) {
  db.exec(`
    CREATE TABLE avatars (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      image_id    INTEGER NOT NULL REFERENCES images(id),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE employees ADD COLUMN avatar_id INTEGER REFERENCES avatars(id) ON DELETE SET NULL;
    ALTER TABLE employees ADD COLUMN avatar_color TEXT;
  `);

  const files = fs.existsSync(ASSETS_DIR) ? fs.readdirSync(ASSETS_DIR).filter((f) => MIME[path.extname(f).toLowerCase()]).sort() : [];
  const insertImage = db.prepare('INSERT INTO images (mime, data) VALUES (?, ?)');
  const insertAvatar = db.prepare('INSERT INTO avatars (name, image_id) VALUES (?, ?)');
  for (const file of files) {
    const imageId = insertImage.run(MIME[path.extname(file).toLowerCase()], fs.readFileSync(path.join(ASSETS_DIR, file))).lastInsertRowid;
    insertAvatar.run(nameOf(file), imageId);
  }
}
