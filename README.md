# ISKAMDAR web app

Plain static site, no build step and no dependencies. Open `index.html` in a browser.

## Files

| File | What it is |
|---|---|
| `index.html` | Home: check form, features, how it works, FAQ |
| `result.html` | Verdict, risk gauge, "Learn more" dialog, tips |
| `report.html` | What we found, download / share, report to an agency |
| `about.html` | Framework, 8-step pipeline, team |
| `trends.html` | Warning signs (generated from the engine's own rule list) |
| `style.css` | All styling, shared by every page |
| `script.js` | All behavior, shared by every page |

Each page has its own header, footer and only the dialogs it uses. `<body data-page="...">` tells `script.js` which page it is on.

## How pages connect

- Checking a link or SMS (on `index.html` or `about.html`) saves the scan in `sessionStorage` and opens `result.html`.
- `result.html` and `report.html` read that scan. Opened with nothing scanned, `result.html` sends you back to `index.html` and `report.html` shows an empty state.
- A shared report is `report.html#r=<token>`. The token carries only the score, link host/path and flag ids. No message text and no name.

## Detection pipeline (`script.js`, section 3)

`routeInput` -> `analyzeText` -> `analyzeUrl` -> `scanPage` (optional) -> `scoreSignals`

Score = noisy-OR of the triggered signal weights, `1 - prod(1 - w)`, capped at 99. High >= 70, medium >= 40. Labels, weights and wording for every signal live in the `SIGNALS` catalogue, so the thesis evaluation can tune them in one place. `window.Iskamdar` exposes the engine for test harnesses.

## Connecting a backend

Both are off by default (`CONFIG` at the top of `script.js`).

**Page scan** (`pageScanEndpoint`): `POST { "url": "https://..." }` returns

```json
{ "signals": ["countdown_timer", "payment_request"],
  "evidence": { "pageAgeDays": 2, "registrar": "Masked" },
  "flagCount": 214 }
```

Accepted signal ids: `no_business_info`, `payment_request`, `hidden_redirect`, `copied_layout`, `countdown_timer`, `forced_signup`, `new_domain`. Unknown ids are ignored. `pageAgeDays < 30` adds `new_domain` automatically.

**Agency reports** (`reportEndpoint`): `POST { agency, score, level, input, urls, flags, note, createdAt }` returns `{ "reference": "ISK-PNP-48213" }`.

Until `reportEndpoint` is set the report flow runs in demo mode and the dialogs say that nothing was sent.
