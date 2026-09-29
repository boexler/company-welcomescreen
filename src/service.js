// Domain logic shared by the REST API and the MCP server.
import { db, tx } from './db.js';
import { config } from './config.js';
import { storeImage, deleteImage } from './images.js';
import { HttpError } from './errors.js';
import { msg, LANGUAGES, isLanguage, FALLBACK_LANGUAGE } from './i18n.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `field` is the translatable field name used in error messages, e.g. msg('fields.name'). */
function cleanText(value, { field, required = false, max = 2000 } = {}) {
  if (value === undefined) return undefined;
  if (value === null) {
    if (required) throw new HttpError(400, 'errors.required', { field });
    return null;
  }
  const s = String(value).trim();
  if (!s && required) throw new HttpError(400, 'errors.required', { field });
  if (s.length > max) throw new HttpError(400, 'errors.tooLong', { field, max });
  return s || null;
}

function cleanInt(value, { field, min, max }) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value === null || value === '' || !Number.isInteger(n)) throw new HttpError(400, 'errors.integer', { field });
  if (n < min || n > max) throw new HttpError(400, 'errors.range', { field, min, max });
  return n;
}

const truthy = (v) => v === true || v === 1 || ['1', 'true', 'yes', 'on', 'ja'].includes(String(v ?? '').toLowerCase());

/** Today's date (YYYY-MM-DD) in the app's time zone – the server itself usually runs in UTC. */
export function today() {
  return isoInZone(new Date());
}

function isoInZone(date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const RELATIVE_DAYS = { heute: 0, today: 0, morgen: 1, tomorrow: 1, 'übermorgen': 2, uebermorgen: 2 };

/** Accepts YYYY-MM-DD, DD.MM.YYYY, today/tomorrow or the German heute/morgen/übermorgen. */
export function parseDate(value, { field = msg('fields.date'), fallback } = {}) {
  if (value == null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, 'errors.required', { field });
  }
  const s = String(value).trim().toLowerCase();
  if (s in RELATIVE_DAYS) return addDays(today(), RELATIVE_DAYS[s]);
  let y, mo, d;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (m) [, y, mo, d] = m.map(Number);
  else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) [, d, mo, y] = m.map(Number);
  else throw new HttpError(400, 'errors.invalidDate', { field, value });

  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    throw new HttpError(400, 'errors.nonexistentDate', { field, value });
  }
  return date.toISOString().slice(0, 10);
}

function conflictOnUnique(fn, key, params) {
  try {
    return fn();
  } catch (err) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, key, params);
    throw err;
  }
}

const imageUrl = (id) => (id ? `/api/images/${id}` : null);

/** Replaces an image reference: stores the new one (if given) or removes the old one (if requested). */
function replaceImage(currentId, input, remove) {
  if (input != null && input !== '') {
    const id = storeImage(input);
    deleteImage(currentId);
    return id;
  }
  if (remove) {
    deleteImage(currentId);
    return null;
  }
  return currentId;
}

function isId(ref) {
  return typeof ref === 'number' || /^\d+$/.test(String(ref ?? '').trim());
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export function resolveCompanyId(ref) {
  const row = isId(ref)
    ? db.prepare('SELECT id FROM companies WHERE id = ?').get(Number(ref))
    : db.prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE').get(String(ref ?? '').trim());
  if (!row) throw new HttpError(404, 'errors.companyNotFound', { ref });
  return row.id;
}

function presentCompany(row) {
  const { logo_image_id, ...rest } = row;
  return { ...rest, logo_url: imageUrl(logo_image_id) };
}

export function listCompanies() {
  return db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id) AS employee_count,
           (SELECT MIN(v.start_date) FROM visits v WHERE v.company_id = c.id AND v.end_date >= ?) AS next_visit
    FROM companies c ORDER BY c.name
  `).all(today()).map(presentCompany);
}

export function getCompany(ref) {
  const id = resolveCompanyId(ref);
  const company = presentCompany(db.prepare('SELECT * FROM companies WHERE id = ?').get(id));
  return {
    ...company,
    employees: listEmployees({ company: id }),
    upcoming_visits: listVisits({ company: id }),
  };
}

export function createCompany({ name, logo, note }) {
  return tx(() => {
    const logoId = storeImage(logo);
    const id = conflictOnUnique(
      () => db.prepare('INSERT INTO companies (name, logo_image_id, note) VALUES (?, ?, ?)')
        .run(cleanText(name, { field: msg('fields.name'), required: true, max: 120 }), logoId, cleanText(note, { field: msg('fields.note') }) ?? null)
        .lastInsertRowid,
      'errors.companyExists', { name },
    );
    return getCompany(id);
  });
}

export function updateCompany(ref, { name, logo, remove_logo, note }) {
  return tx(() => {
    const id = resolveCompanyId(ref);
    const current = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
    const logoId = replaceImage(current.logo_image_id, logo, truthy(remove_logo));
    const newName = cleanText(name, { field: msg('fields.name'), required: true, max: 120 }) ?? current.name;
    const newNote = note === undefined ? current.note : cleanText(note, { field: msg('fields.note') });
    conflictOnUnique(
      () => db.prepare("UPDATE companies SET name = ?, logo_image_id = ?, note = ?, updated_at = datetime('now') WHERE id = ?").run(newName, logoId, newNote, id),
      'errors.companyExists', { name: newName },
    );
    return getCompany(id);
  });
}

export function deleteCompany(ref) {
  return tx(() => {
    const id = resolveCompanyId(ref);
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
    const photos = db.prepare('SELECT photo_image_id FROM employees WHERE company_id = ? AND photo_image_id IS NOT NULL').pluck().all(id);
    db.prepare('DELETE FROM companies WHERE id = ?').run(id);
    for (const imageId of [company.logo_image_id, ...photos]) deleteImage(imageId);
    return { deleted: true, id, name: company.name };
  });
}

// ---------------------------------------------------------------------------
// Employees (of visiting companies)
// ---------------------------------------------------------------------------

export function resolveEmployeeId(ref, companyRef) {
  if (isId(ref)) {
    const row = db.prepare('SELECT id, company_id FROM employees WHERE id = ?').get(Number(ref));
    if (!row) throw new HttpError(404, 'errors.employeeNotFound', { ref });
    if (companyRef != null && companyRef !== '' && row.company_id !== resolveCompanyId(companyRef)) {
      throw new HttpError(400, 'errors.employeeOtherCompany', { ref });
    }
    return row.id;
  }
  const name = String(ref ?? '').trim();
  const rows = companyRef != null && companyRef !== ''
    ? db.prepare('SELECT id FROM employees WHERE name = ? COLLATE NOCASE AND company_id = ?').all(name, resolveCompanyId(companyRef))
    : db.prepare('SELECT id FROM employees WHERE name = ? COLLATE NOCASE').all(name);
  if (!rows.length) throw new HttpError(404, 'errors.employeeNotFound', { ref });
  if (rows.length > 1) throw new HttpError(409, 'errors.employeeAmbiguous', { ref });
  return rows[0].id;
}

function presentEmployee(row) {
  const { photo_image_id, ...rest } = row;
  return { ...rest, photo_url: imageUrl(photo_image_id) };
}

const EMPLOYEE_SQL = `
  SELECT e.id, e.company_id, c.name AS company_name, e.name, e.title, e.photo_image_id, e.sort_order, e.created_at, e.updated_at
  FROM employees e JOIN companies c ON c.id = e.company_id
`;

export function listEmployees({ company } = {}) {
  if (company != null && company !== '') {
    return db.prepare(`${EMPLOYEE_SQL} WHERE e.company_id = ? ORDER BY e.sort_order, e.name`).all(resolveCompanyId(company)).map(presentEmployee);
  }
  return db.prepare(`${EMPLOYEE_SQL} ORDER BY c.name, e.sort_order, e.name`).all().map(presentEmployee);
}

export function getEmployee(ref, company) {
  const id = resolveEmployeeId(ref, company);
  return presentEmployee(db.prepare(`${EMPLOYEE_SQL} WHERE e.id = ?`).get(id));
}

export function createEmployee({ company, name, title, photo, sort_order }) {
  return tx(() => {
    const companyId = resolveCompanyId(company);
    const cleanName = cleanText(name, { field: msg('fields.name'), required: true, max: 120 });
    const photoId = storeImage(photo);
    const id = conflictOnUnique(
      () => db.prepare('INSERT INTO employees (company_id, name, title, photo_image_id, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(companyId, cleanName, cleanText(title, { field: msg('fields.position'), max: 120 }) ?? null, photoId,
          cleanInt(sort_order, { field: msg('fields.sortOrder'), min: -9999, max: 9999 }) ?? 0)
        .lastInsertRowid,
      'errors.employeeExists', { name: cleanName },
    );
    return getEmployee(id);
  });
}

export function updateEmployee(ref, { company, name, title, photo, remove_photo, sort_order }) {
  return tx(() => {
    const id = resolveEmployeeId(ref);
    const current = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    const companyId = company != null && company !== '' ? resolveCompanyId(company) : current.company_id;
    const photoId = replaceImage(current.photo_image_id, photo, truthy(remove_photo));
    const newName = cleanText(name, { field: msg('fields.name'), required: true, max: 120 }) ?? current.name;
    const newTitle = title === undefined ? current.title : cleanText(title, { field: msg('fields.position'), max: 120 });
    const newSort = cleanInt(sort_order, { field: msg('fields.sortOrder'), min: -9999, max: 9999 }) ?? current.sort_order;
    conflictOnUnique(
      () => db.prepare("UPDATE employees SET company_id = ?, name = ?, title = ?, photo_image_id = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?")
        .run(companyId, newName, newTitle, photoId, newSort, id),
      'errors.employeeExists', { name: newName },
    );
    if (companyId !== current.company_id) db.prepare('DELETE FROM visit_employees WHERE employee_id = ?').run(id);
    return getEmployee(id);
  });
}

export function deleteEmployee(ref) {
  return tx(() => {
    const id = resolveEmployeeId(ref);
    const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    db.prepare('DELETE FROM employees WHERE id = ?').run(id);
    deleteImage(row.photo_image_id);
    return { deleted: true, id, name: row.name };
  });
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

const VISIT_SQL = `
  SELECT v.*, c.name AS company_name, c.logo_image_id
  FROM visits v JOIN companies c ON c.id = v.company_id
`;

function visitEmployees(visit) {
  const rows = visit.all_employees
    ? db.prepare(`${EMPLOYEE_SQL} WHERE e.company_id = ? ORDER BY e.sort_order, e.name`).all(visit.company_id)
    : db.prepare(`${EMPLOYEE_SQL} JOIN visit_employees ve ON ve.employee_id = e.id WHERE ve.visit_id = ? ORDER BY e.sort_order, e.name`).all(visit.id);
  return rows.map(presentEmployee);
}

function visitHosts(visitId) {
  return db.prepare('SELECT name FROM visit_hosts WHERE visit_id = ? ORDER BY position').pluck().all(visitId);
}

function presentVisit(row) {
  const { logo_image_id, all_employees, ...rest } = row;
  return {
    ...rest,
    all_employees: Boolean(all_employees),
    company_logo_url: imageUrl(logo_image_id),
    hosts: visitHosts(row.id),
    employees: visitEmployees(row),
  };
}

export function getVisit(id) {
  const row = db.prepare(`${VISIT_SQL} WHERE v.id = ?`).get(Number(id));
  if (!row) throw new HttpError(404, 'errors.visitNotFound', { id });
  return presentVisit(row);
}

/**
 * Lists visits overlapping [from, to]. Defaults: from = today, to = open end.
 * A single `date` returns the visits on exactly that day.
 */
export function listVisits({ from, to, date, company } = {}) {
  let start = parseDate(from, { field: msg('fields.fromDate'), fallback: today() });
  let end = to == null || to === '' ? '9999-12-31' : parseDate(to, { field: msg('fields.toDate') });
  if (date != null && date !== '') start = end = parseDate(date);
  const params = [end, start];
  let where = 'v.start_date <= ? AND v.end_date >= ?';
  if (company != null && company !== '') {
    where += ' AND v.company_id = ?';
    params.push(resolveCompanyId(company));
  }
  return db.prepare(`${VISIT_SQL} WHERE ${where} ORDER BY v.start_date, c.name`).all(...params).map(presentVisit);
}

function setVisitEmployees(visitId, companyId, employees) {
  db.prepare('DELETE FROM visit_employees WHERE visit_id = ?').run(visitId);
  const insert = db.prepare('INSERT OR IGNORE INTO visit_employees (visit_id, employee_id) VALUES (?, ?)');
  for (const ref of employees) insert.run(visitId, resolveEmployeeId(ref, companyId));
}

const MAX_HOSTS = 10;

/**
 * In-house contacts as a clean, de-duplicated list. Accepts an array or a string separated by commas, pipes,
 * semicolons or line breaks; `host` is the older single-contact field. Returns undefined if neither is given.
 */
function normalizeHosts(hosts, host) {
  const value = hosts !== undefined ? hosts : host;
  if (value === undefined) return undefined;
  if (value === null || value === '') return [];
  const items = Array.isArray(value) ? value : String(value).split(/[,;|\n]/);
  const seen = new Set();
  const list = [];
  for (const item of items) {
    const name = cleanText(item, { field: msg('fields.host'), max: 200 });
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    list.push(name);
  }
  if (list.length > MAX_HOSTS) throw new HttpError(400, 'errors.tooManyHosts', { max: MAX_HOSTS });
  return list;
}

function setVisitHosts(visitId, hosts) {
  db.prepare('DELETE FROM visit_hosts WHERE visit_id = ?').run(visitId);
  const insert = db.prepare('INSERT INTO visit_hosts (visit_id, position, name) VALUES (?, ?, ?)');
  hosts.forEach((name, i) => insert.run(visitId, i, name));
}

function normalizeEmployeeList(employees) {
  if (employees == null || employees === '') return null;
  if (Array.isArray(employees)) return employees.filter((x) => x !== '' && x != null);
  if (typeof employees === 'string') {
    const s = employees.trim();
    if (s.startsWith('[')) return JSON.parse(s);
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [employees];
}

/**
 * Schedules a visit. Without `employees` (or with all_employees = true) every employee of the company is shown;
 * otherwise only the listed ones (IDs or names).
 */
export function createVisit({ company, start_date, date, end_date, headline, message, hosts, host, employees, all_employees }) {
  return tx(() => {
    const companyId = resolveCompanyId(company);
    const start = parseDate(start_date ?? date);
    const end = parseDate(end_date, { field: msg('fields.endDate'), fallback: start });
    if (end < start) throw new HttpError(400, 'errors.endBeforeStart');
    const list = normalizeEmployeeList(employees);
    const all = all_employees !== undefined ? truthy(all_employees) : !list?.length;
    const hostList = normalizeHosts(hosts, host) ?? [];
    const id = db.prepare('INSERT INTO visits (company_id, start_date, end_date, headline, message, all_employees) VALUES (?, ?, ?, ?, ?, ?)')
      .run(companyId, start, end,
        cleanText(headline, { field: msg('fields.headline'), max: 200 }) ?? null,
        cleanText(message, { field: msg('fields.message'), max: 1000 }) ?? null,
        all ? 1 : 0)
      .lastInsertRowid;
    setVisitHosts(id, hostList);
    if (!all && list) setVisitEmployees(id, companyId, list);
    return getVisit(id);
  });
}

export function updateVisit(id, { company, start_date, date, end_date, headline, message, hosts, host, employees, all_employees }) {
  return tx(() => {
    const current = db.prepare('SELECT * FROM visits WHERE id = ?').get(Number(id));
    if (!current) throw new HttpError(404, 'errors.visitNotFound', { id });
    const companyId = company != null && company !== '' ? resolveCompanyId(company) : current.company_id;
    const startInput = start_date ?? date;
    const start = startInput != null && startInput !== '' ? parseDate(startInput) : current.start_date;
    // Without a new end date the visit keeps its length (moving the start moves the end along).
    const days = Math.round((Date.parse(current.end_date) - Date.parse(current.start_date)) / 86_400_000);
    const end = end_date != null && end_date !== '' ? parseDate(end_date, { field: msg('fields.endDate') }) : addDays(start, days);
    if (end < start) throw new HttpError(400, 'errors.endBeforeStart');

    const list = normalizeEmployeeList(employees);
    let all = current.all_employees === 1;
    if (all_employees !== undefined) all = truthy(all_employees);
    else if (list) all = list.length === 0;

    const hostList = normalizeHosts(hosts, host);
    const pick = (value, column, field, max) => (value === undefined ? current[column] : cleanText(value, { field, max }));
    db.prepare(`UPDATE visits SET company_id = ?, start_date = ?, end_date = ?, headline = ?, message = ?, all_employees = ?,
                updated_at = datetime('now') WHERE id = ?`)
      .run(companyId, start, end,
        pick(headline, 'headline', msg('fields.headline'), 200),
        pick(message, 'message', msg('fields.message'), 1000),
        all ? 1 : 0, current.id);
    if (hostList) setVisitHosts(current.id, hostList);
    if (all) db.prepare('DELETE FROM visit_employees WHERE visit_id = ?').run(current.id);
    else if (list) setVisitEmployees(current.id, companyId, list);
    else if (companyId !== current.company_id) db.prepare('DELETE FROM visit_employees WHERE visit_id = ?').run(current.id);
    return getVisit(current.id);
  });
}

export function deleteVisit(id) {
  const visit = getVisit(id);
  db.prepare('DELETE FROM visits WHERE id = ?').run(visit.id);
  return { deleted: true, id: visit.id, company_name: visit.company_name, start_date: visit.start_date, end_date: visit.end_date };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const text = (def, max = 200) => ({ type: 'text', def, max });
const int = (def, min, max) => ({ type: 'int', def, min, max });
const bool = (def) => ({ type: 'bool', def });
const coord = (def, limit) => ({ type: 'coord', def, limit });

// Labels document the settings for API/MCP clients; the admin UI shows the translated "settings.<key>" texts.
// Empty greeting texts fall back to the default text of the selected language.
export const SETTINGS = {
  language: {
    type: 'enum',
    def: isLanguage(config.defaults.language) ? config.defaults.language : FALLBACK_LANGUAGE,
    values: LANGUAGES.map((l) => l.code),
    label: 'Language of the display and the admin UI',
  },
  site_name: { ...text(config.defaults.site_name, 120), label: 'Your company name (for the greeting when no visit is scheduled)' },
  welcome_prefix: { ...text(''), label: 'Greeting above the company name (empty = default text of the language)' },
  idle_title: { ...text(''), label: 'Headline when no visit is scheduled today (empty = default text of the language)' },
  idle_text: { ...text('', 500), label: 'Text when no visit is scheduled today' },
  rotation_seconds: { ...int(12, 3, 300), label: 'Display time per company (seconds)' },
  home_timeout_seconds: { ...int(20, 5, 600), label: 'Return to "Home" after (seconds)' },
  max_employees_per_slide: { ...int(8, 1, 30), label: 'Max. employees per page' },
  show_employee_titles: { ...bool(true), label: 'Show employee positions' },
  weather_location_name: { ...text(config.defaults.weather_location_name, 120), label: 'Weather: place name' },
  weather_latitude: { ...coord(config.defaults.weather_latitude, 90), label: 'Weather: latitude' },
  weather_longitude: { ...coord(config.defaults.weather_longitude, 180), label: 'Weather: longitude' },
  wifi_ssid: { ...text('', 64), label: 'Guest Wi-Fi: name (SSID)' },
  wifi_password: { ...text('', 128), label: 'Guest Wi-Fi: password' },
  wifi_encryption: { type: 'enum', def: 'WPA', values: ['WPA', 'WEP', 'nopass'], label: 'Guest Wi-Fi: encryption' },
  wifi_hidden: { ...bool(false), label: 'Guest Wi-Fi: hidden SSID' },
  wifi_note: { ...text('', 300), label: 'Guest Wi-Fi: note' },
  active_layout_id: { type: 'layout', def: 1, label: 'Active layout' },
};

function parseSetting(key, value) {
  const def = SETTINGS[key];
  const field = msg(`settings.${key}`);
  switch (def.type) {
    case 'text': return cleanText(value, { field, max: def.max }) ?? '';
    case 'int': return cleanInt(value, { field, min: def.min, max: def.max });
    case 'bool': return truthy(value);
    case 'coord': {
      if (value == null || value === '') return null;
      const n = Number(String(value).replace(',', '.'));
      if (!Number.isFinite(n) || Math.abs(n) > def.limit) throw new HttpError(400, 'errors.coordinate', { field, limit: def.limit });
      return n;
    }
    case 'enum':
      if (!def.values.includes(value)) throw new HttpError(400, 'errors.enumValue', { field, values: def.values.join(', ') });
      return value;
    case 'layout': return resolveLayoutId(value);
    default: throw new Error(`Unknown setting type ${def.type}`);
  }
}

/** Language of the display, the admin UI and API error messages. */
export const currentLanguage = () => getSettings().language;

export function getSettings() {
  const stored = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, JSON.parse(r.value)]));
  return Object.fromEntries(Object.entries(SETTINGS).map(([key, def]) => [key, key in stored ? stored[key] : def.def]));
}

export function updateSettings(patch = {}) {
  return tx(() => {
    const unknown = Object.keys(patch).filter((k) => !(k in SETTINGS));
    if (unknown.length) throw new HttpError(400, 'errors.unknownSettings', { keys: unknown.join(', '), allowed: Object.keys(SETTINGS).join(', ') });
    const upsert = db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      upsert.run(key, JSON.stringify(parseSetting(key, value)));
    }
    return getSettings();
  });
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

export const TEMPLATES = { glass: 'Centered glass card (background image, logo top left, time top right)' };

export function resolveLayoutId(ref) {
  const row = isId(ref)
    ? db.prepare('SELECT id FROM layouts WHERE id = ?').get(Number(ref))
    : db.prepare('SELECT id FROM layouts WHERE name = ? COLLATE NOCASE').get(String(ref ?? '').trim());
  if (!row) throw new HttpError(404, 'errors.layoutNotFound', { ref });
  return row.id;
}

function presentLayout(row, activeId = getSettings().active_layout_id) {
  const { background_image_id, logo_image_id, ...rest } = row;
  return { ...rest, active: row.id === activeId, background_url: imageUrl(background_image_id), logo_url: imageUrl(logo_image_id) };
}

export function listLayouts() {
  const activeId = getSettings().active_layout_id;
  return db.prepare('SELECT * FROM layouts ORDER BY name').all().map((r) => presentLayout(r, activeId));
}

export function getLayout(ref) {
  return presentLayout(db.prepare('SELECT * FROM layouts WHERE id = ?').get(resolveLayoutId(ref)));
}

export function getActiveLayout() {
  const row = db.prepare('SELECT * FROM layouts WHERE id = ?').get(getSettings().active_layout_id)
    ?? db.prepare('SELECT * FROM layouts ORDER BY id LIMIT 1').get();
  return presentLayout(row, row.id);
}

function cleanColor(value, field = msg('fields.accentColor')) {
  if (value === undefined) return undefined;
  const s = String(value ?? '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(s)) throw new HttpError(400, 'errors.color', { field });
  return s.toLowerCase();
}

function cleanTemplate(value) {
  if (value === undefined) return undefined;
  if (!(value in TEMPLATES)) throw new HttpError(400, 'errors.unknownTemplate', { value, available: Object.keys(TEMPLATES).join(', ') });
  return value;
}

export function createLayout({ name, template, background, logo, accent_color, text_color, blur, dim, activate }) {
  return tx(() => {
    const cleanName = cleanText(name, { field: msg('fields.name'), required: true, max: 80 });
    const id = conflictOnUnique(
      () => db.prepare('INSERT INTO layouts (name, template, background_image_id, logo_image_id, accent_color, text_color, blur, dim) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(cleanName, cleanTemplate(template) ?? 'glass', storeImage(background), storeImage(logo),
          cleanColor(accent_color) ?? '#4f8cff',
          cleanColor(text_color, msg('fields.textColor')) ?? '#ffffff',
          cleanInt(blur, { field: msg('fields.blur'), min: 0, max: 60 }) ?? 24,
          cleanInt(dim, { field: msg('fields.dim'), min: 0, max: 90 }) ?? 25)
        .lastInsertRowid,
      'errors.layoutExists', { name: cleanName },
    );
    if (truthy(activate)) updateSettings({ active_layout_id: id });
    return getLayout(id);
  });
}

export function updateLayout(ref, { name, template, background, remove_background, logo, remove_logo, accent_color, text_color, blur, dim, activate }) {
  return tx(() => {
    const id = resolveLayoutId(ref);
    const cur = db.prepare('SELECT * FROM layouts WHERE id = ?').get(id);
    const newName = cleanText(name, { field: msg('fields.name'), required: true, max: 80 }) ?? cur.name;
    conflictOnUnique(
      () => db.prepare(`UPDATE layouts SET name = ?, template = ?, background_image_id = ?, logo_image_id = ?, accent_color = ?, text_color = ?, blur = ?, dim = ?,
                        updated_at = datetime('now') WHERE id = ?`)
        .run(newName, cleanTemplate(template) ?? cur.template,
          replaceImage(cur.background_image_id, background, truthy(remove_background)),
          replaceImage(cur.logo_image_id, logo, truthy(remove_logo)),
          cleanColor(accent_color) ?? cur.accent_color,
          cleanColor(text_color, msg('fields.textColor')) ?? cur.text_color,
          cleanInt(blur, { field: msg('fields.blur'), min: 0, max: 60 }) ?? cur.blur,
          cleanInt(dim, { field: msg('fields.dim'), min: 0, max: 90 }) ?? cur.dim,
          id),
      'errors.layoutExists', { name: newName },
    );
    if (truthy(activate)) updateSettings({ active_layout_id: id });
    return getLayout(id);
  });
}

export function activateLayout(ref) {
  updateSettings({ active_layout_id: resolveLayoutId(ref) });
  return getActiveLayout();
}

export function deleteLayout(ref) {
  return tx(() => {
    const id = resolveLayoutId(ref);
    if (getSettings().active_layout_id === id) throw new HttpError(409, 'errors.activeLayoutDelete');
    const row = db.prepare('SELECT * FROM layouts WHERE id = ?').get(id);
    db.prepare('DELETE FROM layouts WHERE id = ?').run(id);
    deleteImage(row.background_image_id);
    deleteImage(row.logo_image_id);
    return { deleted: true, id, name: row.name };
  });
}

// ---------------------------------------------------------------------------
// Display (what the welcome screen shows)
// ---------------------------------------------------------------------------

function chunk(list, size) {
  if (!list.length) return [[]];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Everything the welcome screen needs for one day. */
export function getDisplay({ date } = {}) {
  const day = parseDate(date, { fallback: today() });
  const settings = getSettings();
  const visits = listVisits({ date: day });
  const perSlide = settings.max_employees_per_slide;

  const slides = visits.flatMap((v) => {
    const pages = chunk(v.employees, perSlide);
    return pages.map((employees, i) => ({
      key: `${v.id}-${i}`,
      visit_id: v.id,
      company: { id: v.company_id, name: v.company_name, logo_url: v.company_logo_url },
      // null = the display shows the default greeting of the selected language.
      headline: v.headline || settings.welcome_prefix || null,
      message: v.message,
      hosts: v.hosts,
      page: i + 1,
      pages: pages.length,
      employees: employees.map(({ id, name, title, photo_url }) => ({ id, name, title: settings.show_employee_titles ? title : null, photo_url })),
    }));
  });

  const wifi = settings.wifi_ssid
    ? { ssid: settings.wifi_ssid, password: settings.wifi_encryption === 'nopass' ? '' : settings.wifi_password, encryption: settings.wifi_encryption, note: settings.wifi_note, qr_url: '/api/wifi/qr.svg' }
    : null;

  return {
    date: day,
    language: settings.language,
    boot_id: config.bootId,
    time_zone: config.timeZone,
    layout: getActiveLayout(),
    texts: {
      site_name: settings.site_name,
      welcome_prefix: settings.welcome_prefix,
      idle_title: settings.idle_title,
      idle_text: settings.idle_text,
    },
    timing: {
      rotation_seconds: settings.rotation_seconds,
      home_timeout_seconds: settings.home_timeout_seconds,
    },
    weather: settings.weather_latitude != null && settings.weather_longitude != null
      ? { location: settings.weather_location_name, url: '/api/weather' }
      : null,
    wifi,
    slides,
  };
}

export function getOverview() {
  const t = today();
  return {
    today: t,
    today_visits: listVisits({ date: t }).map(summarizeVisit),
    tomorrow_visits: listVisits({ date: addDays(t, 1) }).map(summarizeVisit),
    upcoming_visits: listVisits({ from: t, to: addDays(t, 30) }).map(summarizeVisit),
    companies: listCompanies().map(({ id, name, employee_count, next_visit }) => ({ id, name, employee_count, next_visit })),
    active_layout: getActiveLayout().name,
  };
}

export function summarizeVisit(v) {
  return {
    id: v.id,
    company: v.company_name,
    start_date: v.start_date,
    end_date: v.end_date,
    headline: v.headline,
    hosts: v.hosts,
    all_employees: v.all_employees,
    employees: v.employees.map((e) => e.name),
  };
}
