import QRCode from 'qrcode';
import { HttpError } from './errors.js';
import { getSettings } from './service.js';

// Special characters in the Wi-Fi QR format must be backslash-escaped.
const esc = (s) => String(s ?? '').replace(/([\\;,:"])/g, '\\$1');

/** "WIFI:" payload understood by the camera apps of iOS and Android. */
export function wifiPayload() {
  const s = getSettings();
  if (!s.wifi_ssid) throw new HttpError(404, 'errors.noWifi');
  const type = s.wifi_encryption === 'nopass' ? 'nopass' : s.wifi_encryption;
  const password = type === 'nopass' ? '' : `P:${esc(s.wifi_password)};`;
  return `WIFI:T:${type};S:${esc(s.wifi_ssid)};${password}${s.wifi_hidden ? 'H:true;' : ''};`;
}

export function wifiQrSvg() {
  return QRCode.toString(wifiPayload(), { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
}
