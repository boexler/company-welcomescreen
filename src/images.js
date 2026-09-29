import { db } from './db.js';
import { config } from './config.js';
import { HttpError } from './errors.js';

/** Detects the image type from the file content instead of trusting client-supplied types. */
export function sniffMime(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/**
 * Normalises the different ways an image can be supplied:
 *  - a multer file ({ buffer })
 *  - raw SVG markup (string starting with "<svg" / "<?xml")
 *  - a data URL ("data:image/png;base64,...")
 *  - plain base64
 * Returns a Buffer or null when nothing was supplied.
 */
export function toImageBuffer(input) {
  if (input == null || input === '') return null;
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === 'object' && Buffer.isBuffer(input.buffer)) return input.buffer;
  if (typeof input !== 'string') throw new HttpError(400, 'errors.invalidImage');
  const s = input.trim();
  if (s.startsWith('<')) return Buffer.from(s, 'utf8');
  const m = s.match(/^data:[^;,]+(;base64)?,(.*)$/s);
  if (m) return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]), 'utf8');
  return Buffer.from(s, 'base64');
}

export function storeImage(input) {
  const buf = toImageBuffer(input);
  if (!buf) return null;
  if (buf.length > config.maxImageBytes) throw new HttpError(413, 'errors.imageTooLarge', { max: config.maxImageBytes / 1024 / 1024 });
  const mime = sniffMime(buf);
  if (!mime) throw new HttpError(400, 'errors.unknownImageType');
  return db.prepare('INSERT INTO images (mime, data) VALUES (?, ?)').run(mime, buf).lastInsertRowid;
}

export function getImage(id) {
  return db.prepare('SELECT id, mime, data FROM images WHERE id = ?').get(id);
}

export function deleteImage(id) {
  if (id != null) db.prepare('DELETE FROM images WHERE id = ?').run(id);
}
