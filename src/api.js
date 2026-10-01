import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { requireAdmin, isAuthorized } from './auth.js';
import { getImage, resolveImageUrls } from './images.js';
import { HttpError } from './errors.js';
import { LANGUAGES } from './i18n.js';
import { getWeather, geocode } from './weather.js';
import { wifiQrSvg } from './wifi.js';
import * as svc from './service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImageBytes, files: 2 } });

// Images may be SVG; never let them execute scripts when opened directly.
const IMAGE_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Accepts JSON (image as base64 / data URL / raw SVG / http(s) URL) or multipart (image as file field, or its URL in
 * "<field>_url"). Images given by URL are downloaded.
 */
async function withFiles(req, ...imageFields) {
  const body = { ...req.body };
  for (const [field, files] of Object.entries(req.files ?? {})) body[field] = files[0];
  return resolveImageUrls(body, imageFields);
}

const images = (...fields) => upload.fields(fields.map((name) => ({ name, maxCount: 1 })));

export function createApiRouter() {
  const api = express.Router();

  api.get('/health', (req, res) => res.json({ ok: true }));
  api.get('/auth/check', (req, res) => res.json({ authorized: isAuthorized(req) }));
  // Public: the admin UI needs the language before signing in. The texts are served from /locales/<code>.json.
  api.get('/i18n', (req, res) => res.json({ language: svc.currentLanguage(), languages: LANGUAGES }));

  // --- Display -------------------------------------------------------------
  api.get('/display', (req, res) => {
    res.set('Cache-Control', 'no-store').json(svc.getDisplay({ date: req.query.date, layout: req.query.layout }));
  });
  api.get('/weather', async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await getWeather());
  });
  api.get('/wifi/qr.svg', async (req, res) => {
    res.set({ ...IMAGE_HEADERS, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' }).send(await wifiQrSvg());
  });

  // --- Images --------------------------------------------------------------
  api.get('/images/:id', (req, res) => {
    const img = getImage(Number(req.params.id));
    if (!img) throw new HttpError(404, 'errors.imageNotFound');
    res.set({ ...IMAGE_HEADERS, 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable' }).send(img.data);
  });

  // --- Companies -----------------------------------------------------------
  api.get('/companies', (req, res) => res.json(svc.listCompanies()));
  api.get('/companies/:ref', (req, res) => res.json(svc.getCompany(req.params.ref)));
  api.post('/companies', requireAdmin, images('logo'), async (req, res) => res.status(201).json(svc.createCompany(await withFiles(req, 'logo'))));
  api.patch('/companies/:ref', requireAdmin, images('logo'), async (req, res) => res.json(svc.updateCompany(req.params.ref, await withFiles(req, 'logo'))));
  api.delete('/companies/:ref', requireAdmin, (req, res) => res.json(svc.deleteCompany(req.params.ref)));

  // --- Employees -----------------------------------------------------------
  api.get('/employees', (req, res) => res.json(svc.listEmployees({ company: req.query.company ?? req.query.company_id })));
  api.get('/employees/:ref', (req, res) => res.json(svc.getEmployee(req.params.ref, req.query.company)));
  api.post('/employees', requireAdmin, images('photo'), async (req, res) => {
    const body = await withFiles(req, 'photo');
    res.status(201).json(svc.createEmployee({ ...body, company: body.company ?? body.company_id }));
  });
  api.patch('/employees/:ref', requireAdmin, images('photo'), async (req, res) => {
    const body = await withFiles(req, 'photo');
    res.json(svc.updateEmployee(req.params.ref, { ...body, company: body.company ?? body.company_id }));
  });
  api.delete('/employees/:ref', requireAdmin, (req, res) => res.json(svc.deleteEmployee(req.params.ref)));

  // --- Avatar pool ---------------------------------------------------------
  api.get('/avatars', (req, res) => res.json(svc.listAvatars()));
  api.post('/avatars', requireAdmin, images('image'), async (req, res) => res.status(201).json(svc.createAvatar(await withFiles(req, 'image'))));
  api.delete('/avatars/:ref', requireAdmin, (req, res) => res.json(svc.deleteAvatar(req.params.ref)));

  // --- Visits --------------------------------------------------------------
  api.get('/visits', (req, res) => {
    const q = req.query;
    res.json(svc.listVisits({ from: q.from, to: q.to, date: q.date, company: q.company ?? q.company_id }));
  });
  api.get('/visits/:id', (req, res) => res.json(svc.getVisit(req.params.id)));
  api.post('/visits', requireAdmin, (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(svc.createVisit({ ...b, company: b.company ?? b.company_id }));
  });
  api.patch('/visits/:id', requireAdmin, (req, res) => {
    const b = req.body ?? {};
    res.json(svc.updateVisit(req.params.id, { ...b, company: b.company ?? b.company_id }));
  });
  api.delete('/visits/:id', requireAdmin, (req, res) => res.json(svc.deleteVisit(req.params.id)));

  // --- Layouts -------------------------------------------------------------
  api.get('/layouts', (req, res) => res.json(svc.listLayouts()));
  api.get('/layouts/templates', (req, res) => res.json(svc.TEMPLATES));
  api.get('/layouts/typography', (req, res) => res.json({ elements: svc.TEXT_ELEMENTS, fonts: svc.FONTS }));
  api.get('/layouts/:ref', (req, res) => res.json(svc.getLayout(req.params.ref)));
  api.post('/layouts', requireAdmin, images('background', 'logo'), async (req, res) => res.status(201).json(svc.createLayout(await withFiles(req, 'background', 'logo'))));
  api.patch('/layouts/:ref', requireAdmin, images('background', 'logo'), async (req, res) => res.json(svc.updateLayout(req.params.ref, await withFiles(req, 'background', 'logo'))));
  api.post('/layouts/:ref/activate', requireAdmin, (req, res) => res.json(svc.activateLayout(req.params.ref)));
  api.post('/layouts/:ref/copy', requireAdmin, (req, res) => res.status(201).json(svc.copyLayout(req.params.ref, req.body ?? {})));
  api.delete('/layouts/:ref', requireAdmin, (req, res) => res.json(svc.deleteLayout(req.params.ref)));

  // --- Settings ------------------------------------------------------------
  // Settings include the Wi-Fi password, which the display shows anyway; still keep the full set admin-only.
  api.get('/settings', requireAdmin, (req, res) => res.json(svc.getSettings()));
  api.get('/settings/schema', requireAdmin, (req, res) => res.json(svc.SETTINGS));
  api.patch('/settings', requireAdmin, (req, res) => res.json(svc.updateSettings(req.body ?? {})));
  api.get('/geocode', requireAdmin, async (req, res) => res.json(await geocode(req.query.q)));

  api.use(() => {
    throw new HttpError(404, 'errors.endpointNotFound');
  });
  return api;
}
