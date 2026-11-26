// Printable one-page resume, generated from the same CMS content as the portfolio.
// "Print / Save as PDF" uses the browser's print dialog with a dedicated print stylesheet.
import { h, mount, $, safeUrl, formatRange, formatDate } from '../core/dom.js';
import { loadSite } from '../core/content.js';
import { resumeHref, sectionEnabled } from './layout.js';
import { projectHref } from '../core/paths.js';

const main = $('#main');
const live = (rows) => rows.filter((r) => r.status !== 'draft');
const bareUrl = (u) => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function block(title, ...body) {
  return h('section', { class: 'rs' }, h('h2', null, title), ...body);
}

function contactLine(p) {
  const items = [
    p.email && h('a', { href: `mailto:${p.email}` }, p.email),
    p.phone && h('a', { href: `tel:${p.phone.replace(/[^\d+]/g, '')}` }, p.phone),
    p.location && h('span', null, p.location),
    safeUrl(p.github_url) && h('a', { href: p.github_url }, bareUrl(p.github_url)),
    safeUrl(p.linkedin_url) && h('a', { href: p.linkedin_url }, bareUrl(p.linkedin_url)),
  ].filter(Boolean);
  return h('p', { class: 'rs-contact' }, items.flatMap((el, i) => (i ? [h('span', { class: 'sep', aria: { hidden: 'true' } }, ' · '), el] : [el])));
}

function skills(site) {
  const core = site.skills.filter((s) => s.level !== 'exploring');
  const rows = site.categories
    .map((c) => ({ name: c.name, list: core.filter((s) => s.category_id === c.id).map((s) => s.name) }))
    .filter((r) => r.list.length);
  if (!rows.length) return null;
  return block('Skills', h('dl', { class: 'rs-skills' }, rows.flatMap((r) => [h('dt', null, r.name), h('dd', null, r.list.join(', '))])));
}

function experience(site) {
  const rows = live(site.experience);
  if (!rows.length || !sectionEnabled(site, 'experience')) return null;
  return block('Experience', rows.map((e) => h('div', { class: 'rs-item' },
    h('div', { class: 'rs-head' }, h('h3', null, e.role_title, h('span', { class: 'org' }, ` · ${e.company}`)),
      h('span', { class: 'when' }, formatRange(e.start_date, e.end_date, e.is_current, e.date_precision))),
    e.summary && h('p', null, e.summary),
    [...(e.responsibilities || []), ...(e.achievements || [])].length > 0
      && h('ul', null, [...(e.responsibilities || []), ...(e.achievements || [])].map((r) => h('li', null, r))))));
}

function projects(site) {
  const rows = live(site.projects);
  if (!rows.length || !sectionEnabled(site, 'projects')) return null;
  return block('Projects', rows.map((p) => {
    const m = (p.metrics || [])[0];
    return h('div', { class: 'rs-item' },
      h('div', { class: 'rs-head' }, h('h3', null, h('a', { href: projectHref(p.slug) }, p.title)),
        safeUrl(p.github_url) && h('a', { class: 'when', href: p.github_url }, bareUrl(p.github_url))),
      p.short_description && h('p', null, p.short_description, m ? ` (${m.value} ${m.label.toLowerCase()})` : ''),
      p.technologies.length > 0 && h('p', { class: 'tech' }, p.technologies.map((t) => t.name).join(' · ')));
  }));
}

function education(site) {
  const edu = live(site.education);
  const certs = live(site.certifications);
  return [
    edu.length > 0 && sectionEnabled(site, 'education') && block('Education', edu.map((e) => h('div', { class: 'rs-item' },
      h('div', { class: 'rs-head' }, h('h3', null, e.degree, e.field ? ` in ${e.field}` : '', h('span', { class: 'org' }, ` · ${e.institution}`)),
        h('span', { class: 'when' }, e.start_year && e.end_year ? `${e.start_year}–${e.end_year}` : (e.end_year || ''))),
      e.grade && h('p', null, e.grade)))),
    certs.length > 0 && sectionEnabled(site, 'certifications') && block('Certifications', h('ul', null, certs.map((c) =>
      h('li', null, c.name, [c.issuer, c.issue_date && formatDate(c.issue_date)].filter(Boolean).length
        ? ` · ${[c.issuer, c.issue_date && formatDate(c.issue_date)].filter(Boolean).join(', ')}` : '')))),
  ];
}

function render(site) {
  const p = site.profile;
  const pdf = resumeHref(site);
  document.title = `Resume — ${p.full_name}`;
  mount(main,
    h('div', { class: 'resume-bar container' },
      h('a', { class: 'btn btn-sm', href: 'index.html' }, '← Portfolio'),
      h('div', { class: 'acts' },
        pdf && h('a', { class: 'btn btn-sm', href: pdf }, 'Download PDF'),
        h('button', { class: 'btn btn-sm btn-solid', type: 'button', on: { click: () => window.print() } }, 'Print / Save as PDF'))),
    h('article', { class: 'paper', aria: { label: 'Resume' } },
      h('header', { class: 'rs-top' },
        h('h1', null, p.full_name),
        p.designation && h('p', { class: 'role' }, p.designation),
        contactLine(p)),
      p.hero_description && block('Summary', h('p', null, p.hero_description)),
      experience(site),
      projects(site),
      skills(site),
      ...education(site)));
  main.setAttribute('aria-busy', 'false');
}

loadSite(render).catch((err) => {
  console.error(err);
  mount(main, h('div', { class: 'container state' },
    h('p', null, err?.code === 'not_configured' ? err.message : 'The resume could not be loaded. Check your connection and try again.'),
    h('a', { class: 'btn btn-sm', href: 'index.html' }, '← Portfolio')));
});
