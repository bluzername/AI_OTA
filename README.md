# AI_OTA

A static, client-side travel itinerary planner MVP ("Mindtrip Lite"). It runs entirely in the browser from a bundled JSON file of sample points of interest. There is no backend, no database and no AI/LLM call in the current code; the "AI" in the name is the direction, not the implementation.

Live: https://bluzername.github.io/AI_OTA/ (the root `index.html` redirects to `mvp-web/index.html`).

## What it does today

- Pick a city (Kyoto or Osaka), a date range, interests, and a pace, then press Generate Itinerary.
- A greedy heuristic in `mvp-web/app.js` builds one list of POIs per day:
  - POIs are filtered by the selected interests; the Kids interest additionally requires `kidFriendly: true`. If nothing matches, the app shows an empty-state notice and falls back to the top-rated POIs.
  - Pace sets the number of POIs per day: easy 3, balanced 4, packed 5.
  - Within a day, hops longer than 3.5 km (haversine) are skipped and at most two POIs per category are taken; leftover slots are filled with any unused POI.
- The timeline shows each stop with an estimated walk from the previous stop (haversine distance at 4.5 km/h). Hovering a stop flies the map to it.
- The map is MapLibre GL JS with the public MapLibre demo tiles style and a marker per stop.
- Export JSON (the internal plan object) and Export ICS (one all-day event per stop) are generated in the browser and downloaded.
- Book links are plain deep links to a Google Flights search and a Booking.com search for the city name. No affiliate or referral parameters.
- UI is bilingual: English and Hebrew (RTL), toggled in the header and remembered in `localStorage`.

## Known limitations

- The Budget selector is rendered but not used by the planner.
- Data is sample-only: 15 hand-written POIs across two cities. Ratings are illustrative.
- Walking times are straight-line estimates, not routed.
- The map style is the MapLibre demo tiles (low detail, not for production use).
- Dates only drive the number of days; opening hours, seasons and transit are not modelled.
- No persistence beyond the language choice; refreshing the page clears the plan.

## Run locally

`app.js` fetches `./data/pois.json`, so the files must be served over HTTP. Opening `index.html` from the file system will not work.

```bash
python3 -m http.server 8000
# then open http://localhost:8000/  (or http://localhost:8000/mvp-web/index.html)
```

Any static file server works. MapLibre and the demo map tiles are loaded from the network, so the map needs internet access.

## Project layout

| Path | Purpose |
|---|---|
| `index.html` | Meta-refresh redirect to `mvp-web/index.html` for GitHub Pages. |
| `mvp-web/index.html` | The app shell: controls, timeline, map, footer. Loads MapLibre from unpkg (pinned, with SRI). |
| `mvp-web/app.js` | Data loading, interest filtering, the day-planning heuristic, timeline rendering, exports, booking links. |
| `mvp-web/map.js` | Thin wrapper around MapLibre: init, markers, flyTo, setCenter. Exposed as `window.MapView`. |
| `mvp-web/i18n.js` | English and Hebrew strings, `data-i18n` substitution, RTL switch. Exposed as `window.I18N`. |
| `mvp-web/styles.css` | Layout and theme, including the mobile breakpoint. |
| `mvp-web/data/pois.json` | All city and POI data. |
| `scripts/validate_pois.py` | Schema check for `pois.json` (stdlib only). Run by CI. |
| `project_scope.md` | Long-form product plan for a future version. See Roadmap below. |

## Data format (`mvp-web/data/pois.json`)

```json
{
  "cities": {
    "kyoto": {
      "displayName": "Kyoto",
      "center": { "lat": 35.0116, "lng": 135.7681 },
      "pois": [
        {
          "id": "kyoto_fushimi",
          "name": "Fushimi Inari Taisha",
          "lat": 35.0260,
          "lng": 135.7808,
          "category": "culture",
          "rating": 4.8,
          "kidFriendly": true
        }
      ]
    }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| city key | string | Must match the `<option value>` in the city select. |
| `displayName` | string | Shown in the UI and used for the booking search links. |
| `center.lat`, `center.lng` | number | Initial map center. |
| `pois[].id` | string | Unique across all cities. Used for de-duplication and in exports. |
| `pois[].name` | string | Displayed in the timeline and map popup. |
| `pois[].lat`, `pois[].lng` | number | WGS84. Drive distance and walk-time estimates. |
| `pois[].category` | string | One of `culture`, `food`, `nature`, `shopping`, `kids`. Matched against the interest checkboxes. |
| `pois[].rating` | number | 0 to 5. Used only for the empty-state fallback ordering. |
| `pois[].kidFriendly` | boolean | Required to be `true` when the Kids interest is selected. |

POI order in the file matters: the planner walks the list top to bottom, so put the most important POIs first.

## Adding a city

1. Add a new key under `cities` in `mvp-web/data/pois.json` with `displayName`, `center` and at least one POI (ids must be unique across the whole file).
2. Add a matching `<option value="your_key">Your City</option>` to the `#citySelect` element in `mvp-web/index.html`.
3. Run `python3 scripts/validate_pois.py` and load the page locally to confirm.

## Internationalisation

- All translatable strings live in `STRINGS.en` and `STRINGS.he` in `mvp-web/i18n.js`.
- Static markup is translated through `data-i18n="key"` attributes; runtime strings use `I18N.t('key')`, which falls back to English and then to the key itself.
- Switching to Hebrew sets `lang="he"` and `dir="rtl"` on `<html>`; the choice is stored under the `locale` key in `localStorage`.
- The header toggle only alternates between `en` and `he`. Adding a third language needs a new dictionary and a change to the toggle logic in `initLocale`.

## Checks and CI

There is no build step and no test suite. The checks that exist are syntax and data validation, and CI runs exactly these on pushes to `main` and on pull requests (`.github/workflows/ci.yml`):

```bash
for f in mvp-web/*.js; do node --check "$f"; done   # JS syntax
python3 -m json.tool mvp-web/data/pois.json > /dev/null  # JSON syntax
python3 scripts/validate_pois.py                    # POI schema, id uniqueness, coordinate ranges
```

Dependabot is configured for GitHub Actions only; there is no `package.json` and no npm dependency tree.

## Dependencies

- MapLibre GL JS 5.24.0, loaded from unpkg with Subresource Integrity hashes in `mvp-web/index.html`. 5.24.0 is the last release that ships the UMD `dist/maplibre-gl.js` bundle; 6.x is ESM-only and would require converting `map.js` to a module before upgrading.
- Map style and tiles: `https://demotiles.maplibre.org/style.json` (public demo, no key).
- Everything else is vanilla HTML, CSS and JavaScript.

## Roadmap

`project_scope.md` describes a planned Next.js + Supabase + LLM product with conversational planning, partner booking APIs and affiliate tracking. That document is a future plan and does not describe the current code. None of its backend, auth, database or AI components exist in this repository yet.

## License

MIT, see `LICENSE`.
