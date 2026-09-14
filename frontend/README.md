[![Revive Group](https://img.shields.io/badge/Revive_Group-009C43?style=flat&labelColor=ffffff&logo=data:image%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOTYiIGhlaWdodD0iMjk3IiB2aWV3Qm94PSIwIDAgMjk2IDI5NyI%2BDQogIDwhLS0gVG9wIHNlZ21lbnQgLS0%2BDQogIDxwYXRoDQogICAgZD0iTTczIDI5DQogICAgICAgQTE0NCAxNDQgMCAwIDEgMjkxIDEyNg0KICAgICAgIEw3MyAyOSBaIg0KICAgIGZpbGw9IiMxZDFkMWQiDQogICAgc3Ryb2tlPSIjMWQxZDFkIg0KICAgIHN0cm9rZS13aWR0aD0iMC42Ig0KICAvPg0KDQogIDwhLS0gR3JlZW4gY2VudGVyIHNlZ21lbnQgLS0%2BDQogIDxwYXRoDQogICAgZD0iTTM5IDYzDQogICAgICAgQTE0NCAxNDQgMCAwIDAgMzkgMjM0DQogICAgICAgTDIzNCAxNDgNCiAgICAgICBaIg0KICAgIGZpbGw9IiMxMTlmNDMiDQogIC8%2BDQoNCiAgPCEtLSBCb3R0b20gc2VnbWVudCAtLT4NCiAgPHBhdGgNCiAgICBkPSJNNzMgMjY5DQogICAgICAgQTE0NCAxNDQgMCAwIDAgMjkxIDE1OA0KICAgICAgIEw3MyAyNjkgWiINCiAgICBmaWxsPSIjMWQxZDFkIg0KICAgIHN0cm9rZT0iIzFkMWQxZCINCiAgICBzdHJva2Utd2lkdGg9IjAuNiINCiAgLz4NCjwvc3ZnPg0K)](https://rei-limited.com/)

[![React](https://img.shields.io/badge/React-18.3-009C43?logo=react&logoColor=white&labelColor=1d1d1d)](https://react.dev/)
[![ReactDOM](https://img.shields.io/badge/ReactDOM-18.3-009C43?logo=react&logoColor=white&labelColor=1d1d1d)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.4-009C43?logo=vite&logoColor=white&labelColor=1d1d1d)](https://vitejs.dev/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-009C43?logo=leaflet&logoColor=white&labelColor=1d1d1d)](https://leafletjs.com/)
[![Recharts](https://img.shields.io/badge/Recharts-^2.12.7-009C43?labelColor=1d1d1d)](https://recharts.org/)
[![jsPDF](https://img.shields.io/badge/jsPDF-^4.2.1-009C43?labelColor=FFFFFF&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjMgMyAxOCAxOCI+PGNpcmNsZSBjeD0iOSIgY3k9IjkiIHI9IjYiIGZpbGw9IiM4RTRERTMiIGZpbGwtb3BhY2l0eT0iMC44Ii8+PGNpcmNsZSBjeD0iMTUiIGN5PSIxMiIgcj0iNiIgZmlsbD0iIzU1NTU1NSIgZmlsbC1vcGFjaXR5PSIwLjUiLz48Y2lyY2xlIGN4PSI5IiBjeT0iMTUiIHI9IjYiIGZpbGw9IiMwMEU1QkEiIGZpbGwtb3BhY2l0eT0iMC44Ii8+PC9zdmc+)](https://github.com/parallax/jsPDF)
[![i18next](https://img.shields.io/badge/i18next-Localised-009C43?labelColor=1d1d1d)](https://www.i18next.com/)

[![Docker](https://img.shields.io/badge/Docker-Containerised-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![Caddy](https://img.shields.io/badge/Caddy-Enabled-419E3D?logo=caddy&logoColor=white)](https://caddyserver.com/)

![Production](https://img.shields.io/badge/status-production-009C43?labelColor=1d1d1d)

---

# Revive Live — Frontend

The React (Vite) dashboard: a flat, sidebar-navigated SaaS-style app that
shows one vehicle's telemetry, or the whole fleet visible to the current
deployment, at a glance. It's a **read-only client** — every number comes
from the backend API; nothing is computed or faked in the browser.

See the root [`CLAUDE.md`](../CLAUDE.md) for what this project is and its
non-negotiables, and the root [`README.md`](../README.md) for how to deploy.

## Pages

| Page | What it shows |
|------|----------------|
| **Overview** | One vehicle: last-known location + route history on the map, tank levels, Current Status (Live/Offline, Travelling/Idle/Working), pump-usage and weather panels |
| **Fleet** | Every vehicle visible to the current deployment at a glance; selecting one jumps to Overview |
| **Trends** | Longer-run charts (pump usage, fuel, recycled water) with day/week/month grain toggles and period paging |
| **Sustainability** | Recycled-water and environmental-impact reporting |
| **Health** | Machine/equipment health signals |
| **Alerts** | Fault and event timeline |
| **Costing** | Fuel-cost estimator |
| **Pumps**, **Routes** | Per-pump and per-route detail views |

Cross-cutting: a top-bar vehicle switcher, a language switcher (English,
French, Irish, Danish, Swedish, German today), a printable PDF report, and
dark mode.

## Running it locally

From this folder:

```bash
npm install
npm run dev
```

Opens on **http://localhost:5173**. It expects the backend API running at
`127.0.0.1:8000` (see the backend's own setup) — `vite.config.js` proxies
`/api` and `/health` to it. Use `127.0.0.1`, not `localhost`, per the
Windows-networking note in the root `CLAUDE.md`.

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | Local dev server |
| `npm run build` | Production build — used by `frontend.Dockerfile` in deployment |
| `npm run preview` | Serves the last build, for a local check |

## Structure

```
frontend/
├── src/
│   ├── App.jsx              sidebar nav + page routing (NAV list)
│   ├── api.js                the one place that talks to the backend
│   ├── i18n.js                locale setup - LOCALES list drives the language switcher
│   ├── locales/               one JSON file per language, checked for full key parity
│   ├── pages/                 one file per page (*Page.jsx)
│   └── components/            shared widgets (map, gauges, charts, PDF report dialog, etc.)
└── vite.config.js             dev-server proxy config
```

## Notes

- Read-only client, no fabricated data anywhere — see CLAUDE.md's
  non-negotiables before adding anything that shows a number not backed by a
  real reading or a real derivation.
- The map shows real vehicle locations — this app is never deployed without
  authentication (see CLAUDE.md non-negotiable #1).
- Adding a language: add a locale JSON under `src/locales/`, import it and
  add it to `src/i18n.js`'s `LOCALES` array — nothing else needs to change.
  Keep every locale's keys in parity with `en-IE.json` (a missing key falls
  back to English automatically via `returnEmptyString: false`, but parity
  should still be verified, not relied on as a permanent state).
