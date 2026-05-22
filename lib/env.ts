/**
 * Typed env access. Throws at *use* time, not at import time, so build
 * succeeds even when some env vars aren't set yet.
 */

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function optionalEnv(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== '' ? v : undefined;
}

export const env = {
  // Supabase
  supabaseUrl:        () => requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey:    () => requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceKey: () => requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  // Auth
  sessionSecret:      () => requireEnv('SESSION_SECRET'),
  dashboardPassword:  () => requireEnv('DASHBOARD_PASSWORD'),
  financialsPassword: () => requireEnv('FINANCIALS_PASSWORD'),

  // Meta
  metaPixelId:        () => optionalEnv('META_PIXEL_ID'),
  metaAccessToken:    () => optionalEnv('META_ACCESS_TOKEN'),
  metaAdAccountId:    () => optionalEnv('META_AD_ACCOUNT_ID'),
  metaTestEventCode:  () => optionalEnv('META_TEST_EVENT_CODE'),

  // GHL
  ghlApiKey:          () => optionalEnv('GHL_API_KEY'),
  ghlLocationId:      () => optionalEnv('GHL_LOCATION_ID'),
  ghlWebhookSecret:   () => optionalEnv('GHL_WEBHOOK_SECRET'),

  // GA4 (funnel page-view metrics — service-account auth)
  ga4PropertyId:        () => optionalEnv('GA4_PROPERTY_ID'),
  ga4ServiceAccountKey: () => optionalEnv('GA4_SERVICE_ACCOUNT_KEY'),

  // AI
  anthropicApiKey:    () => optionalEnv('ANTHROPIC_API_KEY'),
  openrouterApiKey:   () => optionalEnv('OPENROUTER_API_KEY'),
  openrouterModel:    () => optionalEnv('OPENROUTER_MODEL') || 'anthropic/claude-sonnet-4.5',

  // Misc
  nodeEnv:            () => process.env.NODE_ENV || 'development',
  isProd:             () => process.env.NODE_ENV === 'production',
};

/**
 * Safe pre-flight check used by health endpoint and login pages so we can
 * surface "env not configured" instead of crashing on first request.
 */
export function envStatus() {
  return {
    supabase:
      !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    auth:
      !!process.env.SESSION_SECRET &&
      !!process.env.DASHBOARD_PASSWORD &&
      !!process.env.FINANCIALS_PASSWORD,
    metaCapi: !!process.env.META_PIXEL_ID && !!process.env.META_ACCESS_TOKEN,
    ghlWebhook: !!process.env.GHL_WEBHOOK_SECRET,
    ga4: !!process.env.GA4_PROPERTY_ID && !!process.env.GA4_SERVICE_ACCOUNT_KEY,
    aiChat: !!process.env.OPENROUTER_API_KEY,
  };
}
