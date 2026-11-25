// Pure, dependency-free logic shared by Edge Functions (Deno) and unit tests (Node).

export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max + 1) : '');

/** Validate a contact form payload. Returns { ok, errors, value, spam }. */
export function validateContact(body) {
  const errors = {};
  if (!body || typeof body !== 'object') return { ok: false, errors: { form: 'Invalid request.' } };

  const value = {
    name: clean(body.name, 100),
    email: clean(body.email, 254).toLowerCase(),
    subject: clean(body.subject, 200),
    message: clean(body.message, 5000),
  };
  if (!value.name) errors.name = 'Please enter your name.';
  else if (value.name.length > 100) errors.name = 'Name must be 100 characters or fewer.';
  if (!EMAIL_RE.test(value.email) || value.email.length > 254) errors.email = 'Please enter a valid email address.';
  if (value.subject.length > 200) errors.subject = 'Subject must be 200 characters or fewer.';
  if (value.message.length < 10) errors.message = 'Message must be at least 10 characters.';
  else if (value.message.length > 5000) errors.message = 'Message must be 5,000 characters or fewer.';

  // Spam signals: honeypot field filled, or submitted implausibly fast.
  const honeypot = typeof body.company === 'string' && body.company.trim() !== '';
  const elapsed = Number(body.elapsed_ms);
  const tooFast = Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 2500;
  const linkCount = (value.message.match(/https?:\/\//gi) || []).length;
  const spam = honeypot || tooFast || linkCount > 5;

  return { ok: Object.keys(errors).length === 0, errors, value, spam };
}

const BOT_RE = /bot|crawler|spider|crawling|headless|lighthouse|preview|facebookexternalhit|slurp|bingpreview|curl|wget|python-requests|httpclient/i;

export function isBot(ua) {
  return !ua || BOT_RE.test(ua);
}

export function deviceFromUA(ua = '') {
  if (!ua) return 'unknown';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  // iPadOS 13+ reports as Macintosh; the client sends a touch hint for that case.
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** External referrer host, or null for direct / same-site traffic. */
export function referrerHost(referrer, siteHosts = []) {
  if (!referrer || typeof referrer !== 'string') return null;
  try {
    const u = new URL(referrer);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, '').toLowerCase().slice(0, 255);
    if (siteHosts.map((h) => h.replace(/^www\./, '').toLowerCase()).includes(host)) return null;
    return host;
  } catch {
    return null;
  }
}

const EVENT_TYPES = new Set(['page_view', 'section_view', 'project_view', 'outbound_click']);
const SECTIONS = new Set(['hero', 'about', 'skills', 'projects', 'experience', 'education', 'certifications', 'contact']);

/** Validate an analytics beacon. Only whitelisted, non-personal fields survive. */
export function validateEvent(body) {
  if (!body || typeof body !== 'object' || !EVENT_TYPES.has(body.type)) return null;
  const path = typeof body.path === 'string' ? body.path.split(/[?#]/)[0].slice(0, 300) : null;
  const section = SECTIONS.has(body.section) ? body.section : null;
  const slug = typeof body.slug === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.slug) ? body.slug.slice(0, 120) : null;
  if (body.type === 'section_view' && !section) return null;
  if (body.type === 'project_view' && !slug) return null;
  return { event_type: body.type, path, section, project_slug: slug };
}

export function safeFileName(title, fallback = 'resume') {
  const base = String(title || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 80);
  return `${base || fallback}.pdf`;
}
