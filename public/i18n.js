// Translations in the browser: loads /locales/<language>.json (the same files the server uses), English as fallback.
const FALLBACK = 'en';

let dict = {};
let fallback = null;

/** Current language code (e.g. "de") and its locale for dates and numbers (e.g. "de-DE"). */
export let language = FALLBACK;
export let locale = 'en-GB';

async function fetchDictionary(code) {
  const res = await fetch(`/locales/${encodeURIComponent(code)}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Loads a language and updates all elements marked with data-i18n / data-i18n-aria. */
export async function setLanguage(code) {
  fallback ??= await fetchDictionary(FALLBACK);
  dict = code === FALLBACK ? fallback : await fetchDictionary(code).catch(() => fallback);
  language = dict === fallback ? FALLBACK : code;
  locale = dict._meta?.locale ?? fallback._meta?.locale ?? 'en-GB';
  document.documentElement.lang = language;
  applyI18n();
}

function lookup(source, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), source);
}

/** True if the key exists in the current language or the fallback. */
export const has = (key) => lookup(dict, key) != null || lookup(fallback, key) != null;

/**
 * Translates `key`. Placeholders look like {name}; entries with "one"/"other" are chosen by params.count.
 * Missing keys return the key itself, which makes them easy to spot.
 */
export function t(key, params = {}) {
  let text = lookup(dict, key) ?? lookup(fallback, key) ?? key;
  if (text && typeof text === 'object') text = params.count === 1 ? text.one : text.other;
  return String(text).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/** Like t(), but placeholder values may be DOM nodes; returns an array of strings and nodes for h(). */
export function tNodes(key, params = {}) {
  return t(key).split(/(\{\w+\})/).filter(Boolean).map((part) => {
    const name = part.match(/^\{(\w+)\}$/)?.[1];
    return name && name in params ? params[name] : part;
  });
}

/** Fills static markup: data-i18n sets the text, data-i18n-aria the aria-label. */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}
