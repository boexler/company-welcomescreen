// MCP server (Streamable HTTP, stateless) exposing the welcome screen as tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { isAuthorized } from './auth.js';
import { HttpError } from './errors.js';
import * as svc from './service.js';
import { resolveImageUrls } from './images.js';

const ref = z.union([z.number().int(), z.string().min(1)]);
const companyRef = ref.describe('Company ID or exact company name');
const employeeRef = ref.describe('Employee ID or exact name');
const layoutRef = ref.describe('Layout ID or exact name');
const avatarRef = ref.describe('ID or name of a picture from the avatar pool (list_avatars)');
const avatarColor = z.string().nullable().describe('Background color of the initials (#RRGGBB); null = automatic');
const date = z.string().describe('Date: YYYY-MM-DD, DD.MM.YYYY, "today" or "tomorrow"');
const image = z.string().describe('Image as http(s) URL (downloaded by the server), SVG markup ("<svg ...>"), data URL ("data:image/png;base64,...") or plain base64 (PNG, JPEG, GIF, WEBP, SVG; max. 8 MB)');

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function tool(server, name, description, inputSchema, fn) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return ok(await fn(args ?? {}));
    } catch (err) {
      const message = err instanceof HttpError ? err.localize(svc.currentLanguage()) : err.message;
      return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
    }
  });
}

function buildServer(baseUrl) {
  const server = new McpServer(
    { name: 'company-welcomescreen', version: '1.0.0' },
    {
      instructions:
        'Controls the welcome screen at the reception. Visiting companies (with logo) have employees. A visit defines on which ' +
        'days a company is welcomed – the screen then automatically shows the company and its employees (one tile per visit, ' +
        'side by side when several companies visit on the same day). Example "Company XY is coming tomorrow": schedule_visit with ' +
        `company="XY", date="tomorrow". Relative URLs refer to ${baseUrl}. Companies, employees and layouts can be referenced ` +
        'by ID or exact name. Error messages use the language configured in the settings.',
    },
  );

  tool(server, 'get_overview', 'Overview: visits today, tomorrow and in the next 30 days, all companies and the active layout.', {}, () => ({
    base_url: baseUrl,
    ...svc.getOverview(),
  }));
  tool(server, 'get_display', 'Shows what the welcome screen displays on a given day (one tile per visit incl. employees, layout, Wi-Fi, weather location).', {
    date: date.optional().describe('Default: today'),
  }, ({ date: d }) => svc.getDisplay({ date: d }));

  // Companies
  tool(server, 'list_companies', 'Lists all visiting companies with their number of employees and next visit.', {}, () => svc.listCompanies());
  tool(server, 'get_company', 'Details of a company incl. employees and upcoming visits.', { company: companyRef }, ({ company }) => svc.getCompany(company));
  tool(server, 'create_company', 'Creates a new visiting company.', {
    name: z.string().min(1).describe('Company name (unique)'),
    logo: image.optional(),
    note: z.string().optional().describe('Internal note'),
  }, async (a) => svc.createCompany(await resolveImageUrls(a, ['logo'])));
  tool(server, 'update_company', 'Changes the name, logo or note of a company.', {
    company: companyRef,
    name: z.string().min(1).optional(),
    logo: image.optional(),
    remove_logo: z.boolean().optional(),
    note: z.string().nullable().optional(),
  }, async ({ company, ...patch }) => svc.updateCompany(company, await resolveImageUrls(patch, ['logo'])));
  tool(server, 'delete_company', 'Deletes a company including all its employees and visits.', { company: companyRef }, ({ company }) => svc.deleteCompany(company));

  // Employees
  tool(server, 'list_employees', 'Lists employees (optionally of one company only).', { company: companyRef.optional() }, ({ company }) => svc.listEmployees({ company }));
  tool(server, 'create_employee', 'Creates an employee of a visiting company.', {
    company: companyRef,
    name: z.string().min(1),
    title: z.string().optional().describe('Position, e.g. "Managing Director"'),
    photo: image.optional(),
    avatar: avatarRef.optional().describe('Picture from the avatar pool, used when there is no own photo'),
    avatar_color: avatarColor.optional(),
  }, async (a) => svc.createEmployee(await resolveImageUrls(a, ['photo'])));
  tool(server, 'update_employee', 'Changes an employee (including moving them to another company).', {
    employee: employeeRef,
    company: companyRef.optional().describe('New company'),
    name: z.string().min(1).optional(),
    title: z.string().nullable().optional(),
    photo: image.optional(),
    remove_photo: z.boolean().optional(),
    avatar: avatarRef.nullable().optional().describe('Picture from the avatar pool (null removes it); an own photo takes precedence'),
    avatar_color: avatarColor.optional(),
  }, async ({ employee, ...patch }) => svc.updateEmployee(employee, await resolveImageUrls(patch, ['photo'])));
  tool(server, 'delete_employee', 'Deletes an employee.', { employee: employeeRef }, ({ employee }) => svc.deleteEmployee(employee));

  // Avatar pool
  tool(server, 'list_avatars', 'Lists the pool of default pictures that employees can use instead of an own photo.', {}, () => svc.listAvatars());
  tool(server, 'add_avatar', 'Adds a picture to the avatar pool.', {
    name: z.string().min(1).describe('Name of the picture, e.g. "Llama"'),
    image,
  }, async (a) => svc.createAvatar(await resolveImageUrls(a, ['image'])));
  tool(server, 'delete_avatar', 'Removes a picture from the avatar pool; employees using it show their initials again.', { avatar: avatarRef }, ({ avatar }) => svc.deleteAvatar(avatar));

  // Visits
  tool(server, 'list_visits', 'Lists visits in a period (default: from today) or on a specific day.', {
    from: date.optional(),
    to: date.optional(),
    date: date.optional().describe('Only visits on exactly this day'),
    company: companyRef.optional(),
  }, (a) => svc.listVisits(a));
  tool(server, 'schedule_visit', 'Schedules a visit: on these days the screen welcomes the company. Without "employees" all employees of the company are shown; all_employees=false without employees shows the company only.', {
    company: companyRef,
    date: date.describe('First day of the visit, e.g. "tomorrow"'),
    end_date: date.optional().describe('Last day of a multi-day visit (default: = date)'),
    employees: z.array(employeeRef).optional().describe('Show only these employees (IDs or names), in this order'),
    all_employees: z.boolean().optional().describe('true = all employees of the company (employees then only sets the order); false + no employees = no employees'),
    show_avatars: z.boolean().optional().describe('Show pictures of the employees (default: false, names only)'),
    headline: z.string().optional().describe('Custom headline; default: the greeting of the configured language'),
    message: z.string().optional().describe('Additional text below the company name. Texts may emphasize parts: *text* = highlighted (styled by the layout, default accent color), **text** = bold, ***text*** = both'),
    hosts: z.array(z.string()).optional().describe('In-house contacts, e.g. ["John Smith", "Jane Doe"]'),
  }, (a) => svc.createVisit(a));
  tool(server, 'update_visit', 'Changes a visit. employees = [] means all employees again (unless all_employees = false: then no employees).', {
    visit_id: z.number().int(),
    company: companyRef.optional(),
    date: date.optional(),
    end_date: date.optional(),
    employees: z.array(employeeRef).optional().describe('Employees in the order shown on the screen'),
    all_employees: z.boolean().optional(),
    show_avatars: z.boolean().optional(),
    headline: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    hosts: z.array(z.string()).optional().describe('Replaces all contacts; [] removes them'),
  }, ({ visit_id, ...patch }) => svc.updateVisit(visit_id, patch));
  tool(server, 'cancel_visit', 'Deletes (cancels) a visit.', { visit_id: z.number().int() }, ({ visit_id }) => svc.deleteVisit(visit_id));

  // Layouts & settings
  tool(server, 'list_layouts', 'Lists the layouts (appearance) and which one is active.', {}, () => svc.listLayouts());
  tool(server, 'update_layout', 'Changes a layout: background image, logo top left (and its size), accent and text color, blur, dimming, spacing and fonts/sizes/colors of the text elements.', {
    layout: layoutRef,
    name: z.string().min(1).optional(),
    background: image.optional(),
    remove_background: z.boolean().optional(),
    logo: image.optional(),
    remove_logo: z.boolean().optional(),
    accent_color: z.string().optional().describe('#RRGGBB'),
    text_color: z.string().optional().describe('#RRGGBB – choose a dark color (e.g. #1e2530) for bright background images; the glass then turns bright automatically'),
    blur: z.number().int().min(0).max(60).optional().describe('Strength of the glass effect in px'),
    dim: z.number().int().min(0).max(90).optional().describe('Softening of the background in % (darkens with light text, brightens with dark text)'),
    logo_size: z.number().int().min(20).max(400).optional().describe('Size of the own logo top left in % (100 = default)'),
    company_logo_size: z.number().int().min(30).max(300).optional().describe('Size of the logos of the visiting companies in the visit tiles in % (100 = default)'),
    tile_gap: z.number().int().min(0).max(300).optional().describe('Gap between the visit tiles (px at Full HD, scales with the screen)'),
    footer_gap: z.number().int().min(0).max(300).optional().describe('Gap between the content and the navigation at the bottom (px at Full HD)'),
    typography: z.record(z.string(), z.object({
      font: z.string().optional().describe(`Font name; shipped: ${svc.FONTS.join(', ')}; others must be installed on the display device`),
      size: z.number().int().min(25).max(400).optional().describe('Size in % of the default'),
      color: z.string().optional().describe('#RRGGBB'),
    })).optional().describe(`Replaces all text settings. Keys: ${Object.entries(svc.TEXT_ELEMENTS).map(([k, v]) => `${k} (${v})`).join(', ')}`),
    activate: z.boolean().optional(),
  }, async ({ layout, ...patch }) => svc.updateLayout(layout, await resolveImageUrls(patch, ['background', 'logo'])));
  tool(server, 'activate_layout', 'Activates a layout for the screen.', { layout: layoutRef }, ({ layout }) => svc.activateLayout(layout));
  tool(server, 'get_settings', 'Reads all settings (language, texts, timings, weather location, guest Wi-Fi).', {}, () => ({ values: svc.getSettings(), schema: svc.SETTINGS }));
  tool(server, 'update_settings', `Changes settings. Allowed keys: ${Object.keys(svc.SETTINGS).join(', ')}.`, {
    settings: z.record(z.string(), z.any()).describe('Object with the keys to change, e.g. {"language": "de", "wifi_ssid": "Guest", "wifi_password": "..."}'),
  }, ({ settings }) => svc.updateSettings(settings));

  return server;
}

function baseUrlOf(req) {
  return process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

/** Express handler for POST /mcp (stateless: one server + transport per request). */
export async function handleMcp(req, res) {
  if (!isAuthorized(req)) {
    res.status(401).set('WWW-Authenticate', 'Bearer').json({
      jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: send the admin token as "Authorization: Bearer <token>".' }, id: null,
    });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
    return;
  }
  const server = buildServer(baseUrlOf(req));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
