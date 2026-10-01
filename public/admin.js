// Welcome Screen admin – single page app (no build step).
import { h, append, initials, hue, contrast, plain, rich, DARK_TEXT } from './shared.js';
import { t, tNodes, has, setLanguage, language, locale } from './i18n.js';

const main = document.getElementById('app');

/** Available languages [{ code, name }], loaded on start. */
let languages = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const storage = {
  get(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } },
  set(key, value) { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* private mode */ } },
};

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = storage.get('adminToken');
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message, type = 'ok') {
  const el = h('div', { class: `toast ${type}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

/** Runs an async action with error toast; returns its result or undefined. */
async function run(fn, success) {
  try {
    const result = await fn();
    if (success) toast(success);
    return result;
  } catch (err) {
    toast(err.message, 'error');
    if (err.status === 401) render();
    return undefined;
  }
}

const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => isoLocal(new Date());
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };
const asDate = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
const fmtDate = (iso) => (iso ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(asDate(iso)) : '–');

function fmtDay(iso) {
  if (iso === today()) return t('admin.today', { date: fmtDate(iso) });
  if (iso === plusDays(1)) return t('admin.tomorrow', { date: fmtDate(iso) });
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(asDate(iso));
}

function dateRange(v) {
  return v.start_date === v.end_date ? fmtDate(v.start_date) : `${fmtDate(v.start_date)} – ${fmtDate(v.end_date)}`;
}

const initialsColor = (person) => person.avatar_color || `hsl(${hue(person.name)} 45% 32%)`;

function avatar(person, size = 42) {
  const style = { width: `${size}px`, height: `${size}px` };
  const src = person.image_url ?? person.photo_url;
  if (src) return h('img', { class: 'avatar', src, alt: '', style });
  return h('span', { class: 'avatar', style: { ...style, background: initialsColor(person), fontSize: `${size / 2.8}px` } }, initials(person.name));
}

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

function logoBox(company, cls = 'logo-box') {
  return company.logo_url
    ? h('div', { class: cls }, h('img', { src: company.logo_url, alt: '' }))
    : h('div', { class: `${cls} none` }, initials(company.name));
}

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', null, hint) : null);

/** CSS url() value; quotes, backslashes and line breaks are percent-encoded so the value cannot break out. */
const cssUrl = (src) => `url("${String(src).replace(/["\\\n]/g, encodeURIComponent)}")`;

/** Web address of an image as an alternative to uploading a file; the server downloads it ("<name>_url"). */
const imageUrlInput = (name, oninput) => h('input', { type: 'url', name, placeholder: t('common.imageUrl'), oninput });

/** Upload, URL or removal of a video ("<name>", "<name>_url", "remove_<name>") with a small looping preview. */
function videoInput(name, currentUrl) {
  const preview = h('video', { class: 'preview cover dark', muted: true, loop: true, autoplay: true, playsinline: true });
  preview.muted = true;
  const show = (src) => {
    if (src) preview.src = src;
    else { preview.removeAttribute('src'); preview.load(); }
  };
  show(currentUrl);
  const input = h('input', {
    type: 'file', name, accept: 'video/mp4,video/webm',
    onchange: () => {
      const file = input.files[0];
      if (!file) return;
      url.value = '';
      show(URL.createObjectURL(file));
    },
  });
  const url = h('input', {
    type: 'url', name: `${name}_url`, placeholder: t('admin.layouts.videoUrl'),
    oninput: () => { input.value = ''; show(url.value.trim() || currentUrl); },
  });
  const remove = currentUrl
    ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', name: `remove_${name}`, value: '1', onchange: (e) => { preview.style.opacity = e.target.checked ? 0.25 : 1; } }), t('admin.layouts.removeVideo'))
    : null;
  return h('div', { class: 'image-field' }, preview, h('div', { class: 'stack', style: { flex: 1 } }, input, url, remove));
}

function imageInput(name, currentUrl, { cover = false, dark = false } = {}) {
  const preview = h('div', { class: `preview ${cover ? 'cover' : ''} ${dark ? 'dark' : ''}`, style: { backgroundImage: currentUrl ? cssUrl(currentUrl) : 'none' } });
  const showCurrent = () => { preview.style.backgroundImage = currentUrl ? cssUrl(currentUrl) : 'none'; };
  const input = h('input', {
    type: 'file', name, accept: IMAGE_TYPES,
    onchange: () => {
      const file = input.files[0];
      if (!file) return;
      url.value = '';
      preview.style.backgroundImage = cssUrl(URL.createObjectURL(file));
    },
  });
  const url = imageUrlInput(`${name}_url`, () => {
    input.value = '';
    if (url.value.trim()) preview.style.backgroundImage = cssUrl(url.value.trim());
    else showCurrent();
  });
  const remove = currentUrl
    ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', name: `remove_${name}`, value: '1', onchange: (e) => { preview.style.opacity = e.target.checked ? 0.25 : 1; } }), t('common.remove'))
    : null;
  return h('div', { class: 'image-field' }, preview, h('div', { class: 'stack', style: { flex: 1 } }, input, url, remove));
}

/** FormData without empty file inputs (so existing images are kept). */
function formData(form) {
  const fd = new FormData(form);
  for (const [k, v] of [...fd.entries()]) {
    if (v instanceof File && !v.size) fd.delete(k);
  }
  return fd;
}

/** Shows highlighted text ("*text*") in the admin area like the active layout does: its highlight or accent color. */
async function applyHighlightStyle() {
  const active = (await api('/layouts')).find((l) => l.active);
  if (!active) return;
  const style = active.typography?.highlight ?? {};
  const root = document.documentElement.style;
  root.setProperty('--hl-color', style.color ?? active.accent_color);
  if (style.font) root.setProperty('--hl-font', `"${style.font}", "Segoe UI", system-ui, sans-serif`);
  else root.removeProperty('--hl-font');
}

/** Explains the text markup with rendered examples. */
function markupHelp() {
  const word = t('admin.markup.word');
  const example = (code, label) => h('div', { class: 'markup-example' },
    h('code', null, code),
    h('span', { class: 'faint', 'aria-hidden': 'true' }, '→'),
    h('span', { class: 'markup-result' }, rich(code)),
    label ? h('span', { class: 'faint small' }, label) : null);
  return h('div', { class: 'markup-help' },
    h('strong', null, t('admin.markup.title')),
    h('div', { class: 'markup-examples' },
      example(`*${word}*`, t('admin.markup.highlight')),
      example(`**${word}**`, t('admin.markup.bold')),
      example(`***${word}***`, t('admin.markup.both')),
      example(`~${word}~`, t('admin.markup.italic')),
      example(`~***${word}***~`, t('admin.markup.all'))),
    h('div', { class: 'markup-examples' }, example('Bright***line*** ~Systems~', t('admin.markup.example'))),
    h('small', { class: 'faint' }, t('admin.markup.note')));
}

/** A text field whose content may contain markup: shows a live preview below the input as soon as it does. */
function markupField(label, input, hint) {
  const preview = h('div', { class: 'markup-preview', hidden: true });
  const update = () => {
    preview.hidden = !/[*~]/.test(input.value);
    preview.replaceChildren();
    if (!preview.hidden) append(preview, [h('span', { class: 'faint small' }, `${t('common.preview')}: `), rich(input.value)]);
  };
  input.addEventListener('input', update);
  update();
  const el = field(label, input, hint);
  el.append(preview);
  return el;
}

function confirmDelete(what) {
  return window.confirm(t('common.confirmDelete', { what }));
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function viewLogin() {
  const input = h('input', { type: 'password', placeholder: t('admin.login.token'), autocomplete: 'current-password', required: true });
  return h('form', {
    class: 'card pad stack login',
    onsubmit: async (e) => {
      e.preventDefault();
      storage.set('adminToken', input.value.trim());
      const { authorized } = await api('/auth/check');
      if (!authorized) { toast(t('admin.login.invalid'), 'error'); storage.set('adminToken', ''); return; }
      toast(t('admin.login.success'));
      render();
    },
  },
  h('h1', null, t('admin.login.title')),
  h('p', { class: 'muted' }, t('admin.login.hint')),
  input,
  h('button', { class: 'btn', type: 'submit' }, t('admin.login.title')));
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

async function viewVisits(editId) {
  const showPast = storage.get('showPastVisits') === '1';
  const [companies, visits] = await Promise.all([
    api('/companies'),
    api(`/visits?from=${showPast ? plusDays(-180) : today()}`),
  ]);
  const editing = editId ? visits.find((v) => v.id === Number(editId)) ?? await api(`/visits/${editId}`) : null;

  const form = visitForm(companies, editing);

  const byDay = new Map();
  for (const v of visits) {
    const key = v.start_date < today() && v.end_date >= today() ? today() : v.start_date;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(v);
  }

  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', null, t('admin.visits.title')),
        h('p', null, t('admin.visits.intro'))),
      h('div', { class: 'actions' },
        h('a', { class: 'btn ghost', href: '/', target: '_blank' }, t('admin.visits.displayToday')),
        h('a', { class: 'btn ghost', href: `/?date=${plusDays(1)}`, target: '_blank' }, t('admin.visits.previewTomorrow')))),
    companies.length ? form : h('div', { class: 'empty' }, t('admin.visits.noCompanies'), h('a', { href: '#/companies' }, t('admin.visits.createCompany'))),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', null, showPast ? t('admin.visits.allVisits') : t('admin.visits.upcoming')),
        h('label', { class: 'check small muted' },
          h('input', { type: 'checkbox', checked: showPast, onchange: (e) => { storage.set('showPastVisits', e.target.checked ? '1' : ''); render(); } }),
          t('admin.visits.showPast'))),
      visits.length
        ? [...byDay.entries()].map(([day, list]) => h('div', null,
          h('div', { class: `visit-date ${day === today() ? 'today' : ''}` }, fmtDay(day)),
          h('ul', { class: 'card list' }, list.map(visitRow))))
        : h('div', { class: 'empty' }, t('admin.visits.none'))));
}

function visitRow(v) {
  return h('li', null,
    logoBox({ name: v.company_name, logo_url: v.company_logo_url }, 'visit-logo'),
    h('div', { class: 'grow' },
      h('div', null, h('strong', null, v.company_name), ' ', h('span', { class: 'pill' }, dateRange(v))),
      v.headline || v.message ? h('div', { class: 'small muted' }, [v.headline, v.message].filter(Boolean).map(plain).join(' · ')) : null,
      h('div', { class: 'chips' },
        v.employees.length
          ? v.employees.map((e) => h('span', { class: 'pill' }, e.name))
          : h('span', { class: 'pill' }, v.all_employees ? t('admin.visits.noEmployees') : t('admin.visits.companyOnly')),
        v.all_employees && v.employees.length ? h('span', { class: 'pill accent' }, t('admin.visits.all')) : null,
        v.show_avatars && v.employees.length ? h('span', { class: 'pill accent' }, t('admin.visits.withPictures')) : null,
        v.hosts.length ? h('span', { class: 'pill ok' }, t('admin.visits.hosts', { count: v.hosts.length, names: v.hosts.join(', ') })) : null)),
    h('div', { class: 'actions' },
      h('a', { class: 'btn ghost small', href: `/?date=${v.start_date < today() && v.end_date >= today() ? today() : v.start_date}`, target: '_blank' }, t('common.preview')),
      h('a', { class: 'btn ghost small', href: `#/visits/${v.id}` }, t('common.edit')),
      h('button', {
        class: 'btn danger small', type: 'button',
        onclick: async () => {
          if (!confirmDelete(t('admin.visits.deleteWhat', { company: v.company_name }))) return;
          if (await run(() => api(`/visits/${v.id}`, { method: 'DELETE' }), t('admin.visits.deleted'))) render();
        },
      }, t('common.delete'))));
}

/** Editable list of in-house contacts: one input per person, plus add/remove buttons. */
function hostList(initial) {
  const list = h('div', { class: 'host-list' });
  const add = h('button', { class: 'btn ghost small', type: 'button', onclick: () => addRow('', true) }, t('admin.visits.addHost'));

  function addRow(value, focus) {
    const input = h('input', { placeholder: t('admin.visits.hostPlaceholder'), value, maxlength: 200 });
    const row = h('div', { class: 'host-row' }, input,
      h('button', {
        class: 'btn ghost small', type: 'button', title: t('common.remove'), 'aria-label': t('admin.visits.removeHost'),
        onclick: () => { row.remove(); if (!list.children.length) addRow(''); sync(); },
      }, '×'));
    list.append(row);
    sync();
    if (focus) input.focus();
  }

  const sync = () => { add.disabled = list.children.length >= 10; };

  (initial.length ? initial : ['']).forEach((name) => addRow(name));
  return {
    el: h('div', { class: 'stack' }, list, h('div', null, add)),
    values: () => [...list.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean),
  };
}

/**
 * Employees of a visit: all / a selection / none, in an order that can be changed by drag and drop
 * (default: alphabetical). The order is kept for "all" as well.
 */
function employeePicker(companySel, editing) {
  let mode = !editing ? 'all' : editing.all_employees ? 'all' : editing.employees.length ? 'selected' : 'none';
  let employees = [];
  const selected = new Set(editing && !editing.all_employees ? editing.employees.map((e) => e.id) : []);
  const list = h('ol', { class: 'emp-order' });
  const info = h('div', { class: 'faint small' });
  const sortButton = h('button', {
    class: 'btn ghost small', type: 'button',
    onclick: () => { employees.sort(byName); draw(); },
  }, t('admin.visits.sortAlphabetically'));

  const byName = (a, b) => a.name.localeCompare(b.name, locale);
  const modes = h('div', { class: 'actions' }, ['all', 'selected', 'none'].map((m) => h('label', { class: 'check' },
    h('input', { type: 'radio', name: 'employee_mode', value: m, checked: m === mode, onchange: () => { mode = m; draw(); } }),
    t(`admin.visits.mode.${m}`))));

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= employees.length) return;
    [employees[index], employees[target]] = [employees[target], employees[index]];
    draw();
    list.children[target]?.querySelector(delta < 0 ? '.up' : '.down')?.focus();
  }

  // Drag and drop with pointer events (works with mouse and touch, unlike HTML5 drag and drop).
  let dragging = null;
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (!li || e.button !== 0 || e.target.closest('input, button')) return;
    e.preventDefault();
    dragging = li;
    li.classList.add('dragging');
    list.setPointerCapture(e.pointerId);
  });
  list.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const next = [...list.children].find((x) => {
      if (x === dragging) return false;
      const r = x.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    }) ?? null;
    if (dragging.nextElementSibling !== next) list.insertBefore(dragging, next);
  });
  const drop = () => {
    if (!dragging) return;
    dragging = null;
    const byId = new Map(employees.map((x) => [x.id, x]));
    employees = [...list.children].map((x) => byId.get(Number(x.dataset.id)));
    draw();
  };
  list.addEventListener('pointerup', drop);
  list.addEventListener('pointercancel', drop);

  function draw() {
    list.replaceChildren();
    sortButton.hidden = mode === 'none' || employees.length < 2;
    list.hidden = mode === 'none' || !employees.length;
    if (!companySel.value) {
      info.replaceChildren(t('admin.visits.selectCompanyFirst'));
      return;
    }
    if (mode === 'none') {
      info.replaceChildren(t('admin.visits.companyOnlyHint'));
      return;
    }
    if (!employees.length) {
      info.replaceChildren(t('admin.visits.noEmployeesForCompany'), h('a', { href: `#/company/${companySel.value}` }, t('admin.visits.addEmployees')));
      return;
    }
    info.replaceChildren(t('admin.visits.orderHint'));
    employees.forEach((emp, i) => {
      const li = h('li', { class: 'emp-item' },
        h('span', { class: 'grip', 'aria-hidden': 'true' }, '⠿'),
        h('input', {
          type: 'checkbox', checked: mode === 'all' || selected.has(emp.id), disabled: mode === 'all', 'aria-label': emp.name,
          onchange: (ev) => { ev.target.checked ? selected.add(emp.id) : selected.delete(emp.id); },
        }),
        avatar(emp, 28),
        h('span', { class: 'grow' }, emp.name, emp.title ? h('span', { class: 'faint small' }, ` · ${emp.title}`) : null),
        h('button', { class: 'btn ghost small up', type: 'button', title: t('admin.visits.moveUp'), 'aria-label': t('admin.visits.moveUp'), disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        h('button', { class: 'btn ghost small down', type: 'button', title: t('admin.visits.moveDown'), 'aria-label': t('admin.visits.moveDown'), disabled: i === employees.length - 1, onclick: () => move(i, 1) }, '↓'));
      li.dataset.id = emp.id;
      list.append(li);
    });
  }

  async function load() {
    employees = [];
    if (companySel.value) {
      const all = await api(`/employees?company=${companySel.value}`);
      // Saved order first (only for the company of the edited visit), the rest alphabetically.
      const saved = editing?.company_id === Number(companySel.value) ? editing.employees.map((e) => e.id) : [];
      const pos = new Map(saved.map((id, i) => [id, i]));
      employees = all.sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity) || byName(a, b));
    }
    draw();
  }

  companySel.addEventListener('change', () => { selected.clear(); load(); });
  load();

  return {
    el: h('div', { class: 'stack' }, modes, info, list, h('div', null, sortButton)),
    /** { all_employees, employees } for the API, or null if the selection is empty. */
    values() {
      const ids = employees.map((e) => e.id);
      if (mode === 'all') return { all_employees: true, employees: ids };
      if (mode === 'none') return { all_employees: false, employees: [] };
      const chosen = ids.filter((id) => selected.has(id));
      return chosen.length ? { all_employees: false, employees: chosen } : null;
    },
  };
}

function visitForm(companies, editing) {
  const companySel = h('select', { name: 'company', required: true },
    h('option', { value: '' }, t('admin.visits.selectCompany')),
    companies.map((c) => h('option', { value: c.id, selected: editing?.company_id === c.id }, c.name)));
  const start = h('input', { type: 'date', name: 'start_date', required: true, value: editing?.start_date ?? plusDays(1) });
  const end = h('input', { type: 'date', name: 'end_date', value: editing && editing.end_date !== editing.start_date ? editing.end_date : '' });
  const headline = h('input', { name: 'headline', placeholder: t('admin.visits.headlinePlaceholder', { welcome: t('display.welcome') }), value: editing?.headline ?? '' });
  const message = h('textarea', { name: 'message', placeholder: t('admin.visits.messagePlaceholder') }, editing?.message ?? '');
  const hosts = hostList(editing?.hosts ?? []);
  const picker = employeePicker(companySel, editing);
  const showAvatars = h('input', { type: 'checkbox', checked: editing?.show_avatars ?? false });

  const quick = (label, days) => h('button', { class: 'btn ghost small', type: 'button', onclick: () => { start.value = plusDays(days); end.value = ''; } }, label);

  return h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const people = picker.values();
      if (!people) { toast(t('admin.visits.selectEmployee'), 'error'); return; }
      const body = {
        company: Number(companySel.value),
        start_date: start.value,
        end_date: end.value || start.value,
        headline: headline.value,
        message: message.value,
        hosts: hosts.values(),
        show_avatars: showAvatars.checked,
        ...people,
      };
      const saved = editing
        ? await run(() => api(`/visits/${editing.id}`, { method: 'PATCH', body }), t('admin.visits.saved'))
        : await run(() => api('/visits', { method: 'POST', body }), t('admin.visits.scheduled'));
      if (saved) { location.hash = '#/visits'; render(); }
    },
  },
  h('h2', null, editing ? t('admin.visits.editTitle', { company: editing.company_name }) : t('admin.visits.newTitle')),
  h('div', { class: 'row' },
    field(t('admin.visits.company'), companySel),
    field(t('admin.visits.date'), start),
    field(t('admin.visits.until'), end),
    h('div', { class: 'actions', style: { paddingBottom: '4px' } },
      quick(t('admin.visits.quickToday'), 0), quick(t('admin.visits.quickTomorrow'), 1), quick(t('admin.visits.quickDayAfter'), 2))),
  h('div', { class: 'field' },
    h('span', null, t('admin.visits.shownEmployees')),
    picker.el,
    h('label', { class: 'check' }, showAvatars, t('admin.visits.showAvatars')),
    h('small', null, t('admin.visits.showAvatarsHint'))),
  h('div', { class: 'row top' }, markupField(t('admin.visits.headline'), headline), h('div', { class: 'field' }, h('span', null, t('admin.visits.hostsLabel')), hosts.el)),
  markupField(t('admin.visits.message'), message),
  markupHelp(),
  h('div', { class: 'actions' },
    h('button', { class: 'btn', type: 'submit' }, editing ? t('common.save') : t('admin.visits.schedule')),
    editing ? h('a', { class: 'btn ghost', href: '#/visits' }, t('common.cancel')) : null));
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

/** Pool of default pictures that employees can pick instead of an own photo. */
function avatarPool(pool) {
  const form = h('form', {
    class: 'row',
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = formData(form);
      if (!fd.get('image') && !fd.get('image_url')) { toast(t('admin.avatars.imageRequired'), 'error'); return; }
      if (await run(() => api('/avatars', { method: 'POST', form: fd }), t('admin.avatars.added'))) render();
    },
  },
  field(t('admin.avatars.name'), h('input', { name: 'name', maxlength: 80, placeholder: t('admin.avatars.namePlaceholder') })),
  field(t('admin.avatars.image'), h('input', { type: 'file', name: 'image', accept: IMAGE_TYPES })),
  field(t('admin.avatars.imageUrl'), imageUrlInput('image_url')),
  h('button', { class: 'btn ghost', type: 'submit' }, t('common.add')));

  return h('section', { class: 'section card pad stack' },
    h('h2', null, t('admin.avatars.title')),
    h('p', { class: 'muted small', style: { margin: 0 } }, t('admin.avatars.intro')),
    pool.length
      ? h('div', { class: 'pool' }, pool.map((a) => h('div', { class: 'pool-item' },
        h('img', { src: a.image_url, alt: '' }),
        h('strong', null, a.name),
        h('span', { class: 'faint small' }, t('admin.avatars.used', { count: a.employee_count })),
        h('button', {
          class: 'btn danger small', type: 'button',
          onclick: async () => {
            if (!confirmDelete(t('admin.avatars.deleteWhat', { name: a.name }))) return;
            if (await run(() => api(`/avatars/${a.id}`, { method: 'DELETE' }), t('admin.avatars.deleted'))) render();
          },
        }, t('common.delete')))))
      : h('div', { class: 'empty' }, t('admin.avatars.none')),
    form);
}

/**
 * Picture of an employee: initials (with an optional own background color), a picture from the pool or an own photo.
 * `nameOf` returns the current name for the initials preview. apply(fd) writes the choice into the FormData.
 */
function avatarPicker(pool, emp, nameOf) {
  let choice = emp?.photo_url ? 'photo' : emp?.avatar_id ? `pool:${emp.avatar_id}` : 'initials';
  let photoUrl = emp?.photo_url ?? null;
  const options = h('div', { class: 'av-options', role: 'radiogroup', 'aria-label': t('admin.companies.picture') });
  const file = h('input', {
    type: 'file', accept: IMAGE_TYPES, hidden: true,
    onchange: () => {
      if (!file.files[0]) return;
      url.value = '';
      photoUrl = URL.createObjectURL(file.files[0]);
      choice = 'photo';
      draw();
    },
  });
  const url = imageUrlInput(null, () => {
    file.value = '';
    photoUrl = url.value.trim() || emp?.photo_url || null;
    choice = photoUrl ? 'photo' : 'initials';
    draw();
  });
  const colorOn = h('input', { type: 'checkbox', checked: Boolean(emp?.avatar_color), onchange: () => draw() });
  const color = h('input', { type: 'color', value: emp?.avatar_color ?? '#2f6fd0', style: { width: '4.5rem' }, oninput: () => { colorOn.checked = true; draw(); } });

  const option = (key, label, content) => h('button', {
    class: `av-opt ${choice === key ? 'selected' : ''}`, type: 'button', title: label, role: 'radio', 'aria-checked': String(choice === key),
    onclick: () => { choice = key; draw(); },
  }, content, h('span', null, label));

  function draw() {
    const name = nameOf() || '?';
    options.replaceChildren();
    append(options, [
      option('initials', t('admin.companies.initials'),
        h('span', { class: 'avatar', style: { background: colorOn.checked ? color.value : `hsl(${hue(name)} 45% 32%)` } }, initials(name))),
      pool.map((a) => option(`pool:${a.id}`, a.name, h('img', { class: 'avatar', src: a.image_url, alt: '' }))),
      photoUrl
        ? option('photo', t('admin.companies.ownPhoto'), h('img', { class: 'avatar', src: photoUrl, alt: '' }))
        : null,
      h('button', { class: 'av-opt upload', type: 'button', onclick: () => file.click() },
        h('span', { class: 'avatar' }, '+'), h('span', null, photoUrl ? t('admin.companies.otherPhoto') : t('admin.companies.uploadPhoto')))]);
  }
  draw();

  return {
    el: h('div', { class: 'stack' },
      options, file, url,
      h('div', { class: 'actions small' }, h('label', { class: 'check' }, colorOn, t('admin.companies.initialsColor')), color)),
    redraw: draw,
    apply(fd) {
      fd.delete('photo');
      const hadPhoto = Boolean(emp?.photo_url);
      if (choice === 'photo') {
        if (file.files[0]) fd.set('photo', file.files[0]);
        else if (url.value.trim()) fd.set('photo_url', url.value.trim());
        fd.set('avatar_id', '');
      } else {
        fd.set('avatar_id', choice.startsWith('pool:') ? choice.slice(5) : '');
        if (hadPhoto) fd.set('remove_photo', '1');
      }
      fd.set('avatar_color', colorOn.checked ? color.value : '');
      return fd;
    },
  };
}

async function viewCompanies() {
  const [companies, pool] = await Promise.all([api('/companies'), api('/avatars')]);
  const form = h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const created = await run(() => api('/companies', { method: 'POST', form: formData(form) }), t('admin.companies.created'));
      if (created) location.hash = `#/company/${created.id}`;
    },
  },
  h('h2', null, t('admin.companies.new')),
  h('div', { class: 'row top' },
    field(t('admin.companies.name'), h('input', { name: 'name', required: true, placeholder: t('admin.companies.namePlaceholder') })),
    field(t('admin.companies.logo'), imageInput('logo', null))),
  h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'submit' }, t('common.create'))));

  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('admin.companies.title')), h('p', null, t('admin.companies.intro')))),
    form,
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, t('admin.companies.count', { count: companies.length }))),
      companies.length
        ? h('div', { class: 'grid grid-cards' }, companies.map((c) => h('a', { class: 'card company-card', href: `#/company/${c.id}` },
          logoBox(c),
          h('div', { class: 'name' }, c.name),
          h('div', { class: 'small muted' },
            t('admin.companies.employeeCount', { count: c.employee_count }),
            c.next_visit ? t('admin.companies.nextVisit', { date: fmtDate(c.next_visit) }) : ''))))
        : h('div', { class: 'empty' }, t('admin.companies.none'))),
    avatarPool(pool));
}

async function viewCompany(id) {
  const [company, pool] = await Promise.all([api(`/companies/${id}`), api('/avatars')]);

  const form = h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      if (await run(() => api(`/companies/${company.id}`, { method: 'PATCH', form: formData(form) }), t('admin.companies.saved'))) render();
    },
  },
  h('h2', null, t('admin.companies.company')),
  h('div', { class: 'row top' },
    field(t('admin.companies.name'), h('input', { name: 'name', required: true, value: company.name })),
    field(t('admin.companies.logo'), imageInput('logo', company.logo_url), t('admin.companies.logoHint'))),
  field(t('admin.companies.note'), h('textarea', { name: 'note' }, company.note ?? '')),
  h('div', { class: 'actions' },
    h('button', { class: 'btn', type: 'submit' }, t('common.save')),
    h('a', { class: 'btn ghost', href: `#/visits` }, t('admin.companies.scheduleVisit')),
    h('button', {
      class: 'btn danger', type: 'button',
      onclick: async () => {
        if (!confirmDelete(t('admin.companies.deleteWhat', { name: company.name }))) return;
        if (await run(() => api(`/companies/${company.id}`, { method: 'DELETE' }), t('admin.companies.deleted'))) location.hash = '#/companies';
      },
    }, t('admin.companies.delete'))));

  const newName = h('input', { name: 'name', required: true, oninput: () => newPicture.redraw() });
  const newPicture = avatarPicker(pool, null, () => newName.value);
  const addForm = h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = newPicture.apply(formData(addForm));
      fd.set('company', company.id);
      if (await run(() => api('/employees', { method: 'POST', form: fd }), t('admin.companies.employeeCreated'))) render();
    },
  },
  h('h3', null, t('admin.companies.addEmployee')),
  h('div', { class: 'row' },
    field(t('admin.companies.name'), newName),
    field(t('admin.companies.position'), h('input', { name: 'title', placeholder: t('common.optional') }))),
  h('div', { class: 'field' }, h('span', null, t('admin.companies.picture')), newPicture.el),
  h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'submit' }, t('common.add'))));

  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null, h('a', { href: '#/companies', class: 'small' }, t('admin.companies.back')), h('h1', null, company.name))),
    h('div', { class: 'grid grid-2' }, form, addForm),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, t('admin.companies.employees', { count: company.employees.length }))),
      company.employees.length
        ? h('ul', { class: 'card list' }, company.employees.map((emp) => employeeRow(emp, pool)))
        : h('div', { class: 'empty' }, t('admin.companies.noEmployees'))),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, t('admin.companies.upcoming'))),
      company.upcoming_visits.length
        ? h('ul', { class: 'card list' }, company.upcoming_visits.map(visitRow))
        : h('div', { class: 'empty' }, t('admin.companies.noVisits'), h('a', { href: '#/visits' }, t('admin.companies.scheduleVisit')))));
}

function employeeRow(emp, pool) {
  const li = h('li', null);
  const show = () => li.replaceChildren(
    avatar(emp),
    h('div', { class: 'grow' }, h('strong', null, emp.name), emp.title ? h('div', { class: 'small muted' }, emp.title) : null),
    h('div', { class: 'actions' },
      h('button', { class: 'btn ghost small', type: 'button', onclick: edit }, t('common.edit')),
      h('button', {
        class: 'btn danger small', type: 'button',
        onclick: async () => {
          if (!confirmDelete(emp.name)) return;
          if (await run(() => api(`/employees/${emp.id}`, { method: 'DELETE' }), t('admin.companies.employeeDeleted'))) render();
        },
      }, t('common.delete'))));
  const edit = () => {
    const name = h('input', { name: 'name', required: true, value: emp.name, oninput: () => picture.redraw() });
    const picture = avatarPicker(pool, emp, () => name.value);
    const form = h('form', {
      class: 'grow stack',
      onsubmit: async (e) => {
        e.preventDefault();
        if (await run(() => api(`/employees/${emp.id}`, { method: 'PATCH', form: picture.apply(formData(form)) }), t('common.saved'))) render();
      },
    },
    h('div', { class: 'row' },
      field(t('admin.companies.name'), name),
      field(t('admin.companies.position'), h('input', { name: 'title', value: emp.title ?? '' }))),
    h('div', { class: 'field' }, h('span', null, t('admin.companies.picture')), picture.el),
    h('div', { class: 'actions' },
      h('button', { class: 'btn small', type: 'submit' }, t('common.save')),
      h('button', { class: 'btn ghost small', type: 'button', onclick: show }, t('common.cancel'))));
    li.replaceChildren(avatar(emp), form);
  };
  show();
  return li;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function previewFrame(src) {
  const iframe = h('iframe', { src, title: t('common.preview'), tabindex: '-1' });
  const frame = h('div', { class: 'preview-frame' }, iframe);
  const fit = () => { iframe.style.transform = `scale(${frame.clientWidth / 1920})`; };
  new ResizeObserver(fit).observe(frame);
  return { frame, reload: () => iframe.contentWindow?.location.reload() };
}

/** Average color (#rrggbb) of an image, used to judge text contrast. */
async function averageColor(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = h('canvas', { width: 64, height: 36 });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 64, 36);
  const data = ctx.getImageData(0, 0, 64, 36).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  return `#${sum.map((v) => Math.round(v / (data.length / 4)).toString(16).padStart(2, '0')).join('')}`;
}

/** Text color picker that rates the contrast against the background image and can suggest a color. */
function textColorField(layout, form) {
  const input = h('input', { type: 'color', name: 'text_color', value: layout.text_color, style: { width: '4.5rem' }, oninput: () => rate() });
  const hint = h('small');
  let background = null;

  function rate() {
    if (!background) {
      hint.textContent = t('admin.layouts.noBackground');
      return;
    }
    const ratio = contrast(input.value, background);
    const verdict = t(ratio >= 4.5 ? 'admin.layouts.verdictGood' : ratio >= 3 ? 'admin.layouts.verdictLow' : 'admin.layouts.verdictBad');
    hint.textContent = t('admin.layouts.contrast', { ratio: ratio.toLocaleString(locale, { maximumFractionDigits: 1 }), verdict });
  }

  async function analyze() {
    const file = form.querySelector('input[name="background"]')?.files[0];
    const removed = form.querySelector('input[name="remove_background"]')?.checked;
    const src = file ? URL.createObjectURL(file) : removed ? null : layout.background_url;
    try {
      background = src ? await averageColor(src) : null;
    } catch {
      background = null;
    }
    rate();
  }

  const suggest = h('button', {
    class: 'btn ghost small', type: 'button',
    onclick: () => {
      input.value = !background || contrast('#ffffff', background) >= contrast(DARK_TEXT, background) ? '#ffffff' : DARK_TEXT;
      rate();
    },
  }, t('admin.layouts.suggest'));

  form.addEventListener('change', (e) => {
    if (['background', 'remove_background'].includes(e.target.name)) analyze();
  });
  analyze();
  return h('div', { class: 'field' }, h('span', null, t('admin.layouts.textColor')), h('div', { class: 'actions' }, input, suggest), hint);
}

/** Range input with its current value shown next to the label. */
function slider(label, name, value, { min, max, step = 1, unit, hint }) {
  const out = h('span', { class: 'faint' });
  const input = h('input', { type: 'range', name, min, max, step, value, oninput: () => { out.textContent = `${input.value}${unit}`; } });
  out.textContent = `${value}${unit}`;
  return h('label', { class: 'field' }, h('span', null, `${label} `, out), input, hint ? h('small', null, hint) : null);
}

/** Fonts that are usually installed on Windows/macOS/Linux devices, offered in addition to the shipped ones. */
const SYSTEM_FONTS = ['Segoe UI', 'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New'];

/** Table with font, size and color per text element of the display. value() returns the typography object. */
function typographyEditor(layout, meta) {
  const listId = `font-list-${layout.id}`;
  const rows = Object.keys(meta.elements).map((key) => {
    const cur = layout.typography?.[key] ?? {};
    const font = h('input', {
      list: listId, value: cur.font ?? '', maxlength: 80, placeholder: t('admin.layouts.fontDefault'), 'aria-label': t('admin.layouts.font'),
      oninput: () => { font.style.fontFamily = font.value ? `"${font.value}", sans-serif` : ''; },
    });
    if (cur.font) font.style.fontFamily = `"${cur.font}", sans-serif`;
    const size = h('input', { type: 'number', min: 25, max: 400, step: 5, value: cur.size ?? '', placeholder: '100', 'aria-label': t('admin.layouts.size') });
    const colorOn = h('input', { type: 'checkbox', checked: Boolean(cur.color), 'aria-label': t('admin.layouts.ownColor') });
    const color = h('input', { type: 'color', value: cur.color ?? (key === 'highlight' ? layout.accent_color : layout.text_color), 'aria-label': t('admin.layouts.color'), oninput: () => { colorOn.checked = true; } });
    const tr = h('tr', null,
      h('th', { scope: 'row' }, t(`textElements.${key}`), ['weather', 'wifi', 'dock', 'base', 'highlight'].includes(key) ? h('div', { class: 'faint small' }, t(`admin.layouts.sizeHint.${key}`)) : null),
      h('td', null, font),
      h('td', null, h('div', { class: 'size-cell' }, size, h('span', { class: 'faint' }, '%'))),
      h('td', null, key === 'base' ? h('span', { class: 'faint small' }, t('admin.layouts.baseColorHint')) : h('div', { class: 'actions' }, colorOn, color)));
    return {
      tr,
      reset: () => { font.value = ''; font.style.fontFamily = ''; size.value = ''; colorOn.checked = false; },
      value: () => [key, { font: font.value.trim(), size: size.value, color: key !== 'base' && colorOn.checked ? color.value : '' }],
    };
  });

  const el = h('details', { class: 'typo', open: Object.keys(layout.typography ?? {}).length > 0 },
    h('summary', null, t('admin.layouts.typography')),
    h('p', { class: 'muted small' }, t('admin.layouts.typographyHint')),
    h('div', { class: 'typo-scroll' },
      h('table', { class: 'typo-table' },
        h('thead', null, h('tr', null,
          h('th', null, t('admin.layouts.element')), h('th', null, t('admin.layouts.font')), h('th', null, t('admin.layouts.size')), h('th', null, t('admin.layouts.color')))),
        h('tbody', null, rows.map((r) => r.tr)))),
    h('datalist', { id: listId }, [...meta.fonts, ...SYSTEM_FONTS].map((f) => h('option', { value: f }))),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => rows.forEach((r) => r.reset()) }, t('admin.layouts.resetTypography'))));

  return {
    el,
    value: () => Object.fromEntries(rows.map((r) => r.value()).filter(([, v]) => v.font || v.size || v.color)),
  };
}

/** Form with all parameters of one layout. */
function layoutForm(layout, templates, typographyMeta) {
  const typography = typographyEditor(layout, typographyMeta);

  const form = h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = formData(form);
      fd.set('typography', JSON.stringify(typography.value()));
      if (await run(() => api(`/layouts/${layout.id}`, { method: 'PATCH', form: fd }), t('admin.layouts.saved'))) render();
    },
  },
  // Actions for the layout as a whole live in the header; saving the fields stays at the bottom (always visible).
  h('div', { class: 'section-head' },
    h('h2', null, t('admin.layouts.heading', { name: layout.name })),
    h('div', { class: 'actions' },
      layout.active ? h('span', { class: 'pill ok' }, t('admin.layouts.active')) : h('button', {
        class: 'btn ghost small', type: 'button',
        onclick: async () => { if (await run(() => api(`/layouts/${layout.id}/activate`, { method: 'POST' }), t('admin.layouts.activated'))) render(); },
      }, t('admin.layouts.activate')),
      h('button', {
        class: 'btn ghost small', type: 'button', title: t('admin.layouts.copyHint'),
        onclick: async () => {
          const copy = await run(() => api(`/layouts/${layout.id}/copy`, { method: 'POST', body: {} }));
          if (!copy) return;
          toast(t('admin.layouts.copied', { name: copy.name }));
          // The copy is not active, so it opens on the right.
          if (location.hash === `#/layouts/${copy.id}`) render();
          else location.hash = `#/layouts/${copy.id}`;
        },
      }, t('admin.layouts.copy')),
      layout.active ? null : h('button', {
        class: 'btn danger small', type: 'button',
        onclick: async () => {
          if (!confirmDelete(t('admin.layouts.deleteWhat', { name: layout.name }))) return;
          if (await run(() => api(`/layouts/${layout.id}`, { method: 'DELETE' }), t('admin.layouts.deleted'))) { location.hash = '#/layouts'; render(); }
        },
      }, t('common.delete')))),
  h('div', { class: 'row top' },
    field(t('admin.layouts.name'), h('input', { name: 'name', required: true, maxlength: 80, value: layout.name }), t('admin.layouts.nameHint')),
    field(t('admin.layouts.template'), h('select', { name: 'template' },
      Object.entries(templates).map(([key, label]) => h('option', { value: key, selected: key === layout.template }, has(`admin.layouts.templates.${key}`) ? t(`admin.layouts.templates.${key}`) : label))))),
  field(t('admin.layouts.background'), imageInput('background', layout.background_url, { cover: true, dark: true }), t('admin.layouts.backgroundHint')),
  field(t('admin.layouts.backgroundVideo'), videoInput('background_video', layout.background_video_url), t('admin.layouts.backgroundVideoHint')),
  field(t('admin.layouts.logo'), imageInput('logo', layout.logo_url, { dark: true }), t('admin.layouts.logoHint')),
  h('div', { class: 'row top' },
    slider(t('admin.layouts.logoSize'), 'logo_size', layout.logo_size, { min: 20, max: 400, step: 5, unit: ' %' }),
    slider(t('admin.layouts.companyLogoSize'), 'company_logo_size', layout.company_logo_size, { min: 30, max: 300, step: 5, unit: ' %', hint: t('admin.layouts.companyLogoSizeHint') }),
    slider(t('admin.layouts.tileGap'), 'tile_gap', layout.tile_gap, { min: 0, max: 200, unit: ' px', hint: t('admin.layouts.gapHint') }),
    slider(t('admin.layouts.footerGap'), 'footer_gap', layout.footer_gap, { min: 0, max: 200, unit: ' px', hint: t('admin.layouts.footerGapHint') })),
  h('div', { class: 'row top' },
    field(t('admin.layouts.accent'), h('input', { type: 'color', name: 'accent_color', value: layout.accent_color })),
    slider(t('admin.layouts.blur'), 'blur', layout.blur, { min: 0, max: 60, unit: 'px' }),
    slider(t('admin.layouts.dim'), 'dim', layout.dim, { min: 0, max: 90, unit: ' %', hint: t('admin.layouts.dimHint') })),
  h('div', { class: 'actions sticky-actions' },
    h('button', { class: 'btn', type: 'submit' }, t('admin.layouts.saveLayout', { name: layout.name }))));
  // Needs the form to watch the background image input.
  form.insertBefore(textColorField(layout, form), form.querySelector(':scope > .actions'));
  form.insertBefore(typography.el, form.querySelector(':scope > .actions'));
  return form;
}

/** Card with the live preview of a layout (the display itself, scaled down). */
function layoutPreview(layout) {
  const preview = previewFrame(layout.active ? '/' : `/?layout=${layout.id}`);
  return h('div', { class: 'card pad stack' },
    h('div', { class: 'section-head' },
      h('h3', null, t('admin.layouts.previewOf', { name: layout.name })),
      h('div', { class: 'actions' },
        h('a', { class: 'btn ghost small', href: layout.active ? '/' : `/?layout=${layout.id}`, target: '_blank', rel: 'noopener' }, t('admin.layouts.openPreview')),
        h('button', { class: 'btn ghost small', type: 'button', onclick: preview.reload }, t('admin.layouts.reload')))),
    preview.frame);
}

/**
 * Left: the active layout. Right: one of the other layouts, chosen from the list – it can be adjusted and previewed
 * without touching the active one. Each side shows the preview above the parameters.
 */
async function viewLayouts(id) {
  const [layouts, templates, typographyMeta] = await Promise.all([api('/layouts'), api('/layouts/templates'), api('/layouts/typography')]);
  const active = layouts.find((l) => l.active) ?? layouts[0];
  const others = layouts.filter((l) => l.id !== active.id);
  // The other layout from the address, else the one chosen last, else the first one.
  const other = others.find((l) => l.id === Number(id)) ?? others.find((l) => l.id === Number(storage.get('otherLayout'))) ?? others[0];
  if (other) storage.set('otherLayout', String(other.id));

  const newForm = h('form', {
    class: 'row',
    onsubmit: async (e) => {
      e.preventDefault();
      const created = await run(() => api('/layouts', { method: 'POST', form: formData(newForm) }), t('admin.layouts.created'));
      if (created) location.hash = `#/layouts/${created.id}`;
    },
  },
  field(t('admin.layouts.new'), h('input', { name: 'name', required: true, maxlength: 80, placeholder: t('admin.layouts.newPlaceholder') })),
  h('button', { class: 'btn ghost', type: 'submit' }, t('common.create')));

  const cell = (column, row, el) => { el.classList.add(`cmp-${column}${row}`); return el; };

  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, t('admin.layouts.title')), h('p', null, t('admin.layouts.intro')))),
    h('div', { class: 'layout-compare' },
      cell('a', 1, h('div', { class: 'card pad stack' },
        h('div', { class: 'section-head' }, h('h2', null, t('admin.layouts.activeLayout')), h('span', { class: 'pill ok' }, `${active.name} ✓`)),
        h('p', { class: 'muted small', style: { margin: 0 } }, t('admin.layouts.activeHint')))),
      cell('a', 2, layoutPreview(active)),
      cell('a', 3, layoutForm(active, templates, typographyMeta)),

      cell('b', 1, h('div', { class: 'card pad stack' },
        h('h2', null, t('admin.layouts.otherLayout')),
        others.length
          ? h('div', { class: 'chips' }, others.map((l) => h('a', { class: `pill ${l.id === other.id ? 'accent' : ''}`, href: `#/layouts/${l.id}` }, l.name)))
          : null,
        h('p', { class: 'muted small', style: { margin: 0 } }, others.length ? t('admin.layouts.otherHint') : t('admin.layouts.noOther')),
        newForm)),
      other ? cell('b', 2, layoutPreview(other)) : null,
      other ? cell('b', 3, layoutForm(other, templates, typographyMeta)) : null));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function viewSettings() {
  const [values, schema] = await Promise.all([api('/settings'), api('/settings/schema')]);

  const optionLabel = (key, value) => {
    if (key === 'language') return languages.find((l) => l.code === value)?.name ?? value;
    if (key === 'wifi_encryption') return t(`admin.settings.encryption.${value}`);
    return value;
  };

  const input = (key, attrs = {}) => {
    const def = schema[key];
    const label = t(`settings.${key}`);
    if (def.type === 'bool') return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: key, checked: values[key] }), label);
    if (def.type === 'enum') return field(label, h('select', { name: key }, def.values.map((v) => h('option', { value: v, selected: v === values[key] }, optionLabel(key, v)))));
    if (def.type === 'int') return field(label, h('input', { type: 'number', name: key, min: def.min, max: def.max, value: values[key], required: true, ...attrs }));
    if (key === 'idle_text') return markupField(label, h('textarea', { name: key }, values[key] ?? ''));
    if (key === 'wifi_note') return field(label, h('textarea', { name: key }, values[key] ?? ''));
    // Empty greeting texts use the default text of the selected language.
    if (key === 'welcome_prefix' || key === 'idle_title') {
      return markupField(label, h('input', { name: key, value: values[key] ?? '', placeholder: t('display.welcome'), ...attrs }), t('admin.settings.defaultTextHint'));
    }
    if (key === 'site_name') return markupField(label, h('input', { name: key, value: values[key] ?? '', ...attrs }));
    return field(label, h('input', { name: key, value: values[key] ?? '', ...attrs }));
  };

  function settingsForm(title, keys, extra) {
    const form = h('form', {
      class: 'card pad stack',
      onsubmit: async (e) => {
        e.preventDefault();
        const body = {};
        for (const key of keys) {
          const el = form.elements[key];
          body[key] = schema[key].type === 'bool' ? el.checked : el.value;
        }
        const saved = await run(() => api('/settings', { method: 'PATCH', body }));
        if (!saved) return;
        if (saved.language !== language) await setLanguage(saved.language);
        toast(t('admin.settings.saved'));
        render();
      },
    },
    h('h2', null, title),
    extra?.before,
    keys.map((k) => input(k)),
    extra?.after,
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'submit' }, t('common.save'))));
    return form;
  }

  // Weather: place search fills name + coordinates.
  const results = h('div', { class: 'geo-results' });
  const search = h('input', { type: 'search', placeholder: t('admin.settings.searchPlaceholder') });
  let weatherForm;
  const doSearch = async () => {
    const found = await run(() => api(`/geocode?q=${encodeURIComponent(search.value)}`));
    if (!found) return;
    results.replaceChildren(...(found.length ? found.map((r) => h('button', {
      class: 'btn ghost small', type: 'button',
      onclick: () => {
        weatherForm.elements.weather_location_name.value = r.name;
        weatherForm.elements.weather_latitude.value = r.latitude;
        weatherForm.elements.weather_longitude.value = r.longitude;
        results.replaceChildren();
      },
    }, `${r.name} – ${r.region}`)) : [h('span', { class: 'faint small' }, t('admin.settings.nothingFound'))]));
  };
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  weatherForm = settingsForm(t('admin.settings.weather'), ['weather_location_name', 'weather_latitude', 'weather_longitude'], {
    before: h('div', { class: 'stack' },
      h('p', { class: 'muted small', style: { margin: 0 } }, t('admin.settings.weatherIntro')),
      h('div', { class: 'row' }, h('div', { class: 'field' }, search), h('button', { class: 'btn ghost', type: 'button', onclick: doSearch }, t('common.search'))),
      results),
  });

  const wifiForm = settingsForm(t('admin.settings.wifi'), ['wifi_ssid', 'wifi_password', 'wifi_encryption', 'wifi_hidden', 'wifi_note'], {
    after: values.wifi_ssid
      ? h('div', null, h('div', { class: 'small muted' }, t('admin.settings.qrOnScreen')), h('img', { class: 'qr-preview', src: `/api/wifi/qr.svg?t=${Date.now()}`, alt: t('admin.settings.qrAlt') }))
      : h('p', { class: 'faint small' }, t('admin.settings.noSsid')),
  });

  const origin = location.origin;
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('admin.settings.title')))),
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'stack' },
        settingsForm(t('admin.settings.general'), ['language']),
        settingsForm(t('admin.settings.display'), ['site_name', 'welcome_prefix', 'idle_title', 'idle_text', 'home_timeout_seconds', 'show_employee_titles'], {
          before: markupHelp(),
        })),
      h('div', { class: 'stack' }, weatherForm, wifiForm)),
    h('section', { class: 'section card pad stack' },
      h('h2', null, t('admin.settings.api')),
      h('p', { class: 'muted' }, tNodes('admin.settings.apiText', { api: h('code', null, `${origin}/api`), mcp: h('code', null, `${origin}/mcp`) })),
      h('pre', null, `claude mcp add --transport http welcomescreen ${origin}/mcp --header "Authorization: Bearer <ADMIN_TOKEN>"`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { storage.set('adminToken', ''); render(); } }, t('admin.login.signOut')))));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function render() {
  const [, page = 'visits', id] = location.hash.split('/');
  main.classList.toggle('wide', page === 'layouts');
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.classList.toggle('active', a.dataset.nav === page || (page === 'company' && a.dataset.nav === 'companies'));
  }

  const { authorized } = await api('/auth/check').catch(() => ({ authorized: false }));
  if (!authorized) {
    main.replaceChildren(viewLogin());
    return;
  }

  await applyHighlightStyle().catch(() => {});
  try {
    const views = {
      visits: () => viewVisits(id),
      companies: viewCompanies,
      company: () => viewCompany(id),
      layouts: () => viewLayouts(id),
      settings: viewSettings,
    };
    const view = await (views[page] ?? views.visits)();
    main.replaceChildren(view);
  } catch (err) {
    main.replaceChildren(h('div', { class: 'empty' }, t('common.error', { message: err.message })));
  }
}

// The language is needed before the first render (also for the sign-in page).
try {
  const i18n = await api('/i18n');
  languages = i18n.languages;
  await setLanguage(i18n.language);
} catch {
  await setLanguage('en').catch(() => {});
}
window.addEventListener('hashchange', render);
render();
