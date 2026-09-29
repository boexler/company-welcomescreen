import { FALLBACK_LANGUAGE, translate } from './i18n.js';

/**
 * An error with an HTTP status and a translatable message (key into the language files).
 * `message` holds the English text for logs; responses are translated into the configured language.
 */
export class HttpError extends Error {
  constructor(status, key, params = {}) {
    super(translate(FALLBACK_LANGUAGE, key, params));
    this.status = status;
    this.key = key;
    this.params = params;
  }

  localize(language) {
    return translate(language, this.key, this.params);
  }
}
