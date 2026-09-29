// Helpers shared by the display and the admin UI.

/** Tiny DOM builder: h('div', { class: 'x', onclick }, 'text', child, [more]). `html` sets trusted innerHTML (icons only). */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase() || '?';
}

export function hue(str) {
  let x = 0;
  for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) % 360;
  return x;
}

// --- Colors (#rrggbb) --------------------------------------------------------

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Relative luminance (WCAG), 0 = black … 1 = white. */
export function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1 … 21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `hex` towards `target` by t (0 … 1). */
export function mix(hex, target, t) {
  const a = channels(hex);
  const b = channels(target);
  return toHex(a.map((c, i) => c + (b[i] - c) * t));
}

/** Darkens or lightens `hex` just enough to reach the given contrast against `background`. */
export function readableOn(hex, background, min = 4.5) {
  const target = luminance(background) > 0.4 ? '#000000' : '#ffffff';
  for (let t = 0; t <= 1; t += 0.05) {
    const candidate = mix(hex, target, t);
    if (contrast(candidate, background) >= min) return candidate;
  }
  return target;
}

/** Dark text color used when the background is bright. */
export const DARK_TEXT = '#1e2530';

/** True if the text color is dark, i.e. the screen should use bright glass. */
export const isDarkText = (hex) => luminance(hex) < 0.4;
