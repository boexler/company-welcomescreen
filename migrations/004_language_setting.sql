-- Multilingual UI: the "language" setting selects the language (default for new installations: APP_LANGUAGE or English).
-- Installations from before this change were German-only, so they keep German.
INSERT OR IGNORE INTO settings (key, value)
SELECT 'language', '"de"'
WHERE EXISTS (SELECT 1 FROM companies) OR EXISTS (SELECT 1 FROM settings WHERE key <> 'active_layout_id');

-- The greeting texts used to default to the German text below and were stored as such when the settings were saved.
-- Empty now means "default text of the selected language".
UPDATE settings SET value = '""'
WHERE key IN ('welcome_prefix', 'idle_title') AND value = '"Herzlich willkommen"';
