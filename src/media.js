// Background videos of layouts. Unlike images they are stored as files (data/media) instead of in the database:
// they are much larger and browsers request them in ranges.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { fetchUrl, isImageUrl as isUrl, toImageBuffer as toBuffer } from './images.js';

export const MEDIA_DIR = path.join(config.dataDir, 'media');
const FILE_PATTERN = /^[a-f0-9]{32}\.(mp4|webm)$/;
const FETCH_TIMEOUT_MS = 120_000;

const maxMegabytes = () => config.maxVideoBytes / 1024 / 1024;

/** Detects the container from the content: "mp4" (ISO base media, e.g. H.264), "webm" or null. */
export function sniffVideo(buf) {
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  return null;
}

/** Path of a stored video, or null if the name is not a valid media file name. */
export function mediaPath(name) {
  return FILE_PATTERN.test(String(name ?? '')) ? path.join(MEDIA_DIR, name) : null;
}

export const mediaUrl = (name) => (name ? `/api/media/${name}` : null);

/** Stores an uploaded video (multer file, Buffer, data URL or Base64) and returns its file name, or null. */
export function storeVideo(input) {
  const buf = toBuffer(input);
  if (!buf) return null;
  if (buf.length > config.maxVideoBytes) throw new HttpError(413, 'errors.videoTooLarge', { max: maxMegabytes() });
  const type = sniffVideo(buf);
  if (!type) throw new HttpError(400, 'errors.unknownVideoType');
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.${type}`;
  fs.writeFileSync(path.join(MEDIA_DIR, name), buf);
  return name;
}

export function deleteVideo(name) {
  const file = mediaPath(name);
  if (file) fs.rmSync(file, { force: true });
}

/** Duplicates a stored video (each layout owns its file) and returns the new name, or null. */
export function copyVideo(name) {
  const file = mediaPath(name);
  if (!file || !fs.existsSync(file)) return null;
  const copy = `${crypto.randomBytes(16).toString('hex')}${path.extname(name)}`;
  fs.copyFileSync(file, path.join(MEDIA_DIR, copy));
  return copy;
}

/**
 * Replaces video URLs by the downloaded video, for each of `fields`: either the field itself contains an http(s) URL
 * (JSON/MCP) or `<field>_url` does (admin forms). An uploaded file in the field takes precedence over `<field>_url`.
 */
export async function resolveVideoUrls(body, fields) {
  for (const field of fields) {
    const urlField = `${field}_url`;
    const url = isUrl(body[field]) ? body[field] : body[field] == null || body[field] === '' ? body[urlField] : null;
    delete body[urlField];
    if (isUrl(url)) {
      body[field] = await fetchUrl(url, {
        maxBytes: config.maxVideoBytes,
        timeoutMs: FETCH_TIMEOUT_MS,
        accept: 'video/*',
        errors: { unreachable: 'errors.videoUrlUnreachable', status: 'errors.videoUrlStatus', tooLarge: 'errors.videoTooLarge' },
      });
    }
  }
  return body;
}
