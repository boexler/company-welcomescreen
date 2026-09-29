// MCP server (Streamable HTTP, stateless) exposing the welcome screen as tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { isAuthorized } from './auth.js';
import { HttpError } from './errors.js';
import * as svc from './service.js';

const ref = z.union([z.number().int(), z.string().min(1)]);
const companyRef = ref.describe('Company ID or exact company name');
const employeeRef = ref.describe('Employee ID or exact name');
const layoutRef = ref.describe('Layout ID or exact name');
const date = z.string().describe('Date: YYYY-MM-DD, DD.MM.YYYY, "today" or "tomorrow"');
const image = z.string().describe('Image as SVG markup ("<svg ...>"), data URL ("data:image/png;base64,...") or plain base64 (PNG, JPEG, GIF, WEBP, SVG; max. 8 MB)');

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
        'days a company is welcomed – the screen then automatically shows the company and its employees and rotates with an ' +
        'animation when several companies visit on the same day. Example "Company XY is coming tomorrow": schedule_visit with ' +
        `company="XY", date="tomorrow". Relative URLs refer to ${baseUrl}. Companies, employees and layouts can be referenced ` +
        'by ID or exact name. Error messages use the language configured in the settings.',
    },
  );

  tool(server, 'get_overview', 'Overview: visits today, tomorrow and in the next 30 days, all companies and the active layout.', {}, () => ({
    base_url: baseUrl,
    ...svc.getOverview(),
  }));
  tool(server, 'get_display', 'Shows what the welcome screen displays on a given day (slides per company incl. employees, layout, Wi-Fi, weather location).', {
    date: date.optional().describe('Default: today'),
  }, ({ date: d }) => svc.getDisplay({ date: d }));

  // Companies
  tool(server, 'list_companies', 'Lists all visiting companies with their number of employees and next visit.', {}, () => svc.listCompanies());
  tool(server, 'get_company', 'Details of a company incl. employees and upcoming visits.', { company: companyRef }, ({ company }) => svc.getCompany(company));
  tool(server, 'create_company', 'Creates a new visiting company.', {
    name: z.string().min(1).describe('Company name (unique)'),
    logo: image.optional(),
    note: z.string().optional().describe('Internal note'),
  }, (a) => svc.createCompany(a));
  tool(server, 'update_company', 'Changes the name, logo or note of a company.', {
    company: companyRef,
    name: z.string().min(1).optional(),
    logo: image.optional(),
    remove_logo: z.boolean().optional(),
    note: z.string().nullable().optional(),
  }, ({ company, ...patch }) => svc.updateCompany(company, patch));
  tool(server, 'delete_company', 'Deletes a company including all its employees and visits.', { company: companyRef }, ({ company }) => svc.deleteCompany(company));

  // Employees
  tool(server, 'list_employees', 'Lists employees (optionally of one company only).', { company: companyRef.optional() }, ({ company }) => svc.listEmployees({ company }));
  tool(server, 'create_employee', 'Creates an employee of a visiting company.', {
    company: companyRef,
    name: z.string().min(1),
    title: z.string().optional().describe('Position, e.g. "Managing Director"'),
    photo: image.optional(),
    sort_order: z.number().int().optional().describe('Order on the screen (ascending)'),
  }, (a) => svc.createEmployee(a));
  tool(server, 'update_employee', 'Changes an employee (including moving them to another company).', {
    employee: employeeRef,
    company: companyRef.optional().describe('New company'),
    name: z.string().min(1).optional(),
    title: z.string().nullable().optional(),
    photo: image.optional(),
    remove_photo: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  }, ({ employee, ...patch }) => svc.updateEmployee(employee, patch));
  tool(server, 'delete_employee', 'Deletes an employee.', { employee: employeeRef }, ({ employee }) => svc.deleteEmployee(employee));

  // Visits
  tool(server, 'list_visits', 'Lists visits in a period (default: from today) or on a specific day.', {
    from: date.optional(),
    to: date.optional(),
    date: date.optional().describe('Only visits on exactly this day'),
    company: companyRef.optional(),
  }, (a) => svc.listVisits(a));
  tool(server, 'schedule_visit', 'Schedules a visit: on these days the screen welcomes the company. Without "employees" all employees of the company are shown.', {
    company: companyRef,
    date: date.describe('First day of the visit, e.g. "tomorrow"'),
    end_date: date.optional().describe('Last day of a multi-day visit (default: = date)'),
    employees: z.array(employeeRef).optional().describe('Show only these employees (IDs or names)'),
    headline: z.string().optional().describe('Custom headline; default: the greeting of the configured language'),
    message: z.string().optional().describe('Additional text below the company name'),
    hosts: z.array(z.string()).optional().describe('In-house contacts, e.g. ["John Smith", "Jane Doe"]'),
  }, (a) => svc.createVisit(a));
  tool(server, 'update_visit', 'Changes a visit. employees = [] means all employees again.', {
    visit_id: z.number().int(),
    company: companyRef.optional(),
    date: date.optional(),
    end_date: date.optional(),
    employees: z.array(employeeRef).optional(),
    headline: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    hosts: z.array(z.string()).optional().describe('Replaces all contacts; [] removes them'),
  }, ({ visit_id, ...patch }) => svc.updateVisit(visit_id, patch));
  tool(server, 'cancel_visit', 'Deletes (cancels) a visit.', { visit_id: z.number().int() }, ({ visit_id }) => svc.deleteVisit(visit_id));

  // Layouts & settings
  tool(server, 'list_layouts', 'Lists the layouts (appearance) and which one is active.', {}, () => svc.listLayouts());
  tool(server, 'update_layout', 'Changes a layout: background image, logo top left, accent and text color, blur and dimming.', {
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
    activate: z.boolean().optional(),
  }, ({ layout, ...patch }) => svc.updateLayout(layout, patch));
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
