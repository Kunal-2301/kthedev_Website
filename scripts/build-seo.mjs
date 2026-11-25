// Deploy-time SEO build: sitemap.xml + one static page per PUBLISHED project
// (/projects/<slug>/index.html) with real titles, descriptions and preview images.
// Reads only public data through the RLS-protected API with the publishable key.
// Runs in the Pages workflow on every deploy and daily.
//
// Env (all optional): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SITE_URL, OUT_DIR (default: _site)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProject, renderProjectPage, renderSitemap } from './seo-pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = await readFile(path.join(root, 'js/config.js'), 'utf8');
const pick = (k) => new RegExp(`${k}:\\s*'([^']*)'`).exec(cfg)?.[1];
const supabaseUrl = (process.env.SUPABASE_URL || pick('supabaseUrl') || '').replace(/\/$/, '');
const key = process.env.SUPABASE_PUBLISHABLE_KEY || pick('supabaseKey');
const outDir = path.resolve(root, process.env.OUT_DIR || '_site');
let siteUrl = (process.env.SITE_URL || pick('siteUrl') || '').replace(/\/$/, '');

async function get(pathAndQuery) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`GET ${pathAndQuery.split('?')[0]}: HTTP ${res.status}`);
  return res.json();
}

await mkdir(outDir, { recursive: true });
let projects = [];
if (supabaseUrl && key && !key.startsWith('YOUR_')) {
  const [profiles, settings, rows] = await Promise.all([
    get('profiles?select=*&id=eq.1'),
    get('site_settings?select=canonical_url&id=eq.1'),
    get('projects?select=*,project_technologies(sort_order,skill:skills(name)),project_images(kind,storage_path,alt_text,sort_order)&order=sort_order.asc'),
  ]);
  siteUrl = (process.env.SITE_URL || settings[0]?.canonical_url || siteUrl).replace(/\/$/, '');
  projects = rows.map(normalizeProject);
  for (const project of projects) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(project.slug)) continue; // never write outside projects/
    const dir = path.join(outDir, 'projects', project.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), renderProjectPage({ siteUrl, supabaseUrl, profile: profiles[0] || {}, project }));
  }
} else {
  console.warn('Supabase is not configured — writing a sitemap with the home page only.');
}
await writeFile(path.join(outDir, 'sitemap.xml'), renderSitemap(siteUrl, projects));
console.log(`SEO build → ${path.relative(root, outDir) || '.'}: sitemap.xml (${projects.length + 1} URLs), ${projects.length} project pages`);
