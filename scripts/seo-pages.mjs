// Static, crawlable page for each published project: /projects/<slug>/index.html
// Real <title>, description, canonical, Open Graph / Twitter cards and JSON-LD for
// link previews (LinkedIn, X, Slack) and search engines, plus the case-study text
// pre-rendered in plain HTML. In the browser, project.js then renders the full page.
// Used by scripts/build-seo.mjs (deploy) and tests/e2e/server.mjs (local dev).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripMd = (md) => String(md || '')
  .replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*]\([^)]*\)/g, ' ').replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
  .replace(/^\s*[-*]\s+/gm, '• ').replace(/^\s*\d+\.\s+/gm, '• ').replace(/[*_`>#]/g, '').trim();
const paras = (md) => stripMd(md).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n        ');
const publicUrl = (supabaseUrl, bucket, path) =>
  path ? `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${String(path).split('/').map(encodeURIComponent).join('/')}` : null;

export const CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob: https://*.supabase.co; "
  + "font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'self' https://challenges.cloudflare.com https://*.supabase.co; "
  + "object-src 'none'; base-uri 'self'; form-action 'self'";

/** Normalize a PostgREST project row (with embeds) to what the template needs. */
export function normalizeProject(row) {
  return {
    ...row,
    technologies: (row.project_technologies || []).sort((a, b) => a.sort_order - b.sort_order).map((t) => t.skill?.name).filter(Boolean),
    images: (row.project_images || []).sort((a, b) => a.sort_order - b.sort_order),
  };
}

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * @param {object} o
 * @param {string} o.siteUrl      public base URL, no trailing slash (e.g. https://kunal-2301.github.io)
 * @param {string} o.supabaseUrl  for public image URLs
 * @param {object} o.profile      profiles row
 * @param {object} o.project      normalized project
 */
export function renderProjectPage({ siteUrl, supabaseUrl, profile, project: p }) {
  const name = profile.full_name || 'Portfolio';
  const handle = profile.handle || name.toLowerCase().replace(/\s+/g, '');
  const url = `${siteUrl}/projects/${encodeURIComponent(p.slug)}/`;
  const title = `${p.seo_title || p.title} — ${name}`;
  const description = truncate(p.seo_description || p.short_description || stripMd(p.description_md).replace(/\s+/g, ' '), 300);
  const image = publicUrl(supabaseUrl, 'media', p.cover_image_path) || `${siteUrl}/assets/og-image.png`;
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CreativeWork', name: p.title, description, url,
    image, author: { '@type': 'Person', name, url: `${siteUrl}/` },
    dateModified: p.updated_at || undefined, datePublished: p.published_at || undefined,
    keywords: p.technologies.join(', ') || undefined, codeRepository: p.github_url || undefined,
  }).replace(/</g, '\\u003c');

  const section = (label, md) => (md && md.trim() ? `
      <section>
        <h2><span class="slashes" aria-hidden="true">// </span>${esc(label)}</h2>
        <div class="prose">
        ${paras(md)}
        </div>
      </section>` : '');
  const list = (label, items) => (items?.length ? `
      <section>
        <h2><span class="slashes" aria-hidden="true">// </span>${esc(label)}</h2>
        <ul class="arrow-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      </section>` : '');
  const link = (href, text) => (href && /^https:\/\//i.test(href) ? `<a class="btn btn-sm" href="${esc(href)}" rel="noopener noreferrer">${esc(text)}</a>` : '');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(name)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">
  <meta name="theme-color" content="#0a0a0a">
  <link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="../../assets/apple-touch-icon.png">
  <link rel="stylesheet" href="../../css/site.css">
  <script type="application/ld+json">${jsonld}</script>
  <script src="../../js/theme-init.js"></script>
  <script src="../../js/vendor/supabase.js" defer></script>
  <script src="../../js/vendor/marked.umd.js" defer></script>
  <script src="../../js/vendor/purify.min.js" defer></script>
  <script type="module" src="../../js/public/project.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header" id="site-header">
    <div class="container header-inner"><a class="logo" href="../../index.html">&gt; ${esc(handle)}</a></div>
  </header>
  <main id="main" tabindex="-1" data-prerendered="1">
    <div class="container">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="../../index.html#projects">← All projects</a></nav>
      <header class="case-head">
        <div class="case-meta">${p.category ? `<span class="p-c">~/${esc(p.category)}</span>` : ''}</div>
        <h1>${esc(p.title)}<span class="p-c">.</span></h1>
        ${p.short_description ? `<p class="lede">${esc(p.short_description)}</p>` : ''}
      </header>
      ${(p.metrics || []).length ? `<ul class="arrow-list">${p.metrics.map((m) => `<li><b>${esc(m.value)}</b> ${esc(m.label)}${m.description ? ` — ${esc(m.description)}` : ''}</li>`).join('')}</ul>` : ''}
      <article class="case-main">${section('overview', p.description_md)}${section('problem', p.problem_md)}${section('solution', p.solution_md)}${section('architecture', p.architecture_md)}${section('implementation', p.implementation_md)}${list('key features', p.key_features)}${list('technical challenges', p.challenges)}${list('technologies', p.technologies)}
      </article>
      <p class="hero-actions">${link(p.github_url, 'Source code ↗')}${link(p.demo_url, 'Live demo ↗')}${link(p.docs_url, 'Documentation ↗')}</p>
      <p class="footer-note">${esc(name)} · <a href="../../index.html">portfolio home</a></p>
    </div>
  </main>
  <footer class="site-footer" id="site-footer"></footer>
</body>
</html>
`;
}

export function renderSitemap(siteUrl, projects) {
  const entries = [{ loc: `${siteUrl}/`, priority: '1.0' }, { loc: `${siteUrl}/resume.html`, priority: '0.6' },
    ...projects.map((p) => ({ loc: `${siteUrl}/projects/${encodeURIComponent(p.slug)}/`, lastmod: p.updated_at?.slice(0, 10), priority: '0.8' }))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${esc(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}<priority>${e.priority}</priority></url>`).join('\n')}
</urlset>
`;
}
