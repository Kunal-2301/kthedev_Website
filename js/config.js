// =============================================================================
// Public runtime configuration — safe to commit.
//
// supabaseKey must be the PUBLISHABLE key (sb_publishable_...) or the legacy
// "anon" key. It is designed to be public: Row Level Security policies decide
// what it can read or write. NEVER put the service_role / secret key here.
// =============================================================================
export const CONFIG = Object.freeze({
  supabaseUrl: 'https://iiovxzzdkgznqdsaaiwx.supabase.co',
  supabaseKey: 'sb_publishable_ycPWsOLDKGiIJWbHp1hUzQ_lOG8zklM',

  // Public origin of the site (used for canonical URLs / structured data).
  siteUrl: 'https://www.kthedev.com',

  // Optional Cloudflare Turnstile site key for the contact form ('' = disabled).
  turnstileSiteKey: '',
});

export function isConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(CONFIG.supabaseUrl.replace(/\/$/, '')) &&
         !CONFIG.supabaseKey.startsWith('YOUR_') &&
         !/service_role|sb_secret_/.test(CONFIG.supabaseKey);
}
