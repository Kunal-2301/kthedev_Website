// Supabase clients. Requires js/vendor/supabase.js (UMD → window.supabase).
import { CONFIG } from '../config.js';

let _public = null;
let _auth = null;

/**
 * Anonymous client for the public site. It never attaches a user session, so
 * even when an admin is signed in on the same origin, the public pages are
 * fetched exactly as a visitor would see them (published content only).
 */
export function publicClient() {
  if (!_public) {
    _public = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'kg-public' },
    });
  }
  return _public;
}

/** Session-aware client used by the admin dashboard and draft previews. */
export function authClient({ detectSessionInUrl = false } = {}) {
  if (!_auth) {
    _auth = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl, flowType: 'pkce', storageKey: 'kg-admin-auth' },
    });
  }
  return _auth;
}

export function publicUrl(bucket, path) {
  if (!path) return null;
  const clean = String(path).split('/').map(encodeURIComponent).join('/');
  return `${CONFIG.supabaseUrl}/storage/v1/object/public/${bucket}/${clean}`;
}

export const functionUrl = (name) => `${CONFIG.supabaseUrl}/functions/v1/${name}`;
