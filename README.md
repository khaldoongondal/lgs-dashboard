# LGS Growth Dashboard

Three-layer marketing + sales + financial dashboard for HVAC lead-gen. Built on Next.js 14 + Supabase + Vercel. FinTracker light UI.

## Layers

1. **Ad Attribution** (`/dashboard`) — Sources → Campaigns → Medium → Ads drill-down. Meta Ads spend joined to GHL pipeline outcomes via UTM + fbclid + (eventually) ThumbmarkJS fingerprint.
2. **Sales Pipeline** (`/sales`) — One-call close funnel per rep, with team total and team avg rows.
3. **Business Metrics / Margin** (`/financials`) — MRR, expenses, KD share, net profit, LTV, CAC, payback. Behind a **second** password.

## First-time setup

```bash
# 1. Install
npm install

# 2. Env
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET, DASHBOARD_PASSWORD, FINANCIALS_PASSWORD

# 3. Schema
# In Supabase Dashboard → SQL Editor → paste contents of db/schema.sql → Run

# 4. Dev
npm run dev
```

Then open <http://localhost:3000>.

## Routes

| Path | Auth |
|---|---|
| `/login` | none (sets `lgs_auth` cookie) |
| `/dashboard` | `lgs_auth` |
| `/sales` | `lgs_auth` |
| `/settings` | `lgs_auth` |
| `/financials/login` | `lgs_auth` (sets `lgs_financials_auth` on top) |
| `/financials` | `lgs_auth` **AND** `lgs_financials_auth` |
| `POST /api/events` | none (browser pixel) |
| `POST /api/webhooks/ghl` | HMAC via `GHL_WEBHOOK_SECRET` |

## What's wired

- ✅ Two-tier cookie auth (HMAC-signed, Edge-runtime middleware)
- ✅ Supabase server/browser clients (`@supabase/ssr`)
- ✅ Meta CAPI sender ported from Evernude, 4 event types (Lead / Schedule / AppointmentShown / Purchase) + automatic retry queue stub
- ✅ GHL webhook receiver with HMAC verification
- ✅ Browser pixel: `public/pixel.js` captures fbclid + UTMs + sends ContentView
- ✅ Sidebar nav, FinTracker light cards, date-range picker on every page
- ✅ Three layer pages with placeholder data (queries Supabase if env is set)
- ✅ 12-table SQL schema in `db/schema.sql`

## What's stubbed (build next)

- Meta Ads API sync (cron → `meta_ad_performance`)
- ThumbmarkJS fingerprint capture in `public/pixel.js`
- Tiller / Google Sheets cash sync
- AI modeling endpoints (projections, scenarios, anomalies)
- Real GHL workflow → 4 outbound webhooks → 4 CAPI sends

## Stack

- Next.js 14 App Router, TypeScript, Tailwind
- Supabase (Postgres) — schema in `db/schema.sql`
- HMAC-signed httpOnly session cookies (no third-party auth dep)
- Edge middleware for route gating
- `_reference-evernude/` (gitignored) — buddy's Shopify CAPI relay kept for pattern reference
