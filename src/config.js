import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const dataDir = path.resolve(process.env.DATA_DIR || './data');

function chownTree(target, uid, gid) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return;
  if (stat.uid !== uid || stat.gid !== gid) fs.chownSync(target, uid, gid);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) chownTree(path.join(target, entry), uid, gid);
  }
}

/**
 * In the container the process starts as root so it can take ownership of a bind-mounted
 * data dir (host dirs are usually root-owned), then drops to PUID/PGID before touching any data.
 */
function dropPrivileges() {
  if (!process.env.PUID || typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const uid = Number(process.env.PUID);
  const gid = Number(process.env.PGID || uid);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid <= 0 || gid <= 0) {
    throw new Error('PUID/PGID must be positive integers.');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  chownTree(dataDir, uid, gid);
  process.setgroups([gid]);
  process.setgid(gid);
  process.setuid(uid);
}

dropPrivileges();
fs.mkdirSync(dataDir, { recursive: true });

/**
 * The admin token protects every write (admin UI, REST API, MCP).
 * Taken from ADMIN_TOKEN; otherwise generated once and persisted in the data dir.
 */
function resolveAdminToken() {
  if (process.env.ADMIN_TOKEN) return { token: process.env.ADMIN_TOKEN, generated: false };
  const file = path.join(dataDir, '.admin-token');
  if (fs.existsSync(file)) return { token: fs.readFileSync(file, 'utf8').trim(), generated: false, file };
  const token = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  return { token, generated: true, file };
}

const admin = resolveAdminToken();

const num = (value) => (value == null || value === '' || Number.isNaN(Number(value)) ? null : Number(value));

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  adminToken: admin.token,
  adminTokenInfo: admin,
  timeZone: process.env.APP_TIMEZONE || 'Europe/Berlin',
  maxImageBytes: 8 * 1024 * 1024,
  // Initial values for settings that can later be changed in the admin UI.
  defaults: {
    language: process.env.APP_LANGUAGE || 'en',
    site_name: process.env.SITE_NAME || '',
    weather_location_name: process.env.WEATHER_LOCATION || '',
    weather_latitude: num(process.env.WEATHER_LATITUDE),
    weather_longitude: num(process.env.WEATHER_LONGITUDE),
  },
  // Changes on every start so open displays reload themselves after an update/redeploy.
  bootId: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
};
