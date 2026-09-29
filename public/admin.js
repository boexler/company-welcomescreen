// Welcome Screen admin – single page app (no build step).
import { h, initials, hue, contrast, DARK_TEXT } from './shared.js';
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

function avatar(person, size = 42) {
  const style = { width: `${size}px`, height: `${size}px` };
  if (person.photo_url) return h('img', { class: 'avatar', src: person.photo_url, alt: '', style });
  return h('span', { class: 'avatar', style: { ...style, background: `hsl(${hue(person.name)} 45% 32%)`, fontSize: `${size / 2.8}px` } }, initials(person.name));
}

function logoBox(company, cls = 'logo-box') {
  return company.logo_url
    ? h('div', { class: cls }, h('img', { src: company.logo_url, alt: '' }))
    : h('div', { class: `${cls} none` }, initials(company.name));
}

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', null, hint) : null);

function imageInput(name, currentUrl, { cover = false, dark = false } = {}) {
  const preview = h('div', { class: `preview ${cover ? 'cover' : ''} ${dark ? 'dark' : ''}`, style: { backgroundImage: currentUrl ? `url("${currentUrl}")` : 'none' } });
  const input = h('input', {
    type: 'file', name, accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
    onchange: () => {
      const file = input.files[0];
      if (file) preview.style.backgroundImage = `url("${URL.createObjectURL(file)}")`;
    },
  });
  const remove = currentUrl
    ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', name: `remove_${name}`, value: '1', onchange: (e) => { preview.style.opacity = e.target.checked ? 0.25 : 1; } }), t('common.remove'))
    : null;
  return h('div', { class: 'image-field' }, preview, h('div', { class: 'stack', style: { flex: 1 } }, input, remove));
}

/** FormData without empty file inputs (so existing images are kept). */
function formData(form) {
  const fd = new FormData(form);
  for (const [k, v] of [...fd.entries()]) {
    if (v instanceof File && !v.size) fd.delete(k);
  }
  return fd;
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
      v.headline || v.message ? h('div', { class: 'small muted' }, [v.headline, v.message].filter(Boolean).join(' · ')) : null,
      h('div', { class: 'chips' },
        v.employees.length
          ? v.employees.map((e) => h('span', { class: 'pill' }, e.name))
          : h('span', { class: 'pill' }, t('admin.visits.noEmployees')),
        v.all_employees && v.employees.length ? h('span', { class: 'pill accent' }, t('admin.visits.all')) : null,
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

function visitForm(companies, editing) {
  const companySel = h('select', { name: 'company', required: true },
    h('option', { value: '' }, t('admin.visits.selectCompany')),
    companies.map((c) => h('option', { value: c.id, selected: editing?.company_id === c.id }, c.name)));
  const start = h('input', { type: 'date', name: 'start_date', required: true, value: editing?.start_date ?? plusDays(1) });
  const end = h('input', { type: 'date', name: 'end_date', value: editing && editing.end_date !== editing.start_date ? editing.end_date : '' });
  const headline = h('input', { name: 'headline', placeholder: t('admin.visits.headlinePlaceholder', { welcome: t('display.welcome') }), value: editing?.headline ?? '' });
  const message = h('textarea', { name: 'message', placeholder: t('admin.visits.messagePlaceholder') }, editing?.message ?? '');
  const hosts = hostList(editing?.hosts ?? []);
  const allBox = h('input', { type: 'checkbox', checked: editing ? editing.all_employees : true });
  const pick = h('div', { class: 'emp-pick' });
  const selected = new Set(editing && !editing.all_employees ? editing.employees.map((e) => e.id) : []);

  async function loadEmployees() {
    pick.replaceChildren();
    if (!companySel.value) {
      pick.append(h('span', { class: 'faint small' }, t('admin.visits.selectCompanyFirst')));
      return;
    }
    const employees = await api(`/employees?company=${companySel.value}`);
    if (!employees.length) {
      pick.append(h('span', { class: 'faint small' }, t('admin.visits.noEmployeesForCompany'), h('a', { href: `#/company/${companySel.value}` }, t('admin.visits.addEmployees'))));
      return;
    }
    for (const e of employees) {
      pick.append(h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', value: e.id, checked: allBox.checked || selected.has(e.id), disabled: allBox.checked,
          onchange: (ev) => { ev.target.checked ? selected.add(e.id) : selected.delete(e.id); },
        }),
        avatar(e, 28),
        h('span', { style: { lineHeight: 1.2 } }, e.name, e.title ? h('div', { class: 'faint small' }, e.title) : null)));
    }
  }

  companySel.addEventListener('change', () => { selected.clear(); loadEmployees(); });
  allBox.addEventListener('change', loadEmployees);
  loadEmployees();

  const quick = (label, days) => h('button', { class: 'btn ghost small', type: 'button', onclick: () => { start.value = plusDays(days); end.value = ''; } }, label);

  return h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const body = {
        company: Number(companySel.value),
        start_date: start.value,
        end_date: end.value || start.value,
        headline: headline.value,
        message: message.value,
        hosts: hosts.values(),
        all_employees: allBox.checked,
        employees: allBox.checked ? [] : [...selected],
      };
      if (!allBox.checked && !selected.size) { toast(t('admin.visits.selectEmployee'), 'error'); return; }
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
    h('label', { class: 'check' }, allBox, t('admin.visits.allEmployees')),
    pick),
  h('div', { class: 'row' }, field(t('admin.visits.headline'), headline), h('div', { class: 'field' }, h('span', null, t('admin.visits.hostsLabel')), hosts.el)),
  field(t('admin.visits.message'), message),
  h('div', { class: 'actions' },
    h('button', { class: 'btn', type: 'submit' }, editing ? t('common.save') : t('admin.visits.schedule')),
    editing ? h('a', { class: 'btn ghost', href: '#/visits' }, t('common.cancel')) : null));
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

async function viewCompanies() {
  const companies = await api('/companies');
  const form = h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const created = await run(() => api('/companies', { method: 'POST', form: formData(form) }), t('admin.companies.created'));
      if (created) location.hash = `#/company/${created.id}`;
    },
  },
  h('h2', null, t('admin.companies.new')),
  h('div', { class: 'row' },
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
        : h('div', { class: 'empty' }, t('admin.companies.none'))));
}

async function viewCompany(id) {
  const company = await api(`/companies/${id}`);

  const form = h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      if (await run(() => api(`/companies/${company.id}`, { method: 'PATCH', form: formData(form) }), t('admin.companies.saved'))) render();
    },
  },
  h('h2', null, t('admin.companies.company')),
  h('div', { class: 'row' },
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

  const addForm = h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = formData(addForm);
      fd.set('company', company.id);
      if (await run(() => api('/employees', { method: 'POST', form: fd }), t('admin.companies.employeeCreated'))) render();
    },
  },
  h('h3', null, t('admin.companies.addEmployee')),
  h('div', { class: 'row' },
    field(t('admin.companies.name'), h('input', { name: 'name', required: true })),
    field(t('admin.companies.position'), h('input', { name: 'title', placeholder: t('common.optional') })),
    field(t('admin.companies.photo'), imageInput('photo', null, { cover: true }))),
  h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'submit' }, t('common.add'))));

  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null, h('a', { href: '#/companies', class: 'small' }, t('admin.companies.back')), h('h1', null, company.name))),
    h('div', { class: 'grid grid-2' }, form, addForm),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, t('admin.companies.employees', { count: company.employees.length }))),
      company.employees.length
        ? h('ul', { class: 'card list' }, company.employees.map(employeeRow))
        : h('div', { class: 'empty' }, t('admin.companies.noEmployees'))),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, t('admin.companies.upcoming'))),
      company.upcoming_visits.length
        ? h('ul', { class: 'card list' }, company.upcoming_visits.map(visitRow))
        : h('div', { class: 'empty' }, t('admin.companies.noVisits'), h('a', { href: '#/visits' }, t('admin.companies.scheduleVisit')))));
}

function employeeRow(emp) {
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
    const form = h('form', {
      class: 'grow stack',
      onsubmit: async (e) => {
        e.preventDefault();
        if (await run(() => api(`/employees/${emp.id}`, { method: 'PATCH', form: formData(form) }), t('common.saved'))) render();
      },
    },
    h('div', { class: 'row' },
      field(t('admin.companies.name'), h('input', { name: 'name', required: true, value: emp.name })),
      field(t('admin.companies.position'), h('input', { name: 'title', value: emp.title ?? '' })),
      field(t('admin.companies.order'), h('input', { name: 'sort_order', type: 'number', value: emp.sort_order, style: { maxWidth: '110px' } }))),
    field(t('admin.companies.photo'), imageInput('photo', emp.photo_url, { cover: true })),
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

async function viewLayouts(id) {
  const [layouts, templates] = await Promise.all([api('/layouts'), api('/layouts/templates')]);
  const layout = layouts.find((l) => l.id === Number(id)) ?? layouts.find((l) => l.active) ?? layouts[0];
  const preview = previewFrame('/');

  const blurOut = h('span', { class: 'faint' });
  const dimOut = h('span', { class: 'faint' });
  const blur = h('input', { type: 'range', name: 'blur', min: 0, max: 60, value: layout.blur, oninput: () => { blurOut.textContent = `${blur.value}px`; } });
  const dim = h('input', { type: 'range', name: 'dim', min: 0, max: 90, value: layout.dim, oninput: () => { dimOut.textContent = `${dim.value} %`; } });
  blurOut.textContent = `${layout.blur}px`;
  dimOut.textContent = `${layout.dim} %`;

  const form = h('form', {
    class: 'card pad stack',
    onsubmit: async (e) => {
      e.preventDefault();
      if (await run(() => api(`/layouts/${layout.id}`, { method: 'PATCH', form: formData(form) }), t('admin.layouts.saved'))) render();
    },
  },
  h('div', { class: 'section-head' },
    h('h2', null, t('admin.layouts.heading', { name: layout.name })),
    layout.active ? h('span', { class: 'pill ok' }, t('admin.layouts.active')) : h('button', {
      class: 'btn ghost small', type: 'button',
      onclick: async () => { if (await run(() => api(`/layouts/${layout.id}/activate`, { method: 'POST' }), t('admin.layouts.activated'))) render(); },
    }, t('admin.layouts.activate'))),
  h('div', { class: 'row' },
    field(t('admin.layouts.name'), h('input', { name: 'name', required: true, value: layout.name })),
    field(t('admin.layouts.template'), h('select', { name: 'template' },
      Object.entries(templates).map(([key, label]) => h('option', { value: key, selected: key === layout.template }, has(`admin.layouts.templates.${key}`) ? t(`admin.layouts.templates.${key}`) : label))))),
  field(t('admin.layouts.background'), imageInput('background', layout.background_url, { cover: true, dark: true }), t('admin.layouts.backgroundHint')),
  field(t('admin.layouts.logo'), imageInput('logo', layout.logo_url, { dark: true }), t('admin.layouts.logoHint')),
  h('div', { class: 'row' },
    field(t('admin.layouts.accent'), h('input', { type: 'color', name: 'accent_color', value: layout.accent_color })),
    h('label', { class: 'field' }, h('span', null, `${t('admin.layouts.blur')} `, blurOut), blur),
    h('label', { class: 'field' }, h('span', null, `${t('admin.layouts.dim')} `, dimOut), dim,
      h('small', null, t('admin.layouts.dimHint')))),
  h('div', { class: 'actions' },
    h('button', { class: 'btn', type: 'submit' }, t('common.save')),
    layout.active ? null : h('button', {
      class: 'btn danger', type: 'button',
      onclick: async () => {
        if (!confirmDelete(t('admin.layouts.deleteWhat', { name: layout.name }))) return;
        if (await run(() => api(`/layouts/${layout.id}`, { method: 'DELETE' }), t('admin.layouts.deleted'))) { location.hash = '#/layouts'; render(); }
      },
    }, t('common.delete'))));
  // Needs the form to watch the background image input.
  form.insertBefore(textColorField(layout, form), form.querySelector(':scope > .actions'));

  const newForm = h('form', {
    class: 'row',
    onsubmit: async (e) => {
      e.preventDefault();
      const created = await run(() => api('/layouts', { method: 'POST', form: formData(newForm) }), t('admin.layouts.created'));
      if (created) location.hash = `#/layouts/${created.id}`;
    },
  },
  field(t('admin.layouts.new'), h('input', { name: 'name', required: true, placeholder: t('admin.layouts.newPlaceholder') })),
  h('button', { class: 'btn ghost', type: 'submit' }, t('common.create')));

  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, t('admin.layouts.title')), h('p', null, t('admin.layouts.intro')))),
    h('div', { class: 'grid grid-2' },
      form,
      h('div', { class: 'stack' },
        h('div', { class: 'card pad stack' },
          h('div', { class: 'section-head' }, h('h2', null, t('admin.layouts.preview')), h('button', { class: 'btn ghost small', type: 'button', onclick: preview.reload }, t('admin.layouts.reload'))),
          preview.frame),
        h('div', { class: 'card pad stack' },
          h('h2', null, t('admin.layouts.all')),
          h('div', { class: 'chips' }, layouts.map((l) => h('a', { class: `pill ${l.active ? 'ok' : l.id === layout.id ? 'accent' : ''}`, href: `#/layouts/${l.id}` }, l.name, l.active ? ' ✓' : ''))),
          newForm))));
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
    if (key === 'idle_text' || key === 'wifi_note') return field(label, h('textarea', { name: key }, values[key] ?? ''));
    // Empty greeting texts use the default text of the selected language.
    if (key === 'welcome_prefix' || key === 'idle_title') {
      return field(label, h('input', { name: key, value: values[key] ?? '', placeholder: t('display.welcome'), ...attrs }), t('admin.settings.defaultTextHint'));
    }
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
        settingsForm(t('admin.settings.display'), ['site_name', 'welcome_prefix', 'idle_title', 'idle_text', 'rotation_seconds', 'home_timeout_seconds', 'max_employees_per_slide', 'show_employee_titles'])),
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
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.classList.toggle('active', a.dataset.nav === page || (page === 'company' && a.dataset.nav === 'companies'));
  }

  const { authorized } = await api('/auth/check').catch(() => ({ authorized: false }));
  if (!authorized) {
    main.replaceChildren(viewLogin());
    return;
  }

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
