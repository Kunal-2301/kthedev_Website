// Home page — every section is rendered from CMS data (Supabase), in the terminal design.
import { h, mount, $, safeUrl, formatRange, formatDate, LEVELS, EMPLOYMENT_TYPES, PROJECT_STATUS, debounce, slugify } from '../core/dom.js';
import { renderMarkdown } from '../core/markdown.js';
import { publicUrl } from '../core/supabase.js';
import { loadSite } from '../core/content.js';
import { renderHeader, renderFooter, renderPreviewBanner, applySeo, personJsonLd, sectionEnabled, resumeHref, handleOf,
         secTitle, win, cursor, setupReveal, typeInto, baseUrl } from './layout.js';
import { renderContact } from './contact.js';
import { track, observeSections, trackOutboundClicks } from './analytics.js';
import { projectHref } from '../core/paths.js';
import { mountAssistant } from './assistant.js';

const main = $('#main');
// Decorative background fragments (aria-hidden), as in the reference design.
const FRAGMENTS = ['import torch', 'model.eval()', 'chain.invoke(query)', 'retriever.invoke(q)', 'loss.backward()', 'from fastapi import FastAPI'];

function section(id, title, { alt = false } = {}, ...body) {
  return h('section', { id, class: ['section', alt && 'alt'], data: { section: id }, aria: { labelledby: `${id}-title` } },
    h('div', { class: 'container' }, secTitle(title, `${id}-title`), ...body));
}

// ---------------------------------------------------------------- hero
function hero(site) {
  const p = site.profile;
  const handle = handleOf(p);
  const resume = resumeHref(site);
  const line1 = h('span');
  const line2 = h('span');
  const cur1 = cursor();
  const cur2 = cursor();
  cur2.hidden = true;

  const el = h('section', { class: 'hero', id: 'top', data: { section: 'hero' }, aria: { labelledby: 'hero-title' } },
    h('div', { class: 'grid-bg', aria: { hidden: 'true' } }),
    h('div', { class: 'scan', aria: { hidden: 'true' } }),
    FRAGMENTS.map((f) => h('code', { class: 'frag', aria: { hidden: 'true' } }, f)),
    h('div', { class: 'container hero-inner' },
      p.availability && h('p', { class: 'status-line' }, p.availability),
      h('p', { class: 'prompt' }, h('span', { class: 'p-c' }, '>'), ` ${p.full_name}`, cursor()),
      h('h1', { id: 'hero-title' }, handle, h('span', { class: 'p-c' }, '.'), h('span', { class: 'sr-only' }, ` — ${p.full_name}, ${p.designation}`)),
      h('p', { class: 'typed-1', aria: { hidden: 'true' } }, line1, cur1),
      h('p', { class: 'typed-2', aria: { hidden: 'true' } }, line2, cur2),
      p.hero_headline && h('p', { class: 'headline' }, p.hero_headline),
      p.hero_description && h('p', { class: 'bio' }, p.hero_description),
      h('div', { class: 'hero-actions' },
        sectionEnabled(site, 'projects') && h('a', { class: 'btn btn-solid', href: '#projects' }, 'View Projects'),
        resume && h('a', { class: 'btn', href: resume, data: { resume: '1' } }, 'Download Resume'),
        sectionEnabled(site, 'contact') && h('a', { class: 'btn', href: '#contact' }, 'Contact'))));

  // Typing sequence: designation, then tagline (like the reference)
  typeInto(line1, p.designation || '', 60).then(() => {
    cur1.hidden = true;
    cur2.hidden = false;
    return typeInto(line2, p.tagline || (p.focus_areas || []).slice(0, 4).join(' · '), 35);
  });
  return el;
}

// ---------------------------------------------------------------- about
function about(site) {
  const p = site.profile;
  const edu = site.education.find((e) => e.status !== 'draft') || site.education[0];
  const job = site.experience.find((e) => !['leadership', 'volunteer'].includes(e.employment_type));
  const fact = (label, value) => value && h('div', { class: 'rv' }, h('p', { class: 'sub-title' }, `// ${label}`), h('p', { class: 'fact-val' }, value));
  return section('about', 'about', {},
    h('div', { class: 'about-grid' },
      h('div', { class: 'about-text rv' }, renderMarkdown(p.about_md)),
      h('div', { class: 'facts' },
        p.focus_areas?.length > 0 && h('div', { class: 'rv' }, h('p', { class: 'sub-title' }, '// focus'),
          h('ul', { class: 'tags' }, p.focus_areas.map((f) => h('li', { class: 'tag' }, f)))),
        fact('based_in', p.location),
        edu && fact('education', `${edu.degree}${edu.field ? ` ${edu.field}` : ''} @ ${edu.institution}${edu.end_year ? ` (${edu.end_year})` : ''}`),
        job && fact('experience', `${job.role_title} @ ${job.company}`))));
}

// ---------------------------------------------------------------- projects
function projectCard(p, wide) {
  const href = projectHref(p.slug, { preview: location.search.includes('preview=1') });
  const status = PROJECT_STATUS[p.project_status] || '';
  return h('article', { class: ['card rv', wide && 'wide'] },
    p.cover_image_path && h('div', { class: 'p-cover' },
      h('img', { src: publicUrl('media', p.cover_image_path), alt: p.cover_alt || '', loading: 'lazy', decoding: 'async', width: 960, height: 420 })),
    h('div', { class: 'p-head' },
      h('h3', null, h('a', { href, title: p.title }, p.slug)),
      h('span', { class: ['pill', p.project_status === 'planned' && 'dimmed', p.project_status === 'in_progress' && 'amber'] }, status)),
    h('p', { class: 'p-path' }, `~/${slugify(p.category || 'projects')} · ${p.title}`),
    p.short_description && h('p', { class: 'p-desc' }, p.short_description),
    p.metrics?.length > 0 && h('p', { class: 'p-metrics' }, p.metrics.slice(0, 3).map((m) =>
      h('span', null, h('span', { class: 'p-c' }, '> '), h('b', null, m.value), ` ${m.label.toLowerCase()}`))),
    h('ul', { class: 'tags' }, p.technologies.slice(0, 6).map((t) => h('li', { class: 'tag' }, t.name)),
      p.technologies.length > 6 && h('li', { class: 'tag' }, `+${p.technologies.length - 6}`)),
    h('div', { class: 'p-links' },
      h('a', { href, tabindex: '-1' }, '[case study →]'),
      safeUrl(p.github_url) && h('a', { href: p.github_url, target: '_blank', rel: 'noopener noreferrer', aria: { label: `${p.title} on GitHub` } }, '[github ↗]'),
      safeUrl(p.demo_url) && h('a', { href: p.demo_url, target: '_blank', rel: 'noopener noreferrer', aria: { label: `${p.title} live demo` } }, '[live demo ↗]'),
      safeUrl(p.docs_url) && h('a', { href: p.docs_url, target: '_blank', rel: 'noopener noreferrer', aria: { label: `${p.title} documentation` } }, '[docs ↗]'),
      p.status && p.status !== 'published' && h('span', { class: 'draft' }, p.status === 'scheduled' ? '[scheduled]' : '[draft]')));
}

function projectsSection(site) {
  const projects = site.projects;
  if (!projects.length) return section('projects', 'projects', { alt: true }, h('p', { class: 'dim mono rv' }, '$ ls projects/ → (empty) — coming soon.'));
  const categories = [...new Set(projects.map((p) => p.category).filter(Boolean))];
  let current = 'all';
  const grid = h('div', { class: 'project-grid' });
  const status = h('p', { class: 'sr-only', aria: { live: 'polite' } });
  const buttons = ['all', ...categories].map((c) => h('button', { class: 'fbtn', type: 'button', aria: { pressed: String(c === 'all') }, data: { id: c },
    on: { click: () => { current = c; draw(); } } }, c === 'all' ? '--all' : `--${slugify(c)}`));
  function draw() {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === current)));
    const list = projects.filter((p) => current === 'all' || p.category === current);
    mount(grid, list.map((p, i) => projectCard(p, i === 0 && list.length % 2 === 1)));
    status.textContent = `${list.length} projects shown`;
    setupReveal(grid);
  }
  draw();
  return section('projects', 'projects', { alt: true },
    categories.length > 1 && h('div', { class: 'filters rv', role: 'group', aria: { label: 'Filter projects by category' } },
      h('span', { class: 'cmd' }, '$ ls projects/'), buttons),
    status, grid);
}

// ---------------------------------------------------------------- skills ("stack" terminal window)
function skillsSection(site) {
  const state = { q: '', level: 'all' };
  const byCat = new Map(site.categories.map((c) => [c.id, { ...c, skills: [] }]));
  for (const s of site.skills) byCat.get(s.category_id)?.skills.push(s);
  const cats = [...byCat.values()].filter((c) => c.skills.length);
  if (!cats.length) return null;

  const rows = h('div', { class: 'stack-rows' });
  const count = h('p', { class: 'empty-line', aria: { live: 'polite' } });
  const flags = [['all', '--all'], ['experienced', '--experienced'], ['familiar', '--familiar'], ['exploring', '--exploring']]
    .map(([k, label]) => h('button', { class: 'fbtn', type: 'button', aria: { pressed: String(k === 'all') }, data: { id: k },
      title: k === 'all' ? 'All levels' : LEVELS[k].hint, on: { click: () => { state.level = k; draw(); } } }, label));
  const input = h('input', { class: 'inp', type: 'search', placeholder: 'python', autocomplete: 'off', spellcheck: 'false',
    id: 'skill-search', on: { input: debounce((e) => { state.q = e.target.value.trim().toLowerCase(); draw(); }, 120) } });

  function draw() {
    flags.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === state.level)));
    let total = 0;
    const out = cats.map((c) => {
      const list = c.skills.filter((s) => (state.level === 'all' || s.level === state.level) &&
        (!state.q || s.name.toLowerCase().includes(state.q) || c.name.toLowerCase().includes(state.q)));
      total += list.length;
      return list.length ? h('div', { class: 'stack-row' }, h('span', null, c.name),
        h('ul', { class: 'tags' }, list.map((s) => h('li', { class: `tag lv-${s.level}`, title: `${LEVELS[s.level].label}${s.description ? ` — ${s.description}` : ''}` },
          s.icon_path && h('img', { src: publicUrl('media', s.icon_path), alt: '', width: 14, height: 14, loading: 'lazy' }),
          s.name, h('span', { class: 'sr-only' }, ` (${LEVELS[s.level].label})`))))) : null;
    }).filter(Boolean);
    mount(rows, out.length ? out : h('p', { class: 'empty-line' }, `grep: no match for "${state.q}"`));
    count.textContent = `# ${total} result${total === 1 ? '' : 's'}`;
  }
  draw();

  return section('skills', 'stack', {},
    win(`${handleOf(site.profile)}@stack ~ %`,
      h('div', { class: 'stack-tools' },
        h('label', { class: 'grep', for: 'skill-search' }, h('span', { class: 'cmd' }, '$ grep -i'), input),
        h('div', { class: 'flags', role: 'group', aria: { label: 'Filter by experience level' } }, flags)),
      rows,
      h('div', { class: 'legend' },
        count,
        Object.entries(LEVELS).map(([k, v]) => h('span', { class: `lv-${k}` }, `${v.label.toLowerCase()} — ${v.hint.toLowerCase()}`)))));
}

// ---------------------------------------------------------------- experience
function experienceSection(site) {
  if (!site.experience.length) return null;
  return section('experience', 'experience', { alt: true },
    h('ol', { class: 'xp-list' }, site.experience.map((e) => h('li', { class: 'card xp rv' },
      h('div', { class: 'xp-when' }, formatRange(e.start_date, e.end_date, e.is_current, e.date_precision),
        h('small', null, EMPLOYMENT_TYPES[e.employment_type] || ''), e.status === 'draft' && h('small', null, '[draft]')),
      h('div', null,
        e.logo_path && h('img', { class: 'xp-logo', src: publicUrl('media', e.logo_path), alt: '', width: 40, height: 40, loading: 'lazy' }),
        h('h3', null, e.role_title),
        h('p', { class: 'xp-org' }, '@ ', safeUrl(e.company_url) ? h('a', { href: e.company_url, target: '_blank', rel: 'noopener noreferrer' }, e.company) : e.company),
        e.location && h('p', { class: 'xp-loc' }, e.location),
        e.summary && h('p', { class: 'xp-summary' }, e.summary),
        e.responsibilities?.length > 0 && h('ul', { class: 'arrow-list' }, e.responsibilities.map((r) => h('li', null, r))),
        e.achievements?.length > 0 && h('ul', { class: 'arrow-list' }, e.achievements.map((r) => h('li', null, r))))))));
}

// ---------------------------------------------------------------- education & certifications
function educationSection(site) {
  const showEdu = sectionEnabled(site, 'education') && site.education.length > 0;
  const showCert = sectionEnabled(site, 'certifications') && site.certifications.length > 0;
  if (!showEdu && !showCert) return null;
  return section('education', showCert ? 'education & certifications' : 'education', {},
    h('div', { class: 'edu-grid' },
      showEdu && h('div', null, h('p', { class: 'sub-title rv' }, '// education'),
        h('ul', { class: 'stack-list' }, site.education.map((e) => h('li', { class: 'card mini rv' },
          h('h3', null, e.degree, e.field ? ` — ${e.field}` : ''),
          h('p', { class: 'sub' }, e.institution),
          h('p', { class: 'meta' }, [e.start_year && e.end_year ? `${e.start_year}–${e.end_year}` : e.end_year, e.location, e.grade].filter(Boolean).join(' · '),
            e.status === 'draft' ? ' · [draft]' : ''),
          e.description && h('p', { class: 'meta' }, e.description))))),
      showCert && h('div', { id: 'certifications', data: { section: 'certifications' } },
        h('p', { class: 'sub-title rv' }, '// certifications'),
        h('ul', { class: 'stack-list' }, site.certifications.map((c) => {
          const file = c.file_path ? publicUrl('certificates', c.file_path) : null;
          return h('li', { class: 'card mini cert rv' },
            c.file_kind === 'image' && file ? h('img', { class: 'cert-thumb', src: file, alt: '', loading: 'lazy', width: 48, height: 48 })
              : h('span', { class: 'cert-thumb', aria: { hidden: 'true' } }, c.file_kind === 'pdf' ? 'PDF' : '✓'),
            h('div', null,
              h('h3', null, c.name),
              h('p', { class: 'meta' }, [c.issuer, c.issue_date && formatDate(c.issue_date)].filter(Boolean).join(' · '), c.status === 'draft' ? ' · [draft]' : ''),
              (safeUrl(c.verify_url) || file) && h('div', { class: 'acts' },
                safeUrl(c.verify_url) && h('a', { href: c.verify_url, target: '_blank', rel: 'noopener noreferrer', aria: { label: `Verify ${c.name}` } }, '[verify ↗]'),
                file && h('a', { href: file, target: '_blank', rel: 'noopener noreferrer' }, c.file_kind === 'pdf' ? '[view pdf ↗]' : '[view ↗]'))));
        })))));
}

// ---------------------------------------------------------------- page
function render(site) {
  renderHeader(site, { onHome: true });
  renderFooter(site, { onHome: true });
  mount(main,
    hero(site),
    sectionEnabled(site, 'about') && about(site),
    sectionEnabled(site, 'projects') && projectsSection(site),
    sectionEnabled(site, 'skills') && skillsSection(site),
    sectionEnabled(site, 'experience') && experienceSection(site),
    educationSection(site),
    sectionEnabled(site, 'contact') && h('section', { id: 'contact', class: 'section alt', data: { section: 'contact' }, aria: { labelledby: 'contact-title' } },
      h('div', { class: 'container' }, renderContact(site))));
  main.setAttribute('aria-busy', 'false');

  const p = site.profile;
  applySeo(site, {
    title: p.seo_title || site.settings.site_title || `${p.full_name} (${handleOf(p)}) — ${p.designation}`,
    description: p.seo_description || site.settings.meta_description || p.hero_description,
    path: '/',
    jsonld: [personJsonLd(site), { '@context': 'https://schema.org', '@type': 'WebSite', name: site.settings.site_title, url: `${baseUrl(site)}/` }],
  });
  setupReveal(main);
  observeSections(main);
  if (location.hash && !main.dataset.scrolled) {
    main.dataset.scrolled = '1';
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
}

function renderError(err) {
  main.setAttribute('aria-busy', 'false');
  console.error(err);
  mount(main, h('div', { class: 'container page-state' }, h('div', { class: 'state', role: 'alert' },
    h('p', { class: 'code' }, err?.code === 'not_configured' ? 'error: site not configured' : 'error: content could not be loaded'),
    h('p', null, err?.code === 'not_configured' ? err.message : 'Check your connection and try again.'),
    h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => location.reload() } }, '$ retry'))));
}

let first = true;
loadSite((site) => {
  if (first && site.preview) renderPreviewBanner(site);
  render(site);
  mountAssistant(site);
  if (first) { first = false; track('page_view'); trackOutboundClicks(); }
}).catch(renderError);
