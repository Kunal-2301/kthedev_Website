// Privacy-conscious analytics client.
// • No cookies, no localStorage identifiers, no fingerprinting in the browser.
// • Honors Do Not Track and Global Privacy Control (nothing is sent).
// • Disabled in draft preview and on localhost.
// The server derives a daily-rotating anonymous hash; see supabase/functions/track.
import { functionUrl } from '../core/supabase.js';
import { isConfigured } from '../config.js';
import { previewRequested } from '../core/content.js';

const optedOut = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const allowed = isConfigured() && !optedOut && !previewRequested && !local;
let enabled = false;

/** Follow the admin switch (Website settings → Analytics). Off = nothing is sent. */
export function setAnalyticsEnabled(on) { enabled = allowed && on === true; }

export function track(type, data = {}) {
  if (!enabled) return;
  const body = JSON.stringify({
    type,
    path: location.pathname,
    referrer: type === 'page_view' ? document.referrer : undefined,
    touch: navigator.maxTouchPoints > 1,
    ...data,
  });
  try {
    // text/plain keeps this a CORS "simple request" (no preflight).
    fetch(functionUrl('track'), { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } })
      .catch(() => {});
  } catch { /* never break the page for analytics */ }
}

/** Track each section once per page load when at least 40% is visible. */
const seen = new Set();
export function observeSections(root = document) {
  if (!enabled || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const id = e.target.dataset.section;
      if (e.isIntersecting && !seen.has(id)) { seen.add(id); track('section_view', { section: id }); io.unobserve(e.target); }
    }
  }, { threshold: 0.4 });
  root.querySelectorAll('[data-section]').forEach((el) => io.observe(el));
}

export function trackOutboundClicks() {
  if (!enabled) return;
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href^="http"]');
    if (!a) return;
    try {
      const u = new URL(a.href);
      if (u.hostname !== location.hostname && !u.pathname.includes('/functions/v1/')) track('outbound_click', { path: u.hostname });
    } catch { /* ignore */ }
  }, { capture: true });
}
