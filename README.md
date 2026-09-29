# Company Welcome Screen

A welcome screen for your reception area. When a company visits, the screen automatically shows their logo, name and
the registered employees on the day of the visit. If several companies visit on the same day, the screen rotates
between them with an animation.

- **Welcome screen** (`/`): full-screen page for a TV or kiosk stele. Background image, your logo top left with the
  weather next to it, the time top right and a frosted glass card in the middle. A dock at the bottom offers
  **Home**, **Weather** and **Wi-Fi**:
  - *Home*: welcomes today's visitors (companies rotate with a progress bar; many employees are split across pages).
  - *Weather*: current weather, the next hours and 5 days (Open-Meteo, no API key needed).
  - *Wi-Fi*: guest Wi-Fi with network name, password and a QR code to scan.
  - After 20 seconds without interaction the screen returns to *Home* (configurable).
- **Admin area** (`/admin`): manage companies (name, logo) and their employees (name, position, photo), schedule visits
  ("company XY is coming tomorrow", also multi-day and with selected employees only, with one or more in-house
  contacts), and maintain layouts and settings.
- **Layouts**: appearance (background image, your own logo, accent color, text color, blur strength, dimming). Several
  layouts are possible (e.g. seasonal); the active one is shown. With a dark text color the glass automatically turns
  bright, which suits light background images; the admin area can suggest a readable text color for the chosen image.
  `glass` is the first template; more can be added later.
- **REST API** at `/api` and **MCP server** at `/mcp` (Streamable HTTP) – both share the same logic.
- **Multilingual**: English and German are included; the language is selected in the admin area
  (*Settings → General*) and applies to the display, the admin area and API error messages.
- Storage in **SQLite** (`data/welcomescreen.db`, images stored as BLOBs in the same file → backup = one file).

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
npm run seed            # demo companies with visits today/tomorrow (optional)
npm start               # display: http://localhost:3000   admin: http://localhost:3000/admin
```

On first start – unless `ADMIN_TOKEN` is set – an admin token is generated, saved to `data/.admin-token` and printed
to the console. Use it to sign in to the admin area.

### Docker

```bash
ADMIN_TOKEN=my-secret-token docker compose up -d --build
docker compose exec welcomescreen node scripts/seed.js   # optional
```

`HOST_PORT` sets the port on the host (default `3000`). For local values, copy `.env.example` to `.env` –
`docker compose` reads it automatically.

**Data storage:** With `DATA_PATH` (absolute path on the host, e.g. `/opt/company-welcomescreen/data`) the database and
token are stored directly on the host and survive every redeploy or removal of the stack. Without `DATA_PATH` they are
kept in the Docker volume `welcomescreen-data`. The container starts as root, hands the folder over to `PUID`/`PGID`
(default `1000`) and then continues without root privileges.

**Backup:** back up the `DATA_PATH` folder (`welcomescreen.db` plus `welcomescreen.db-wal` if present), ideally with the
container stopped or via `sqlite3 welcomescreen.db ".backup backup.db"`.

### Portainer

1. *Stacks → Add stack → Repository*, enter the repository URL and `docker-compose.yml` as the compose path.
2. Under *Environment variables* set `HOST_PORT` (e.g. `8080`), `DATA_PATH` (e.g. `/opt/company-welcomescreen/data`),
   `ADMIN_TOKEN` (a long random token) and optionally `PUBLIC_URL`, `SITE_NAME`, `WEATHER_*`.
   Alternatively use *Load variables from .env file* with a local copy of `.env.example`.
3. *Deploy the stack*. If `ADMIN_TOKEN` is empty, the generated token is printed in the container log.

After an update (redeploy), open displays reload themselves automatically.

### Configuration (environment variables or `.env`)

| Variable      | Default   | Description |
|---------------|-----------|-------------|
| `HOST_PORT`   | `3000`    | Docker only: published port on the host |
| `DATA_PATH`   | volume `welcomescreen-data` | Docker only: host folder for the data (absolute path) |
| `PUID`/`PGID` | `1000`    | Docker only: owner of the files in the data folder |
| `PORT`        | `3000`    | HTTP port of the app (do not change inside the container) |
| `HOST`        | `0.0.0.0` | Bind address |
| `DATA_DIR`    | `./data`  | Location of `welcomescreen.db` and `.admin-token` |
| `ADMIN_TOKEN` | generated | Token for all write access (admin UI, REST, MCP) |
| `PUBLIC_URL`  | from request | Base URL passed to MCP clients for relative links |
| `APP_TIMEZONE` | `Europe/Berlin` | Time zone for the clock, "today"/"tomorrow" and the day change |
| `APP_LANGUAGE` | `en` | Initial value: language of the display and the admin area (`en`, `de`) |
| `SITE_NAME`   | – | Initial value: your own company name for the greeting when no visit is scheduled |
| `WEATHER_LOCATION`, `WEATHER_LATITUDE`, `WEATHER_LONGITUDE` | – | Initial values for the weather location |

The `APP_LANGUAGE`/`SITE_NAME`/`WEATHER_*` values only apply until the setting has been saved in the admin area.

## Languages

All texts live in one file per language in [`locales/`](locales) (`en.json`, `de.json`). The server and the browser
use the same files; English is the fallback for missing keys. To add a language, copy `en.json` to e.g. `fr.json`,
translate the values and set `_meta.name` (shown in the language selection) and `_meta.locale` (used for dates and
numbers, e.g. `fr-FR`). After a restart the language can be selected in the admin area.

The greeting texts in *Settings → Display* can stay empty – the display then uses the default greeting of the selected
language ("Welcome" / "Herzlich willkommen").

## Display device (kiosk)

The display is a regular web page and scales with the screen size (Full HD, 4K, portrait too).
Example for a Raspberry Pi / mini PC with Chromium:

```bash
chromium --kiosk --noerrdialogs --disable-infobars --incognito http://<server>:3000/
```

- Operated by touch or mouse; keyboard: `1`/`2`/`3` for Home/Weather/Wi-Fi, `→` next company.
- The mouse cursor is hidden after 3 seconds.
- Data is refreshed every 30 seconds – new visits appear without reloading.
- `/?date=2026-10-01` shows a preview for another date.

## MCP server (for Claude and other clients)

Endpoint: `http(s)://<server>/mcp`, authentication via `Authorization: Bearer <ADMIN_TOKEN>`.

```bash
claude mcp add --transport http welcomescreen https://<server>/mcp --header "Authorization: Bearer <ADMIN_TOKEN>"
```

Or in a `.mcp.json`:

```json
{
  "mcpServers": {
    "welcomescreen": {
      "type": "http",
      "url": "https://<server>/mcp",
      "headers": { "Authorization": "Bearer <ADMIN_TOKEN>" }
    }
  }
}
```

Available tools:

| Tool | Purpose |
|------|---------|
| `get_overview` | Visits today/tomorrow/next 30 days, companies, active layout |
| `get_display` | What the screen shows on a given day |
| `list_companies`, `get_company`, `create_company`, `update_company`, `delete_company` | Companies |
| `list_employees`, `create_employee`, `update_employee`, `delete_employee` | Employees of the companies |
| `list_visits`, `schedule_visit`, `update_visit`, `cancel_visit` | Visits |
| `list_layouts`, `update_layout`, `activate_layout` | Layouts |
| `get_settings`, `update_settings` | Texts, timings, weather, guest Wi-Fi |

Example prompt: *"Tomorrow Nordwind Maschinenbau is visiting with Anna Becker and Jonas Weber, their contacts are Max
and Erika."*

Companies, employees and layouts can be referenced by ID **or** exact name. Dates are accepted as `YYYY-MM-DD`,
`DD.MM.YYYY`, `today`/`tomorrow` or the German `heute`/`morgen`/`übermorgen`. Images (logo/photo/background) are
passed as SVG markup, data URL or Base64.

## REST API

Reading works without a token (except settings); all write calls require `Authorization: Bearer <ADMIN_TOKEN>`
(alternatively the `X-API-Key` header). Errors are returned as `{ "error": "<message in the configured language>", "code": "errors.<key>" }`. Write endpoints with images accept JSON (image as Base64/data URL/SVG string)
or `multipart/form-data` (image as file field).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/display?date=` | Everything the display needs for one day (default: today) |
| GET | `/api/i18n` | Configured language and available languages (texts: `/locales/<code>.json`) |
| GET | `/api/weather` | Current weather + forecast (cached for 10 min) |
| GET | `/api/wifi/qr.svg` | QR code for the guest Wi-Fi |
| GET | `/api/companies` | Companies incl. employee count and next visit |
| GET | `/api/companies/:idOrName` | Company incl. employees and upcoming visits |
| POST | `/api/companies` | `name`, `logo?`, `note?` |
| PATCH/DELETE | `/api/companies/:ref` | as above, plus `remove_logo?` – deleting also removes employees and visits |
| GET | `/api/employees?company=` | Employees |
| POST | `/api/employees` | `company`, `name`, `title?`, `photo?`, `sort_order?` |
| PATCH/DELETE | `/api/employees/:ref` | as above, plus `remove_photo?` |
| GET | `/api/visits?from=&to=&date=&company=` | Visits (default: from today) |
| POST | `/api/visits` | `company`, `date` or `start_date`, `end_date?`, `employees?` (IDs/names; empty = all), `headline?`, `message?`, `hosts?` (list of in-house contacts, max. 10) |
| PATCH/DELETE | `/api/visits/:id` | Update/delete a visit – `hosts` replaces all contacts, `[]` removes them |
| GET | `/api/layouts` | Layouts incl. the active one |
| POST | `/api/layouts` | `name`, `background?`, `logo?`, `accent_color?`, `text_color?` (#RRGGBB), `blur?` (0–60), `dim?` (0–90), `activate?` |
| PATCH/DELETE | `/api/layouts/:ref` | as above, plus `remove_background?`, `remove_logo?` |
| POST | `/api/layouts/:ref/activate` | Activate a layout |
| GET/PATCH | `/api/settings` | Read/change settings (token required) |
| GET | `/api/settings/schema` | Description of all settings |

Examples:

```bash
curl -X POST http://localhost:3000/api/companies -H "Authorization: Bearer $TOKEN" \
  -F name="Acme Inc." -F logo=@acme.png

curl -X POST http://localhost:3000/api/employees -H "Authorization: Bearer $TOKEN" \
  -F company="Acme Inc." -F name="Jane Doe" -F title="CEO" -F photo=@jane.jpg

curl -X POST http://localhost:3000/api/visits -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"company":"Acme Inc.","date":"tomorrow","hosts":["John Smith","Erika Mustermann"]}'
```

## Database migrations

The schema is managed exclusively through migrations in `migrations/`. On startup all pending migrations are applied
automatically in order – each in its own transaction.

```bash
npm run migrate -- new add_company_website   # creates migrations/<next>_add_company_website.sql
npm run migrate -- status                    # shows applied / pending migrations
npm run migrate                              # applies pending migrations (also happens on startup)
```

Never change a migration that has already been applied – add a new file for every change.

## Project structure

```
src/
  server.js        Express setup, static files, error handling
  config.js        Environment variables, admin token
  db.js            SQLite connection
  migrate.js       Migration runner
  i18n.js          Translations (language files, error messages)
  service.js       Domain logic (shared by REST & MCP)
  api.js           REST router
  mcp.js           MCP server (Streamable HTTP, stateless)
  weather.js       Weather via Open-Meteo (cached server-side)
  wifi.js          QR code for the guest Wi-Fi
  images.js        Image upload & format detection
public/
  index.html, display.*   Welcome screen (vanilla JS, no build step)
  admin.html, admin.*     Admin area
  shared.js               Shared helpers
  i18n.js                 Translations in the browser
locales/           Language files (en.json, de.json)
migrations/        Schema migrations
scripts/seed.js    Demo data
scripts/migrate.js Migration CLI (status, up, new)
```
