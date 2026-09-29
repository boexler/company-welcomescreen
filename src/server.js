import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import './db.js';
import { createApiRouter } from './api.js';
import { handleMcp } from './mcp.js';
import { HttpError } from './errors.js';
import { LOCALES_DIR } from './i18n.js';
import { currentLanguage } from './service.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '12mb' }));

app.use('/api', createApiRouter());
app.all('/mcp', handleMcp);
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.use('/locales', express.static(LOCALES_DIR));
app.use(express.static(publicDir, { index: 'index.html' }));

/** Error message in the configured language; errors from libraries without a translation keep their own text. */
function errorText(err, status) {
  const language = currentLanguage();
  if (status >= 500 && status !== 502) return new HttpError(status, 'errors.internal').localize(language);
  if (status === 413 && !(err instanceof HttpError)) return new HttpError(413, 'errors.requestTooLarge').localize(language);
  return err instanceof HttpError ? err.localize(language) : err.message;
}

app.use((err, req, res, _next) => {
  const status = err.status ?? (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500 && status !== 502) console.error(err);
  if (res.headersSent) return;
  if (status === 401) res.set('WWW-Authenticate', 'Bearer');
  let message;
  try {
    message = errorText(err, status);
  } catch {
    message = err.message; // e.g. the database itself is unavailable
  }
  res.status(status).json({ error: message, code: err instanceof HttpError ? err.key : undefined });
});

app.listen(config.port, config.host, () => {
  console.log(`company-welcomescreen running at http://localhost:${config.port}`);
  console.log(`  Welcome screen: /   Admin: /admin   REST: /api   MCP: /mcp`);
  const info = config.adminTokenInfo;
  if (info.generated) {
    console.log(`  New admin token generated: ${info.token}`);
    console.log(`  (saved in ${info.file}; can be overridden with ADMIN_TOKEN)`);
  } else if (info.file) {
    console.log(`  Admin token from ${info.file}`);
  }
});
