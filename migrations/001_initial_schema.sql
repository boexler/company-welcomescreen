-- Initial schema.

CREATE TABLE images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mime        TEXT    NOT NULL,
  data        BLOB    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Visiting companies.
CREATE TABLE companies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  logo_image_id   INTEGER REFERENCES images(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Employees of a visiting company.
CREATE TABLE employees (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL COLLATE NOCASE,
  title           TEXT,
  photo_image_id  INTEGER REFERENCES images(id) ON DELETE SET NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, name)
);

-- A company visiting on one or more consecutive days.
-- all_employees = 1: every employee of the company is shown; otherwise only those in visit_employees.
CREATE TABLE visits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  start_date      TEXT    NOT NULL,
  end_date        TEXT    NOT NULL,
  headline        TEXT,
  message         TEXT,
  host            TEXT,
  all_employees   INTEGER NOT NULL DEFAULT 1 CHECK (all_employees IN (0, 1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date >= start_date)
);

CREATE TABLE visit_employees (
  visit_id     INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (visit_id, employee_id)
);

-- Appearance of the welcome screen. "template" selects the page layout (currently only "glass").
CREATE TABLE layouts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  template             TEXT    NOT NULL DEFAULT 'glass',
  background_image_id  INTEGER REFERENCES images(id) ON DELETE SET NULL,
  logo_image_id        INTEGER REFERENCES images(id) ON DELETE SET NULL,
  accent_color         TEXT    NOT NULL DEFAULT '#4f8cff',
  blur                 INTEGER NOT NULL DEFAULT 24,
  dim                  INTEGER NOT NULL DEFAULT 25,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Key/value settings (JSON-encoded values).
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_employees_company ON employees(company_id);
CREATE INDEX idx_visits_dates ON visits(start_date, end_date);
CREATE INDEX idx_visits_company ON visits(company_id);

INSERT INTO layouts (name) VALUES ('Standard');
INSERT INTO settings (key, value) VALUES ('active_layout_id', '1');
