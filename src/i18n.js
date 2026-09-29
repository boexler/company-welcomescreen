// Translations. Every language is one JSON file in /locales (e.g. "de.json"); adding a file adds a language.
// The same files are served to the browser, so the display and the admin UI use identical texts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCALES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'locales');
export const FALLBACK_LANGUAGE = 'en';

const dictionaries = Object.fromEntries(
  fs.readdirSync(LOCALES_DIR)
    .filter((file) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(file))
    .map((file) => [path.basename(file, '.json'), JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'))]),
);

if (!dictionaries[FALLBACK_LANGUAGE]) throw new Error(`Missing fallback language file locales/${FALLBACK_LANGUAGE}.json`);

/** Available languages as [{ code, name }], e.g. [{ code: 'de', name: 'Deutsch' }]. */
export const LANGUAGES = Object.entries(dictionaries)
  .map(([code, dict]) => ({ code, name: dict._meta?.name ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const isLanguage = (code) => Object.hasOwn(dictionaries, code);

/** A translatable text: a key into the language files plus its placeholder values. */
export class Message {
  constructor(key, params = {}) {
    this.key = key;
    this.params = params;
  }
}

/** Marks a placeholder value as a key to translate as well, e.g. { field: msg('fields.name') }. */
export const msg = (key, params) => new Message(key, params);

function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);
}

/**
 * Translates `key` into `language` (falling back to English, then to the key itself).
 * Placeholders look like {name}; entries with "one"/"other" are chosen by params.count.
 */
export function translate(language, key, params = {}) {
  let text = lookup(dictionaries[language], key) ?? lookup(dictionaries[FALLBACK_LANGUAGE], key) ?? key;
  if (text && typeof text === 'object') text = params.count === 1 ? text.one : text.other;
  return String(text).replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in params)) return match;
    const value = params[name];
    return value instanceof Message ? translate(language, value.key, value.params) : String(value);
  });
}
