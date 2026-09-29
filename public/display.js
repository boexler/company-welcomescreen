// Welcome screen (kiosk display) – no build step.
import { h, initials, hue, isDarkText, readableOn } from './shared.js';
import { t, has, setLanguage, locale } from './i18n.js';

const params = new URLSearchParams(location.search);
const previewDate = params.get('date');

const REFRESH_MS = 30_000;
const WEATHER_REFRESH_MS = 10 * 60_000;

const state = {
  data: null,
  slides: [],
  slideIndex: -1,
  slideTimer: null,
  view: 'home',
  homeTimer: null,
  weather: null,
  timeZone: undefined,
  language: null,
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const svg = (inner, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const P = {
  sun: '<g class="sun"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></g>',
  moon: '<path class="moon" d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1z"/>',
  cloud: '<path d="M7 19h10.2a4.3 4.3 0 0 0 .6-8.56A6.2 6.2 0 0 0 5.9 11.6 3.8 3.8 0 0 0 7 19z"/>',
  cloudSmall: '<path d="M9 20h8.6a3.6 3.6 0 0 0 .5-7.17 5.2 5.2 0 0 0-10-.2A3.2 3.2 0 0 0 9 20z"/>',
  sunSmall: '<g class="sun"><circle cx="8" cy="8" r="3"/><path d="M8 2v1.3M2 8h1.3M3.8 3.8l.9.9M12.2 3.8l-.9.9M3.8 12.2l.9-.9"/></g>',
  moonSmall: '<path class="moon" d="M12 9.6A4.8 4.8 0 0 1 6 3.6a4.8 4.8 0 1 0 6 6z"/>',
  rainCloud: '<path d="M7 15.5h10.2a4.3 4.3 0 0 0 .6-8.56A6.2 6.2 0 0 0 5.9 8.1 3.8 3.8 0 0 0 7 15.5z"/>',
  rain: '<g class="drop"><path d="M8 18.5l-1 2.5M12 18.5l-1 2.5M16 18.5l-1 2.5"/></g>',
  drizzle: '<g class="drop"><path d="M8 19v.5M12 19.5v.5M16 19v.5M10 21.5v.5M14 21.5v.5"/></g>',
  snow: '<g class="drop"><path d="M8 19h.01M12 20.5h.01M16 19h.01M10 22h.01M14 22h.01" stroke-width="2.4"/></g>',
  bolt: '<path class="bolt" d="m12.5 15.5-2 3.5h3l-2 3.5"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14M8 21h8"/>',
};

const WEATHER_ICONS = {
  clear: P.sun,
  'clear-night': P.moon,
  'mostly-clear': P.sunSmall + P.cloudSmall,
  'mostly-clear-night': P.moonSmall + P.cloudSmall,
  'partly-cloudy': P.sunSmall + P.cloudSmall,
  'partly-cloudy-night': P.moonSmall + P.cloudSmall,
  cloudy: P.cloud,
  fog: P.fog,
  drizzle: P.rainCloud + P.drizzle,
  rain: P.rainCloud + P.rain,
  showers: P.rainCloud + P.rain,
  sleet: P.rainCloud + P.snow,
  snow: P.rainCloud + P.snow,
  thunder: P.rainCloud + P.bolt,
};

function weatherIcon(key) {
  const span = document.createElement('span');
  span.innerHTML = svg(WEATHER_ICONS[key] ?? P.cloud, 'wi');
  return span.firstChild;
}

const NAV_ICONS = {
  home: svg('<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>'),
  weather: svg(`${P.sunSmall}${P.cloudSmall}`),
  wifi: svg('<path d="M2.5 8.8a14 14 0 0 1 19 0"/><path d="M5.6 12.2a9.5 9.5 0 0 1 12.8 0"/><path d="M8.8 15.5a5 5 0 0 1 6.4 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>'),
  person: svg('<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.5a7.2 7.2 0 0 1 14.4 0"/>'),
};

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = NAV_ICONS[el.dataset.icon];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmt = (opts) => new Intl.DateTimeFormat(locale, { timeZone: state.timeZone, ...opts });
const round = (n) => (n == null ? '–' : Math.round(n));

function updateClock() {
  const now = new Date();
  $('clock-time').textContent = fmt({ hour: '2-digit', minute: '2-digit' }).format(now);
  $('clock-date').textContent = fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(now);
}

function dayName(iso, i) {
  if (i === 0) return t('weather.today');
  if (i === 1) return t('weather.tomorrow');
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
}

const weatherText = (code) => (has(`weather.codes.${code}`) ? t(`weather.codes.${code}`) : t('weather.codes.unknown'));

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function loadDisplay() {
  try {
    const data = await getJson(`/api/display${previewDate ? `?date=${encodeURIComponent(previewDate)}` : ''}`);
    $('offline').hidden = true;
    // Server was restarted/updated → reload to get the new frontend.
    if (state.data && state.data.boot_id !== data.boot_id) {
      location.reload();
      return;
    }
    const prev = state.data;
    state.data = data;
    state.timeZone = data.time_zone;
    // The language is changed in the admin area; everything with text is rendered again.
    const languageChanged = data.language !== state.language;
    if (languageChanged) {
      await setLanguage(data.language);
      state.language = data.language;
      updateClock();
      renderPreviewBadge();
      if (prev) renderWeather();
    }
    applyLayout(data.layout);
    applyNav(data);
    if (languageChanged || !prev || JSON.stringify(prev.slides) !== JSON.stringify(data.slides) || JSON.stringify(prev.texts) !== JSON.stringify(data.texts)) {
      buildSlides();
    }
    if (languageChanged || !prev || JSON.stringify(prev.wifi) !== JSON.stringify(data.wifi)) renderWifi();
    if (!prev || prev.weather?.location !== data.weather?.location) loadWeather();
  } catch {
    $('offline').hidden = false;
  }
}

async function loadWeather() {
  if (!state.data?.weather) {
    state.weather = null;
    renderWeather();
    return;
  }
  try {
    state.weather = await getJson('/api/weather');
  } catch {
    // keep the last known weather
  }
  renderWeather();
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function applyLayout(layout) {
  const root = document.documentElement.style;
  root.setProperty('--accent', layout.accent_color);
  root.setProperty('--blur', `${layout.blur}px`);
  root.setProperty('--dim', String(layout.dim / 100));
  root.setProperty('--text', layout.text_color);
  // Dark text → bright glass and a white veil; light text → the classic dark look.
  const darkText = isDarkText(layout.text_color);
  document.body.dataset.tone = darkText ? 'light' : 'dark';
  // Accent for the kicker and icons (large text / graphics → 3:1), adjusted to stay readable on the glass.
  root.setProperty('--accent-text', readableOn(layout.accent_color, darkText ? '#eef0f3' : '#2b3040', 3));
  document.body.dataset.template = layout.template;

  const bg = $('bg');
  if (layout.background_url) {
    bg.style.setProperty('--bg-image', `url("${layout.background_url}")`);
    bg.classList.add('has-image');
  } else {
    bg.classList.remove('has-image');
  }

  const logo = $('brand-logo');
  if (layout.logo_url) {
    if (logo.getAttribute('src') !== layout.logo_url) logo.src = layout.logo_url;
    logo.hidden = false;
  } else {
    logo.hidden = true;
  }
}

function applyNav(data) {
  document.querySelector('.dock [data-view="weather"]').hidden = !data.weather;
  document.querySelector('.dock [data-view="wifi"]').hidden = !data.wifi;
  if ((state.view === 'weather' && !data.weather) || (state.view === 'wifi' && !data.wifi)) showView('home');
}

// ---------------------------------------------------------------------------
// Home: rotating welcome slides
// ---------------------------------------------------------------------------

function avatar(person) {
  if (person.photo_url) return h('img', { class: 'avatar', src: person.photo_url, alt: '' });
  return h('div', { class: 'avatar', style: { background: `hsl(${hue(person.name)} 45% 42% / 0.85)` }, 'aria-hidden': 'true' }, initials(person.name));
}

function slideCard(slide, index, total) {
  const people = slide.employees;
  return h('div', { class: 'card glass' },
    h('div', { class: 'stagger' },
      h('div', { class: 'kicker' }, slide.headline || t('display.welcome')),
      slide.company.logo_url ? h('img', { class: 'company-logo', src: slide.company.logo_url, alt: '' }) : null,
      h('h1', { class: 'company-name' }, slide.company.name),
      slide.message ? h('p', { class: 'message' }, slide.message) : null),
    people.length
      ? h('div', { class: `people stagger ${people.length > 6 ? 'compact' : ''}` },
        people.map((p, i) => h('div', { class: 'person', style: { animationDelay: `${0.25 + i * 0.08}s` } },
          avatar(p),
          h('div', { class: 'name' }, p.name),
          p.title ? h('div', { class: 'title' }, p.title) : null)))
      : null,
    slide.hosts?.length ? hostLine(slide.hosts) : null,
    total > 1 ? pager(index, total) : null);
}

/** Page dots; the current one fills up until the next company is shown. */
function pager(index, total) {
  return h('div', { class: 'pager', style: `--rotation: ${state.data.timing.rotation_seconds}s` },
    Array.from({ length: total }, (_, i) => h('i', { class: i === index ? 'on' : i < index ? 'done' : '' }, i === index ? h('b') : null)));
}

function hostLine(hosts) {
  const names = hosts.flatMap((name, i) => [
    i === 0 ? null : i === hosts.length - 1 ? t('display.and') : ', ',
    h('b', null, name),
  ]);
  return h('div', { class: 'host' },
    h('span', { html: NAV_ICONS.person, style: { width: '1.2rem', display: 'inline-flex' } }),
    h('span', null, t('display.hosts', { count: hosts.length }), names));
}

function idleCard(texts) {
  return h('div', { class: 'card glass idle' },
    h('div', { class: 'stagger' },
      h('h1', { class: 'company-name' }, texts.idle_title || t('display.welcome')),
      texts.site_name ? h('div', { class: 'site' }, texts.site_name) : null,
      texts.idle_text ? h('p', { class: 'message' }, texts.idle_text) : null));
}

function buildSlides() {
  clearTimeout(state.slideTimer);
  state.slides = state.data.slides;
  state.slideIndex = -1;
  const home = $('view-home');
  home.replaceChildren(h('div', { class: 'slides' }));
  nextSlide();
}

function nextSlide() {
  clearTimeout(state.slideTimer);
  const container = document.querySelector('#view-home .slides');
  const { slides } = state;
  const total = slides.length;
  state.slideIndex = total ? (state.slideIndex + 1) % total : 0;

  const card = total ? slideCard(slides[state.slideIndex], state.slideIndex, total) : idleCard(state.data.texts);
  const incoming = h('div', { class: 'slide enter' }, card);

  for (const old of container.querySelectorAll('.slide:not(.leave)')) {
    old.classList.remove('enter');
    old.classList.add('leave');
    setTimeout(() => old.remove(), 700);
  }
  container.append(incoming);

  if (total > 1) state.slideTimer = setTimeout(nextSlide, state.data.timing.rotation_seconds * 1000);
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

function renderWeather() {
  const chip = $('weather-chip');
  const view = $('view-weather');
  const w = state.weather;
  if (!w) {
    chip.hidden = true;
    view.replaceChildren(h('div', { class: 'card glass' }, h('div', { class: 'kicker' }, t('display.weather')), h('p', { class: 'message' }, t('weather.unavailable'))));
    return;
  }

  chip.hidden = false;
  chip.replaceChildren(weatherIcon(w.current.icon), h('strong', null, `${round(w.current.temperature)}°`), w.location ? h('span', { class: 'place' }, w.location) : null);

  const now = Date.now();
  const hours = w.hourly.filter((x) => new Date(x.time).getTime() >= now - 3600_000).slice(0, 8);

  view.replaceChildren(h('div', { class: 'card glass weather-card' },
    h('div', { class: 'wx-now' },
      weatherIcon(w.current.icon),
      h('div', null,
        w.location ? h('div', { class: 'wx-place' }, w.location) : null,
        h('div', { class: 'wx-temp' }, `${round(w.current.temperature)}°`),
        h('div', { class: 'wx-desc' }, weatherText(w.current.code))),
      h('div', { class: 'wx-facts' },
        h('div', null, `${t('weather.feelsLike')} `, h('b', null, `${round(w.current.apparent_temperature)}°`)),
        h('div', null, `${t('weather.humidity')} `, h('b', null, `${round(w.current.humidity)} %`)),
        h('div', null, `${t('weather.wind')} `, h('b', null, `${round(w.current.wind_speed)} km/h`)))),
    h('div', { class: 'wx-hours' }, hours.map((x) => h('div', null,
      h('div', { class: 'h' }, fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(x.time))),
      weatherIcon(x.icon),
      h('div', { class: 't' }, `${round(x.temperature)}°`),
      h('div', { class: 'p' }, x.precipitation_probability >= 20 ? `${x.precipitation_probability} %` : '')))),
    h('div', { class: 'wx-days' }, w.daily.slice(0, 5).map((d, i) => h('div', { class: 'wx-day' },
      h('div', { class: 'd' }, dayName(d.date, i)),
      weatherIcon(d.icon),
      h('div', { class: 'r' }, `${round(d.max)}°`, h('span', null, `${round(d.min)}°`)),
      h('div', { class: 'p' }, d.precipitation_probability >= 20 ? t('weather.rain', { percent: d.precipitation_probability }) : '\u00a0'))))));
}

// ---------------------------------------------------------------------------
// Wi-Fi
// ---------------------------------------------------------------------------

function renderWifi() {
  const wifi = state.data.wifi;
  const view = $('view-wifi');
  if (!wifi) {
    view.replaceChildren();
    return;
  }
  view.replaceChildren(h('div', { class: 'card glass wifi-card' },
    h('div', null,
      h('div', { class: 'kicker' }, t('display.wifiKicker')),
      h('h2', null, t('display.wifiTitle')),
      h('div', { class: 'wifi-row' }, h('div', { class: 'l' }, t('display.wifiNetwork')), h('div', { class: 'v' }, wifi.ssid)),
      wifi.password ? h('div', { class: 'wifi-row' }, h('div', { class: 'l' }, t('display.wifiPassword')), h('div', { class: 'v mono' }, wifi.password)) : null,
      wifi.note ? h('p', { class: 'wifi-note' }, wifi.note) : null),
    h('div', null,
      h('div', { class: 'qr' }, h('img', { src: `${wifi.qr_url}?v=${encodeURIComponent(wifi.ssid + wifi.password + wifi.encryption)}`, alt: t('display.wifiQrAlt') })),
      h('div', { class: 'qr-hint' }, t('display.wifiQrHint')))));
}

// ---------------------------------------------------------------------------
// Navigation & idle timeout
// ---------------------------------------------------------------------------

function showView(view) {
  state.view = view;
  for (const el of document.querySelectorAll('.view')) el.classList.toggle('active', el.id === `view-${view}`);
  for (const btn of document.querySelectorAll('.dock button')) btn.classList.toggle('active', btn.dataset.view === view);
  armHomeTimer();
}

function armHomeTimer() {
  clearTimeout(state.homeTimer);
  const bar = document.querySelector('.dock .timeout');
  bar.classList.remove('run');
  if (state.view === 'home' || !state.data) return;
  const seconds = state.data.timing.home_timeout_seconds;
  void bar.offsetWidth; // restart the CSS animation
  bar.style.animationDuration = `${seconds}s`;
  bar.classList.add('run');
  state.homeTimer = setTimeout(() => showView('home'), seconds * 1000);
}

document.querySelector('.dock').append(h('div', { class: 'timeout' }));

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-view]');
  if (target) {
    showView(target.dataset.view);
    return;
  }
  // Tapping the welcome card skips to the next company.
  if (state.view === 'home' && e.target.closest('#view-home .card') && state.slides.length > 1) nextSlide();
});

let cursorTimer;
for (const type of ['pointerdown', 'pointermove', 'keydown', 'touchstart']) {
  document.addEventListener(type, () => {
    document.body.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 3000);
    if (type !== 'pointermove') armHomeTimer();
  }, { passive: true });
}

document.addEventListener('keydown', (e) => {
  const keys = { 1: 'home', 2: 'weather', 3: 'wifi', h: 'home', w: 'weather', l: 'wifi', Escape: 'home' };
  if (keys[e.key]) showView(keys[e.key]);
  if (e.key === 'ArrowRight' && state.view === 'home') nextSlide();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function renderPreviewBadge() {
  if (!previewDate) return;
  const badge = $('preview-badge');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(previewDate)
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${previewDate}T12:00:00Z`))
    : previewDate;
  badge.textContent = t('display.previewFor', { date: day });
  badge.hidden = false;
}

updateClock();
setInterval(updateClock, 1000);
await loadDisplay();
updateClock();
setInterval(loadDisplay, REFRESH_MS);
setInterval(loadWeather, WEATHER_REFRESH_MS);
cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 3000);
