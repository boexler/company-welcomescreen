import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './errors.js';

function tokenFrom(req) {
  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : req.get('x-api-key') || '';
}

export function isAuthorized(req) {
  const given = Buffer.from(tokenFrom(req));
  const expected = Buffer.from(config.adminToken);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Express middleware guarding all write access. */
export function requireAdmin(req, res, next) {
  next(isAuthorized(req) ? undefined : new HttpError(401, 'errors.unauthorized'));
}
