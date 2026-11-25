// Public content API. All portfolio content comes from Supabase at runtime —
// publishing in /admin updates the site without a GitHub deployment.
//
// Modes
//  • public  : anonymous client → RLS returns published rows only.
//  • preview : ?preview=1 AND a signed-in administrator → drafts + unpublished
//              profile/settings edits are overlaid. Non-admins silently get the
//              public view; drafts are never reachable through anonymous access.
import { publicClient, authClient } from './supabase.js';
import { isConfigured } from '../config.js';

export const previewRequested = new URLSearchParams(location.search).get('preview') === '1';

const CACHE_KEY = 'kg:site:v2';
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

const PROJECT_CARD_COLS = 'id, slug, title, short_description, category, project_status, cover_image_path, cover_alt, ' +
  'github_url, demo_url, docs_url, metrics, is_featured, sort_order, status, publish_at, ' +
  'project_technologies(sort_order, skill:skills(id, name))';

export class ContentError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let _ctx = null;
async function context() {
  if (_ctx) return _ctx;
  _ctx = (async () => {
    if (!isConfigured()) throw new ContentError('not_configured', 'Supabase is not configured yet. Edit js/config.js.');
    if (previewRequested) {
      try {
        const db = authClient();
        const { data } = await db.auth.getSession();
        if (data.session) {
          const { data: ok } = await db.rpc('is_admin');
          if (ok === true) return { db, preview: true };
        }
      } catch { /* fall through to public */ }
    }
    return { db: publicClient(), preview: false };
  })();
  return _ctx;
}

function unwrap(res, what) {
  if (res.error) throw new ContentError('query_failed', `${what}: ${res.error.message}`);
  return res.data;
}

const techList = (p) => (p.project_technologies || [])
  .sort((a, b) => a.sort_order - b.sort_order)
  .map((t) => t.skill).filter(Boolean);

function normalizeProject(p) {
  return { ...p, technologies: techList(p), project_technologies: undefined };
}

async function fetchSiteFresh() {
  const { db, preview } = await context();
  const notArchived = (q) => (preview ? q.neq('status', 'archived') : q);

  const [profile, settings, nav, cats, skills, projects, experience, education, certifications, resume, drafts] =
    await Promise.all([
      db.from('profiles').select('*').eq('id', 1).maybeSingle(),
      db.from('site_settings').select('*').eq('id', 1).maybeSingle(),
      db.from('nav_items').select('id, location, label, target_type, section_key, url, icon, sort_order, is_visible').order('sort_order'),
      db.from('skill_categories').select('id, name, slug, description, sort_order, is_visible').order('sort_order'),
      db.from('skills').select('id, category_id, name, description, icon_path, level, sort_order, is_visible').order('sort_order'),
      notArchived(db.from('projects').select(PROJECT_CARD_COLS)).order('is_featured', { ascending: false }).order('sort_order'),
      notArchived(db.from('experience').select('*')).order('sort_order'),
      notArchived(db.from('education').select('*')).order('sort_order'),
      notArchived(db.from('certifications').select('*')).order('sort_order'),
      db.from('resumes').select('id, title').eq('is_default', true).eq('is_active', true).maybeSingle(),
      preview ? db.from('content_drafts').select('entity_type, data') : Promise.resolve({ data: [] }),
    ]);

  const draftMap = Object.fromEntries((unwrap(drafts, 'drafts') || []).map((d) => [d.entity_type, d.data]));
  const site = {
    preview,
    profile: { ...(unwrap(profile, 'profile') || {}), ...(draftMap.profile || {}) },
    settings: { ...(unwrap(settings, 'settings') || {}), ...(draftMap.settings || {}) },
    nav: unwrap(nav, 'navigation').filter((n) => n.is_visible),
    categories: unwrap(cats, 'skill categories').filter((c) => c.is_visible),
    skills: unwrap(skills, 'skills').filter((s) => s.is_visible),
    projects: unwrap(projects, 'projects').map(normalizeProject),
    experience: unwrap(experience, 'experience'),
    education: unwrap(education, 'education'),
    certifications: unwrap(certifications, 'certifications'),
    resume: resume.error ? null : resume.data,
    hasDrafts: Object.keys(draftMap).length > 0,
  };
  if (!site.profile.full_name) throw new ContentError('empty', 'The profile has not been set up yet.');
  return site;
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY) || localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    return Date.now() - at < CACHE_MAX_AGE ? data : null;
  } catch { return null; }
}
function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* quota / private mode */ }
}

/**
 * Stale-while-revalidate loader. Calls onData(site, { cached }) once with cached
 * content (instant paint on repeat visits) and again with fresh content if it changed.
 */
export async function loadSite(onData) {
  const cached = previewRequested ? null : readCache();
  if (cached) onData(cached, { cached: true });
  try {
    const fresh = await fetchSiteFresh();
    if (!fresh.preview) {
      writeCache(fresh);
      if (cached && JSON.stringify(cached) === JSON.stringify(fresh)) return fresh;
    }
    onData(fresh, { cached: false });
    return fresh;
  } catch (e) {
    if (cached) return cached; // offline / transient error: keep showing cached content
    throw e;
  }
}

export async function fetchProject(slug) {
  const { db, preview } = await context();
  let q = db.from('projects')
    .select('*, project_technologies(sort_order, skill:skills(id, name, level)), project_images(id, kind, storage_path, alt_text, caption, sort_order)')
    .eq('slug', slug);
  if (preview) q = q.neq('status', 'archived');
  const data = unwrap(await q.maybeSingle(), 'project');
  if (!data) return null;
  const p = normalizeProject(data);
  p.images = (data.project_images || []).sort((a, b) => a.sort_order - b.sort_order);
  delete p.project_images;
  return { project: p, preview };
}

export async function isPreviewActive() {
  return (await context()).preview;
}
