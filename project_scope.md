# Mindtrip-Style AI Travel Planner — Project Scope

## 0) Executive Summary
We’re building a production-grade, Mindtrip.ai–inspired planner that lets users design trips conversationally, see structured itineraries on an interactive map/timeline, and deep-link to bookings with referral tracking. The MVP optimizes for **latency**, **cost control**, **data freshness**, **i18n (English + Hebrew)**, and **clean separations** between AI orchestration, third-party data, and the UI.

Core stack: **Next.js (App Router, TS)** + **Supabase (Auth, Postgres, RLS, pgvector)** + **LLM (pluggable, default: GPT-4o-mini / cost-efficient)** + **Maps (Mapbox/MapLibre)** + **Partner APIs** (Skyscanner/Amadeus, Booking.com/Hotels, Google Places).

---

## 1) Goals, Non-Goals, Success Criteria

### Goals (MVP)
- Conversational planning that produces **structured itineraries** (days, items, POIs, travel legs).
- **Actionable recommendations** from mixed sources (official APIs + cached POIs + user prefs).
- **Interactive map + timeline** with filters (interests, budget, kid-friendly, walking distance).
- **Booking deep-links** with referral/affiliate parameters.
- **Multilingual UI** (English + Hebrew, RTL), locale-aware dates/currency.
- **Cost/latency budgets**: median response < 3.5s for common queries; LLM <$0.05 per 10 turns.

### Non-Goals (MVP)
- Computer-vision “magic camera” (landmark recognition) → **V2**.
- Full pricing/availability parity with OTAs; we surface curated options + links.
- Offline mobile app.

### Success Criteria
- P50 chat-to-itinerary generation < 3.5s; P90 < 7s.
- >80% of test prompts yield valid, executable itineraries (schema-valid).
- <1% RLS/security violations in tests; 0 PII leaks in red-team prompts.

---

## 2) Product Surfaces & UX

### Primary Flows
1) **Onboarding** → Interests, constraints, budget, travelers (adults/kids), trip dates, cities.
2) **Chat** → User asks; assistant replies with both text + **structured plan deltas** (JSON).
3) **Itinerary Workspace**  
   - **Timeline** (Day 1..N) with items (POI visit, meal, transit).  
   - **Map** with clustered markers, live selection sync to timeline.  
   - **Edit**: drag-drop, reorder, replace, lock items, constraints auto-propagate.
4) **Booking Handoffs**  
   - Persistent **“Book”** panel with top choices (flights/hotels/activities) and referral links.
5) **Save/Share** → Save to account; export to PDF/ICS; share read-only link.

### Key UI Components
- `ChatPanel` (streamed tokens + tool call previews + retry)
- `ItineraryTimeline` (day columns, lock badges, conflicts)
- `MapCanvas` (MapLibre/Mapbox; markers by category; radius filters)
- `FiltersBar` (interests, budget, kid-friendly, open-now)
- `BookingPanel` (cards with price, rating, distance, “Open in …”)
- i18n toggle (EN/HE RTL switch), currency & units

### Empty/Error States
- No POIs → show “seed suggestions” + broaden radius.
- API rate-limited → degrade to cached POIs + explain freshness.
- Partial data → render placeholders with “fetch details” buttons.

---

## 3) System Architecture

```
client (Next.js / React)
  │
  ├─ /api/chat  ──>  Orchestrator (LLM + Tools Router)
  │                   ├─ Tool: search_pois (Google Places/POI Cache)
  │                   ├─ Tool: place_details (Google Places details/cache)
  │                   ├─ Tool: flights (Skyscanner/Amadeus)
  │                   ├─ Tool: stays (Booking.com/Hotels API)
  │                   ├─ Tool: routes (OSRM/Google Directions)
  │                   └─ Tool: weather (Open-Meteo)
  │
  ├─ /api/itineraries (CRUD)
  ├─ /api/bookings (deep-link generation)
  └─ /api/cache (warmers, invalidation)

Supabase (Postgres + RLS + pgvector)
  ├─ tables: users, profiles, trips, trip_days, trip_items, pois, poi_index, caches, vendors, bookings
  └─ functions: ensure_owner(), upsert_poi(), embed_poi()

Infra/Observability
  ├─ Vercel (Next) + Supabase managed
  ├─ Sentry (errors), PostHog (product analytics), OpenTelemetry traces
  └─ Upstash Redis (rate limiting + hot cache)
```

**LLM Orchestration Pattern**: single **planner** model using function-calling to invoke tools; tools return **strict JSON** payloads; orchestrator merges into itinerary graph; **validator** enforces schema & constraints.

---

## 4) Technical Requirements

### Core Tech Choices
- **Next.js 14+** (App Router, Server Actions), **TypeScript**.
- **Supabase**: Auth (email + OAuth), Postgres (RLS), **pgvector** for POI embeddings.
- **Maps**: MapLibre GL (open) with Mapbox tiles OR Mapbox GL; configurable via env.
- **LLM**: pluggable provider (OpenAI by default; model alias `PLANNER_MODEL`).
- **Partner APIs** (abstracted):
  - Flights: Skyscanner Partners or Amadeus Self-Service (choose 1 in `.env`)
  - Stays: Booking.com Affiliate or Rapid/Expedia (choose 1)
  - POIs: Google Places + local cache
  - Weather: Open-Meteo (no key)
  - Routing: OSRM (self-host or public) or Google Directions
- **Rate limiting**: Upstash Redis fixed-window per IP + per user.
- **i18n**: `next-intl`, **English + Hebrew (RTL)**, dayjs/Intl for dates.
- **Testing**: Vitest (units), Zod schema assertions, Playwright (E2E), Pact (API contracts).

### Security, Privacy, Compliance
- **RLS everywhere**; all trip rows bound to `auth.uid()`.
- **Minimal PII**: email, display name. No passport/payment data.
- **Secrets**: Vercel env vars + Supabase secrets. No secrets in client.
- **Logging**: redact emails, tokens, and full prompts beyond 2k chars (hash remainder).
- **Scraping**: use official APIs; if crawling, honor robots.txt; rotate UA; back off.
- **GDPR/CCPA posture**: export/delete my data endpoints; consent for analytics; cookie banner.

### Performance & Cost
- Streamed LLM responses; tool calls parallelized with timeouts + fallbacks.
- Aggressive caching: POI details (7d), search (24h), flight/hotel searches (short TTL, 10–30m).
- **Budget**: keep planner steps ≤ 3 tool rounds per user turn; prefer `gpt-4o-mini` unless high-confidence “complex planning” detected (then single `gpt-4o` pass).

---

## 5) Data Model (Supabase / SQL)

```sql
-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- Users via auth.users
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text default 'en',
  currency text default 'USD',
  interests text[] default '{}',
  created_at timestamptz default now()
);

create table public.trips (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  origin text,
  destinations text[] not null,
  start_date date,
  end_date date,
  party jsonb,             -- {adults:2,kids:1,ages:[9]}
  prefs jsonb,             -- {budget:'mid', tags:['food','nature'], pace:'easy'}
  locks jsonb,             -- {days:[1], items:[...]}
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.trip_days (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_index int not null,  -- 1..N
  note text
);

create type item_kind as enum ('poi','meal','transit','activity','lodging');
create table public.trip_items (
  id uuid primary key default uuid_generate_v4(),
  trip_day_id uuid not null references public.trip_days(id) on delete cascade,
  kind item_kind not null,
  start_ts timestamptz,
  end_ts timestamptz,
  poi_id uuid,             -- nullable for freeform items
  title text,
  details jsonb,           -- provider payload (read-safe subset)
  cost numeric,            -- approximate
  currency text default 'USD',
  locked boolean default false,
  order_index int not null default 0
);

-- POI cache + embeddings
create table public.pois (
  id uuid primary key default uuid_generate_v4(),
  provider text not null,            -- 'google'
  provider_id text not null,         -- place_id
  name text not null,
  location geography(point, 4326),
  address text,
  city text,
  country text,
  categories text[],
  rating numeric,
  user_ratings_total int,
  price_level int,
  open_hours jsonb,
  raw jsonb,                         -- full provider payload (restricted in RLS)
  updated_at timestamptz default now(),
  unique(provider, provider_id)
);

create table public.poi_index (
  poi_id uuid references public.pois(id) on delete cascade,
  lang text not null,                -- 'en','he'
  embedding vector(1536),
  primary key(poi_id, lang)
);

-- Vendor + bookings (deep links only)
create table public.vendors (
  id serial primary key,
  kind text not null,                -- 'flights','stays','activities'
  name text not null,
  affiliate_key text,                -- stored server-side only
  enabled boolean default true
);

create table public.bookings (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid references public.trips(id) on delete cascade,
  item_id uuid references public.trip_items(id) on delete set null,
  vendor_id int references public.vendors(id),
  deeplink text,                     -- generated URL
  created_at timestamptz default now()
);
```

**RLS (sketch):**
```sql
alter table public.profiles enable row level security;
create policy "own_profile" on public.profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.trips enable row level security;
create policy "own_trip" on public.trips
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.trip_days enable row level security;
create policy "via_trip" on public.trip_days
  for all using (exists(select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists(select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

alter table public.trip_items enable row level security;
create policy "via_trip" on public.trip_items
  for all using (exists(select 1 from public.trip_days d join public.trips t on t.id = d.trip_id
                        where d.id = trip_day_id and t.user_id = auth.uid()))
  with check (exists(select 1 from public.trip_days d join public.trips t on t.id = d.trip_id
                        where d.id = trip_day_id and t.user_id = auth.uid()));
```

---

## 6) API Contracts (strict)

All responses **must** satisfy Zod schemas.

**/api/chat (POST)**  
Input:
```json
{
  "tripId": "uuid | null",
  "message": "string",
  "locale": "en|he",
  "timezone": "IANA tz",
  "currency": "ISO code"
}
```
Output:
```json
{
  "text": "string (assistant message)",
  "ops": [
    { "op": "upsert_trip", "trip": Trip },
    { "op": "add_day", "day": TripDay },
    { "op": "add_item", "dayId": "uuid", "item": TripItem },
    { "op": "replace_item", "itemId": "uuid", "item": TripItem },
    { "op": "delete_item", "itemId": "uuid" }
  ],
  "tool_traces": [{ "tool":"search_pois","latency_ms":123, "cache":"hit|miss" }]
}
```

**/api/itineraries (GET/POST/PATCH/DELETE)**  
- CRUD with RLS; PATCH supports partial updates; returns `Trip` with `days[]` & `items[]`.

**/api/tools/search-pois (POST)**  
Input: `{ "where": {"lat": number, "lng": number, "radius_m": number}, "query": "text", "categories": ["museum","park"], "locale": "en|he" }`  
Output: `{ "pois": [ POI ] }`

**/api/bookings/deeplink (POST)**  
Input: `{ "vendor":"flights|stays|activities", "payload":{...}, "tripId":"uuid", "itemId":"uuid|null" }`  
Output: `{ "url":"https://..." }`

---

## 7) LLM Orchestration

### System Prompt (EN, programmatic; mirrored HE locale)
- Role: “You are a **travel planner**. Output **both** natural language and **tool calls** to build/modify a **valid itinerary graph**. Respect constraints (budget, pace, kids). Prefer walking time ≤ 20 min between consecutive items unless locked.”
- Content policy: “Decline non-travel topics. If asked, steer back to trip planning.”
- Tool schema: JSON function definitions for `search_pois`, `place_details`, `flights`, `stays`, `routes`, `weather`.
- Output policy: First attempt **tool calls**; then summarize **diff**; never hallucinate prices—return ranges or call a tool.

### Planner Loop
1) Parse user turn → **Constraint state** (zod).
2) Ask LLM with function calling enabled.
3) Execute tool calls **in parallel** with timeouts.
4) Validate results (zod), coerce into canonical `Trip/TripItem`.
5) Merge into DB (server action), emit `ops[]` to UI.
6) Stream assistant summary as tokens arrive.

### Guardrails
- Topic firewall (regex + classifier) → refuse non-travel.
- Max 3 planner rounds per turn; if still ambiguous → ask 1 clarifying Q with options.
- Price hallucination detector: if tool miss & “exact price” asked → return “from $X–$Y” + “Check availability”.

---

## 8) Caching & Freshness

- **POI Search**: 24h TTL keyed by `{query|bbox|locale}`; **details**: 7d TTL.
- **Flights/Hotels**: 10–30m TTL keyed by `{origin,dest,dates,party}`; include “quoted_at”.
- **Weather/Routes**: 1–6h TTL; fallback to previous cached value with `stale-while-revalidate`.
- **Embeddings**: store in `poi_index`; cosine search for semantic POI retrieval.

---

## 9) i18n & RTL

- `next-intl` with namespaces: `common`, `chat`, `itinerary`, `bookings`.
- Hebrew RTL: `dir="rtl"` toggle; bidi-safe numerals; moment/dayjs or Intl for formats.
- Content: Model prompted to answer in user locale; **tools always return canonical (en) fields** plus `localized_name/desc` if provider supports.

---

## 10) Directory Layout

```
/app
  /[locale]/(routes)
    page.tsx                # chat+workspace shell
    layout.tsx
  /api
    /chat/route.ts
    /itineraries/route.ts
    /tools/search-pois/route.ts
    /bookings/deeplink/route.ts
/components
  ChatPanel.tsx
  ItineraryTimeline.tsx
  MapCanvas.tsx
  FiltersBar.tsx
  BookingPanel.tsx
/lib
  supabase.ts
  auth.ts
  llm.ts                  # provider-agnostic client
  tools.ts                # tool executors + zod schemas
  schemas.ts              # Trip/POI zod
  cache.ts                # Redis helpers
  i18n.ts
  vendors.ts              # affiliate config
/styles
/tests
  e2e/
  unit/
  contracts/
```

---

## 11) Implementation Plan (Phased, with Definition of Done)

### Phase 0 — Foundations (1–2 days)
- [ ] Next.js TS app, App Router, strict ESLint/Prettier.
- [ ] Supabase project; enable RLS; run migrations above; seed `vendors`.
- [ ] Auth flow (email OTP); `profiles` on sign-up.
- [ ] Env plumbing: `.env.local`, runtime checks for required keys.
**DoD**: Can sign up, create empty trip row via `/api/itineraries`.

### Phase 1 — Schemas, Orchestrator, Tools (3–5 days)
- [ ] Zod schemas for `Trip`, `TripDay`, `TripItem`, `POI`.
- [ ] `llm.ts` model abstraction (OpenAI default); streaming support.
- [ ] Tool executors (`tools.ts`) with zod I/O; Redis caching.
- [ ] `/api/chat`: planner loop + function calling + merge ops.
- [ ] POI cache & embeddings pipeline (`poi_index`); upsert on details fetch.
**DoD**: Given “3 days in Kyoto with kids”, returns valid itinerary ops + renders on UI.

### Phase 2 — UI/UX Surfaces (3–4 days)
- [ ] `ChatPanel` with stream + retry.
- [ ] `ItineraryTimeline`: day columns, add/drag/remove, lock.
- [ ] `MapCanvas` with markers, selection sync, category filters.
- [ ] `BookingPanel` stubbed with sample deep links.
**DoD**: Visible synchronized map/timeline; edits persist to DB.

### Phase 3 — Bookings & Affiliates (2–3 days)
- [ ] Integrate one flight provider (Skyscanner or Amadeus).
- [ ] Integrate one stays provider (Booking.com/Expedia).
- [ ] `/api/bookings/deeplink` builds URLs with tracking params; logs `bookings`.
**DoD**: Clicking “Book” opens vendor page with affiliate tags for top itinerary items.

### Phase 4 — i18n/RTL & Polishing (2 days)
- [ ] `next-intl` with EN/HE; RTL styles.
- [ ] Locale-aware currency/units; user preference in `profiles`.
- [ ] Empty/error states, skeletons, toasts.
**DoD**: Full app usable in Hebrew RTL with correct formatting.

### Phase 5 — Testing, Observability, Hardening (2–3 days)
- [ ] Vitest unit tests (schemas, tools) 80%+ coverage on critical paths.
- [ ] Playwright E2E: onboarding → plan → edit → book.
- [ ] Sentry + PostHog + basic OTEL traces around `/api/chat`.
- [ ] Rate limiting; abuse protection; payload size caps; redaction on logs.
**DoD**: Green test suite; no secrets/PII in logs; rate limits verified.

---

## 12) Acceptance Tests (Representative)

- **AT-01**: “4 days in Osaka, kids 9/11, budget mid, near Namba.”  
  Result: 4 days, 3–5 items/day, walking distances sane, 2 meal slots/day, kid tags present.
- **AT-02**: Switch to **Hebrew**; all UI RTL; chat replies in Hebrew; itinerary items translated name/desc when available.
- **AT-03**: Remove Day 2 lunch; planner fills alternative nearby option on request.
- **AT-04**: Flights tool rate-limited → fallback: cached quotes + disclaimer banner.
- **AT-05**: Booking deep link contains affiliate key; record created in `bookings`.

---

## 13) Observability & Ops

- **Sentry**: capture exceptions; tag by route & userId hash.
- **PostHog**: track funnel (onboard → first itinerary → first click “Book”).
- **Feature flags**: kill-switch for each provider via `vendors.enabled`.
- **Backfills**: nightly POI refresh for popular cities (cron on Vercel/Supabase).

---

## 14) Environment Variables (`.env.local`)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE=            # server-only, never shipped to client

# LLM
LLM_PROVIDER=openai
OPENAI_API_KEY=
PLANNER_MODEL=gpt-4o-mini         # override per env

# Redis (rate limit + cache)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Maps
MAP_STYLE_URL=                    # mapbox://styles/... or blank for MapLibre
NEXT_PUBLIC_MAPBOX_TOKEN=

# Google Places (POIs)
GOOGLE_MAPS_API_KEY=

# Flights
FLIGHTS_PROVIDER=skyscanner|amadeus
SKYSCANNER_API_KEY=
AMADEUS_API_KEY=
AMADEUS_API_SECRET=

# Stays
STAYS_PROVIDER=booking|expedia
BOOKING_AFFILIATE_ID=
EXPEDIA_API_KEY=

# Routing/Weather
OSRM_BASE_URL=                    # optional; else Google Directions via key
```

---

## 15) Risks & Mitigations

- **API quota/rate limits** → Upfront budget checks, caching, vendor kill-switch.
- **LLM hallucinations** → Tool-first policy, schema validators, explicit disclaimers on price.
- **Costs** → Minimize high-end model calls; cache hits target ≥60% on POI details.
- **Data freshness** → TTLs per domain + “last updated” stamps in UI.
- **RTL regressions** → Snapshot tests for Hebrew layouts.

---

## 16) V2 Roadmap (post-MVP)

- CV “Magic Camera” landmark detection (upload → suggest nearby plan inserts).
- Collaborative planning (multi-user cursors + comments).
- Availability-aware planning (booking API holds, price alerts).
- Offline bundle/export; mobile wrapper.

---

## 17) Developer Tasks for Cursor (granular)

> Create branches per phase. For each task, produce code + tests and open a PR. Follow Zod schemas strictly; no schema drift without migration.

1. **Bootstrap App**  
   - Scaffold Next.js/TS, App Router, ESLint; add `supabase.ts`, auth hooks, `profiles` creation.
2. **DB & RLS**  
   - Apply SQL above; add migration scripts; write RLS policies + tests (Vitest with PostgREST).
3. **Schemas & Utils**  
   - Implement `schemas.ts` (zod) for all entities; write 30+ unit tests with edge cases.
4. **LLM Abstraction**  
   - `llm.ts` with stream; provider switch (OpenAI now); function-calling helper.
5. **Tools Layer**  
   - `tools.ts`: search_pois/place_details/flights/stays/routes/weather; Redis cache; zod I/O; retries.
6. **Planner Orchestrator**  
   - `/api/chat` server route with loop, parallel tool exec, merge ops, streaming.
7. **UI Core**  
   - `ChatPanel`, `ItineraryTimeline`, `MapCanvas`, `FiltersBar`, `BookingPanel`.
8. **Bookings**  
   - `/api/bookings/deeplink`; vendor adapters; log to `bookings`.
9. **i18n/RTL**  
   - `next-intl` setup; EN/HE JSON; RTL styles; locale switch persisting to `profiles`.
10. **Testing**  
   - Playwright: AT-01..05; Pact tests for providers (mocked); coverage badge.
11. **Observability**  
   - Sentry + PostHog wiring; OTEL spans in tools + orchestrator.

---

## 18) Definition of Done (Global)

- ✅ All endpoints validated by zod + typed client; E2E green (AT-01..05).  
- ✅ RLS verified; unauthorized access attempts fail in tests.  
- ✅ LLM outputs never directly persisted without schema validation.  
- ✅ Hebrew RTL passes visual snapshots; numbers/dates localized.  
- ✅ No secrets in client bundle; logging redacts sensitive data.  
- ✅ Benchmarks: P50 <3.5s on “city 3-day plan” with warm caches.

---

## 19) Sample Type Signatures (TS/Zod)

```ts
export const Poi = z.object({
  id: z.string().uuid(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  categories: z.array(z.string()).default([]),
  rating: z.number().min(0).max(5).nullable(),
  priceLevel: z.number().int().min(0).max(4).nullable()
});
export type Poi = z.infer<typeof Poi>;

export const TripItem = z.object({
  id: z.string().uuid(),
  kind: z.enum(['poi','meal','transit','activity','lodging']),
  title: z.string(),
  startTs: z.string().datetime().nullable(),
  endTs: z.string().datetime().nullable(),
  poiId: z.string().uuid().nullable(),
  details: z.record(z.any()).default({}),
  cost: z.number().nullable(),
  currency: z.string().default('USD'),
  locked: z.boolean().default(false),
  orderIndex: z.number().int().default(0)
});
```

---

## 20) Prompt Snippets (EN/HE)

**System (EN)**:
> You are an expert travel planner. Use tool calls to gather factual data. Produce structured itinerary ops that minimize walking time, respect opening hours, and align with user constraints. Do not invent prices; when unavailable, return ranges and recommend checking availability.

**User-content preface (HE)**:
> השב/י בעברית. תן/ני המלצות שמתאימות לילדים (אם צויין), תעדף/י מרחקי הליכה קצרים ותחבורה ציבורית. השתמש/י בכלים לקבלת נתונים מדויקים.

---

## 21) Licensing & Third-Party Terms (Heads-Up)
- Google Places, Skyscanner/Amadeus, Booking/Expedia require compliance with branding and usage terms; store only permitted fields; avoid client-side exposure of raw payloads.

---
