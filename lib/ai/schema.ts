/**
 * Schema reference handed to the LLM as part of its system prompt.
 *
 * Keep this concise — every token costs money on every chat turn. Show the
 * shape of each table and the columns the model actually needs to answer
 * business questions. Skip raw_payload / created_at / updated_at unless they
 * matter for queries.
 */

export const SCHEMA_REFERENCE = `
TABLES (Postgres, all in public schema)

# page_view_events — every pixel hit
  id bigint, event_id text unique, event_name text (default 'PageView'),
  event_time timestamptz, page_url text, referrer text,
  fingerprint text, fbclid text, fbp text, fbc text,
  utm_source text, utm_medium text, utm_campaign text,
  utm_content text (= ad name), utm_term text (= adset name),
  client_ip inet, user_agent text, contact_id bigint (FK → ghl_contacts.id)

# ghl_contacts — leads from GoHighLevel webhooks
  id bigint, ghl_contact_id text unique, email text, first_name text, last_name text,
  phone text, utm_source text, utm_medium text, utm_campaign text,
  utm_content text, utm_term text, fbclid text, fingerprint text,
  first_seen_at timestamptz, opted_in_at timestamptz,
  notes text, lead_status text (new|contacted|qualified|unqualified|nurturing|closed_won|closed_lost),
  tags text[]

# ghl_pipeline_events — every lead lifecycle event
  id bigint, contact_id bigint (FK), event_name text in
    ('Lead','AppointmentBooked','AppointmentShown','OfferMade','Purchase','Churned'),
  event_time timestamptz, rep_id text, rep_name text, rep_email text,
  pipeline_stage text, deal_value numeric, currency text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text

# meta_ad_performance — daily ad-level spend + reach metrics
  date date, account_id text, campaign_id text, campaign_name text,
  adset_id text, adset_name text, ad_id text, ad_name text,
  spend numeric, impressions int, clicks int, reach int,
  frequency numeric, ctr numeric, cpc numeric, cpm numeric,
  meta_leads int, video_p3_watched int, effective_status text,
  unique (date, ad_id)

# ad_creatives — per-ad creative URLs (thumbnails, video, body, CTA)
  ad_id text PK, ad_name text, campaign_id text, adset_id text,
  thumbnail_url text, image_url text, video_id text, title text,
  body text, cta_type text, permalink_url text, fetched_at timestamptz

# sales_metrics — daily rep × day rollups
  date date, rep_id text, rep_name text,
  intro_calls int, live_intros int, offers_made int, closes int,
  collected numeric, unique (date, rep_id)

# monthly_kpi_snapshots — board-level rollup, one row per month
  month date, snapshot_type text ('actual' or 'scenario'),
  active_subscribers int, new_subscribers int, churned_subscribers int,
  churn_rate numeric, mrr numeric, mrr_growth numeric, mom_growth_pct numeric,
  ad_spend numeric, cac numeric, new_customers int, arpu numeric,
  revenue numeric, tech_cost numeric, setup_cost_total numeric,
  setter_cost_total numeric, csm_cost_total numeric, commission_total numeric,
  total_expenses numeric, profit_before_kd numeric, kd_share numeric,
  net_profit numeric, avg_tenure_months numeric, ltv numeric,
  ltv_cac_ratio numeric, payback_months numeric

# capi_event_log — Meta Conversions API send audit
  id bigint, event_id text, event_name text, event_time timestamptz,
  source text ('pixel'|'ghl_webhook'|...), contact_id bigint (FK),
  payload jsonb, response jsonb, sent_ok bool, attempts int, last_error text

# clients — paying customers (LTV tracking)
  id bigint, ghl_contact_id text unique, contact_id bigint (FK),
  status text ('active'|'at_risk'|'churned'|'paused'),
  started_at timestamptz, churned_at timestamptz,
  tenure_months numeric (computed),
  mrr_value numeric (default 297), last_payment_date date,
  attributed_campaign text, attributed_ad text, attributed_source text, rep_id text

# funnel_events — page-slug-level daily traffic (from GA4 cron)
  date date, page_slug text (vsl|optin|booking|thankyou), visitors int,
  unique (date, page_slug)

# expense_config — knobs for financials (tech cost, commission %, etc.)
  key text, scope text ('default'|'month'|'actual'),
  month date, value_numeric numeric, value_pct numeric, label text

# ai_model_runs — chat + projection history
  run_type text ('projection'|'scenario'|'anomaly'|'insight'|'chat'),
  prompt text, raw_response text, parsed_output jsonb,
  model text, tokens_in int, tokens_out int, cost_usd numeric

# cash_transactions — bank-fed ledger (when Tiller sync is on)
  txn_date date, description text, amount numeric, account text,
  category text, expense_key text

KEY RELATIONSHIPS
  • ghl_pipeline_events.contact_id → ghl_contacts.id
  • clients.contact_id              → ghl_contacts.id
  • capi_event_log.contact_id       → ghl_contacts.id
  • page_view_events.contact_id     → ghl_contacts.id (set after opt-in)
  • meta_ad_performance ⇄ ghl_pipeline_events: join on
      campaign_name = utm_campaign  AND  ad_name = utm_content
    Fall back via ghl_contacts.utm_campaign / utm_content if pipeline-event UTMs are null.

FUNNEL STAGES (event_name in ghl_pipeline_events)
  Lead → AppointmentBooked → AppointmentShown → OfferMade → Purchase → (Churned)
`.trim();
