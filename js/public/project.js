// Project case-study page: project.html?slug=<slug> — terminal design.
import { h, mount, $, safeUrl, PROJECT_STATUS, slugify } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { renderMarkdown, markdownToText } from '../core/markdown.js';
import { publicUrl } from '../core/supabase.js';
import { loadSite, fetchProject } from '../core/content.js';
import { renderHeader, renderFooter, renderPreviewBanner, applySeo, win, setupReveal, baseUrl } from './layout.js';
import { track, trackOutboundClicks } from './analytics.js';
import { siteHref, projectHref, currentProjectSlug } from '../core/paths.js';
import { mountAssistant } from './assistant.js';

const main = $('#main');
const params = new URLSearchParams(location.search);
const slug = currentProjectSlug();
const preview = params.get('preview') === '1';

const heading = (id, text) => h('h2', { id: `${id}-h` }, h('span', { class: 'slashes', aria: { hidden: 'true' } }, '// '), text);

function mdSection(id, title, md, extra) {
  if (!md?.trim() && !extra) return null;
  return h('section', { id, class: 'rv', aria: { labelledby: `${id}-h` } }, heading(id, title),
    md?.trim() && h('div', { class: 'prose' }, renderMarkdown(md)), extra);
}

function listSection(id, title, items) {
  if (!items?.length) return null;
  return h('section', { id, class: 'rv', aria: { labelledby: `${id}-h` } }, heading(id, title),
    h('ul', { class: 'arrow-list' }, items.map((t) => h('li', null, t))));
}

function lightbox() {
  const img = h('img', { alt: '' });
  const cap = h('p');
  const dlg = h('dialog', { class: 'lightbox', aria: { label: 'Image viewer' } },
    h('button', { class: 'btn btn-sm close', type: 'button', aria: { label: 'Close image' }, on: { click: () => dlg.close() } }, icon('close')),
    img, cap);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  return (src, alt, caption) => { img.src = src; img.alt = alt || ''; cap.textContent = caption || ''; dlg.showModal(); };
}

function render(site, p) {
  const open = lightbox();
  const shots = p.images.filter((i) => i.kind === 'screenshot');
  const diagrams = p.images.filter((i) => i.kind === 'architecture');
  const idx = site.projects.findIndex((x) => x.slug === p.slug);
  const prev = idx > 0 ? site.projects[idx - 1] : null;
  const next = idx >= 0 && idx < site.projects.length - 1 ? site.projects[idx + 1] : null;

  const links = [
    safeUrl(p.github_url) && h('a', { class: 'btn btn-sm', href: p.github_url, target: '_blank', rel: 'noopener noreferrer' }, '$ git clone ↗'),
    safeUrl(p.demo_url) && h('a', { class: 'btn btn-sm btn-solid', href: p.demo_url, target: '_blank', rel: 'noopener noreferrer' }, '$ open demo ↗'),
    safeUrl(p.docs_url) && h('a', { class: 'btn btn-sm', href: p.docs_url, target: '_blank', rel: 'noopener noreferrer' }, '$ man docs ↗'),
    ...(p.resources || []).filter((r) => safeUrl(r.url)).map((r) =>
      h('a', { class: 'btn btn-sm', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, `${r.label} ↗`)),
  ].filter(Boolean);

  mount(main,
    h('div', { class: 'container' },
      h('nav', { class: 'crumbs', aria: { label: 'Breadcrumb' } },
        h('a', { href: siteHref(`index.html${preview ? '?preview=1' : ''}#projects`) }, '$ cd ../projects')),
      h('header', { class: 'case-head' },
        h('div', { class: 'case-meta' },
          p.category && h('span', { class: 'p-c' }, `~/${slugify(p.category)}`),
          h('span', { class: ['pill', p.project_status === 'planned' && 'dimmed', p.project_status === 'in_progress' && 'amber'] }, PROJECT_STATUS[p.project_status] || ''),
          p.is_featured && h('span', { class: 'pill amber' }, 'featured'),
          p.status !== 'published' && h('span', { class: 'pill amber' }, p.status === 'scheduled' ? 'scheduled · preview' : 'draft · preview')),
        h('h1', null, p.title, h('span', { class: 'p-c' }, '.')),
        p.short_description && h('p', { class: 'lede' }, p.short_description)),
      p.cover_image_path && h('figure', { class: 'case-cover' },
        h('img', { src: publicUrl('media', p.cover_image_path), alt: p.cover_alt || '', width: 1280, height: 560, fetchpriority: 'high' })),
      p.metrics?.length > 0 && h('div', { class: 'results' }, win('results.log',
        p.metrics.map((m) => h('div', { class: 'row' }, h('b', null, m.value), h('span', { class: 'lab' }, m.label),
          m.description && h('span', { class: 'desc' }, `# ${m.description}`))))),
      h('div', { class: 'case-layout' },
        h('article', { class: 'case-main' },
          mdSection('overview', 'overview', p.description_md),
          mdSection('problem', 'problem', p.problem_md),
          mdSection('solution', 'solution', p.solution_md),
          mdSection('architecture', 'architecture', p.architecture_md, diagrams.length > 0 ? diagrams.map((d) =>
            h('figure', { class: 'diagram' },
              h('img', { src: publicUrl('media', d.storage_path), alt: d.alt_text || 'Architecture diagram', loading: 'lazy' }),
              d.caption && h('figcaption', null, d.caption))) : null),
          mdSection('implementation', 'implementation', p.implementation_md),
          listSection('features', 'key features', p.key_features),
          listSection('challenges', 'technical challenges', p.challenges),
          shots.length > 0 && h('section', { id: 'screenshots', class: 'rv', aria: { labelledby: 'screenshots-h' } },
            heading('screenshots', 'screenshots'),
            h('div', { class: 'gallery' }, shots.map((s) => {
              const src = publicUrl('media', s.storage_path);
              return h('figure', null,
                h('button', { type: 'button', aria: { label: `Enlarge: ${s.alt_text || 'screenshot'}` }, on: { click: () => open(src, s.alt_text, s.caption) } },
                  h('img', { src, alt: s.alt_text || '', loading: 'lazy', decoding: 'async', width: 640, height: 400 })),
                s.caption && h('figcaption', null, s.caption));
            })))),
        h('aside', { class: 'case-aside' },
          links.length > 0 && win('links.sh', links),
          p.technologies.length > 0 && win('stack.txt', h('ul', { class: 'tags' }, p.technologies.map((t) => h('li', { class: 'tag' }, t.name)))))),
      (prev || next) && h('nav', { class: 'case-nav', aria: { label: 'More projects' } },
        prev && h('a', { href: projectHref(prev.slug, { preview }) },
          h('span', { class: 'dir' }, '← prev'), h('span', { class: 'title' }, prev.title)),
        next && h('a', { class: 'next', href: projectHref(next.slug, { preview }) },
          h('span', { class: 'dir' }, 'next →'), h('span', { class: 'title' }, next.title)))));
  main.setAttribute('aria-busy', 'false');
  setupReveal(main);

  const base = baseUrl(site);
  const title = `${p.seo_title || p.title} — ${site.profile.full_name}`;
  const description = p.seo_description || p.short_description || markdownToText(p.description_md);
  applySeo(site, {
    title, description, type: 'article',
    path: `/projects/${encodeURIComponent(p.slug)}/`,
    image: p.cover_image_path ? publicUrl('media', p.cover_image_path) : null,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'CreativeWork', name: p.title, description,
      url: `${base}/projects/${encodeURIComponent(p.slug)}/`,
      author: { '@type': 'Person', name: site.profile.full_name, url: `${base}/` },
      dateModified: p.updated_at, datePublished: p.published_at || undefined,
      keywords: p.technologies.map((t) => t.name).join(', '),
      codeRepository: p.github_url || undefined,
    }],
  });
}

function state(code, title, text, action) {
  main.setAttribute('aria-busy', 'false');
  mount(main, h('div', { class: 'container page-state' }, h('div', { class: 'state', role: 'alert' },
    h('p', { class: 'code' }, code), h('h3', null, title), text && h('p', null, text), action)));
}

(async () => {
  let site = null;
  let shell = false;
  try {
    const projectPromise = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? fetchProject(slug) : Promise.resolve(null);
    site = await loadSite((s) => {
      site = s;
      renderHeader(s, { onHome: false });
      renderFooter(s, { onHome: false });
      if (!shell && s.preview) renderPreviewBanner(s);
      shell = true;
    });
    const res = await projectPromise;
    if (!res) {
      document.title = `Project not found — ${site?.profile?.full_name || 'Portfolio'}`;
      return state('404: project not found', 'This project does not exist or is not published.', null,
        h('a', { class: 'btn btn-sm', href: siteHref('index.html#projects') }, '$ cd ../projects'));
    }
    render(site, res.project);
    track('page_view');
    track('project_view', { slug: res.project.slug });
    trackOutboundClicks();
    mountAssistant(site);
  } catch (e) {
    console.error(e);
    state(e?.code === 'not_configured' ? 'error: site not configured' : 'error: could not load this project',
      e?.code === 'not_configured' ? e.message : 'Check your connection and try again.', null,
      h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => location.reload() } }, '$ retry'));
  }
})();
