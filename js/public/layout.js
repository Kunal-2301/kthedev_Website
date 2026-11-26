// Header, footer, SEO and shared helpers — used by index.html and project.html.
import { h, mount, $, safeUrl } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { publicUrl, functionUrl } from '../core/supabase.js';
import { CONFIG } from '../config.js';
import { siteHref } from '../core/paths.js';

export const sectionEnabled = (site, key) => site.settings?.sections?.[key] !== false;
export const resumeHref = (site) => (site.resume ? functionUrl('resume') : null);
export const handleOf = (p) => p.handle || (p.full_name || 'portfolio').toLowerCase().replace(/\s+/g, '');
export const baseUrl = (site) => (site.settings.canonical_url || CONFIG.siteUrl || location.origin).replace(/\/$/, '');

/** `// title` section heading, exactly like the reference design. */
export const secTitle = (text, id) => h('h2', { class: 'sec-title rv', id }, h('span', { class: 'slashes', aria: { hidden: 'true' } }, '// '), text);

/** Terminal window with traffic-light dots. */
export function win(title, ...body) {
  return h('div', { class: 'win rv' },
    h('div', { class: 'win-bar' }, h('span', { class: 'dots', aria: { hidden: 'true' } }, h('i'), h('i'), h('i')),
      h('span', { class: 'win-title' }, title)),
    h('div', { class: 'win-body' }, ...body));
}

export const cursor = () => h('span', { class: 'cur', aria: { hidden: 'true' } });

export function navHref(item, onHome) {
  if (item.target_type === 'section') return onHome ? `#${item.section_key}` : siteHref(`index.html#${item.section_key}`);
  return safeUrl(item.url);
}

export function socialButtons(site, cls = 'btn btn-sm') {
  return site.nav.filter((n) => n.location === 'social' && n.icon !== 'email').map((n) => {
    const href = safeUrl(n.url);
    return href && h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, n.label);
  });
}

// ---------------------------------------------------------------- header
let headerListeners = null; // AbortController for window/document listeners of the current render

export function renderHeader(site, { onHome }) {
  headerListeners?.abort();
  headerListeners = new AbortController();
  const { signal } = headerListeners;
  const header = $('#site-header');
  const p = site.profile;
  const links = site.nav
    .filter((n) => n.location === 'header')
    .filter((n) => n.target_type !== 'section' || sectionEnabled(site, n.section_key));

  const list = h('ul', { class: 'nav-links', id: 'nav-links' }, links.map((n) => h('li', null, h('a', {
    href: navHref(n, onHome), data: { section: n.section_key || '' },
    target: n.target_type === 'url' && n.url.startsWith('http') ? '_blank' : null,
    rel: n.target_type === 'url' ? 'noopener noreferrer' : null,
  }, n.label))));

  const menuBtn = h('button', { class: 'menu-btn', type: 'button', aria: { label: 'Open menu', expanded: 'false', controls: 'nav-links' } }, icon('menu'));
  const setOpen = (open) => {
    list.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    mount(menuBtn, icon(open ? 'close' : 'menu'));
  };
  menuBtn.addEventListener('click', () => setOpen(!list.classList.contains('open')));
  list.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && list.classList.contains('open')) { setOpen(false); menuBtn.focus(); } }, { signal });

  mount(header, h('div', { class: 'container header-inner' },
    h('a', { class: 'logo', href: onHome ? '#top' : siteHref('index.html'), title: `${p.full_name} — home` }, `> ${handleOf(p)}`),
    h('nav', { class: 'nav', aria: { label: 'Primary' } },
      list,
      sectionEnabled(site, 'contact') && h('a', { class: 'btn btn-sm hire', href: onHome ? '#contact' : siteHref('index.html#contact') }, 'Hire Me'),
      menuBtn)));

  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', onScroll, { passive: true, signal });
  onScroll();

  if (onHome && 'IntersectionObserver' in window) {
    const map = new Map();
    list.querySelectorAll('a[data-section]').forEach((a) => { if (a.dataset.section) map.set(a.dataset.section, a); });
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const a = map.get(e.target.id);
        if (a && e.isIntersecting) { map.forEach((x) => x.removeAttribute('aria-current')); a.setAttribute('aria-current', 'true'); }
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    map.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
    signal.addEventListener('abort', () => io.disconnect());
  }
}

// ---------------------------------------------------------------- footer
export function renderFooter(site, { onHome }) {
  const p = site.profile;
  const own = site.nav.filter((n) => n.location === 'footer');
  const links = (own.length ? own : site.nav.filter((n) => n.location === 'header'))
    .filter((n) => n.target_type !== 'section' || sectionEnabled(site, n.section_key));
  mount($('#site-footer'), h('div', { class: 'container' },
    h('div', { class: 'footer-inner' },
      h('span', { class: 'p-c' }, `> ${handleOf(p)}`),
      h('ul', { class: 'footer-links' }, links.map((n) => h('li', null, h('a', { href: navHref(n, onHome) }, n.label)))),
      h('span', null, `© ${new Date().getFullYear()} ${p.full_name}`)),
    h('p', { class: 'footer-note' },
      [p.footer_text, site.settings?.analytics_enabled === true && 'Cookieless, anonymous analytics · respects Do Not Track / GPC.'].filter(Boolean).join(' · '))));
}

export function renderPreviewBanner(site) {
  if (!site.preview) return;
  document.body.prepend(h('div', { class: 'preview-banner', role: 'status' },
    '[draft preview] unpublished content is visible to you only — visitors see published content'));
}

// ---------------------------------------------------------------- reveal on scroll (stagger like the reference)
export function setupReveal(root) {
  const groups = new Map();
  root.querySelectorAll('.rv').forEach((el) => {
    const g = el.closest('section, article, main') || root;
    const n = groups.get(g) || 0;
    el.style.setProperty('--i', String(Math.min(n, 8)));
    groups.set(g, n + 1);
  });
  const els = root.querySelectorAll('.rv:not(.in)');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach((e) => e.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
  els.forEach((e) => io.observe(e));
}

/** Type text into an element character by character (instant when reduced motion is preferred). */
export function typeInto(el, text, speed) {
  return new Promise((resolve) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !text) { el.textContent = text || ''; resolve(); return; }
    let i = 0;
    el.textContent = '';
    const t = setInterval(() => {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(t); resolve(); }
    }, speed);
  });
}

// ---------------------------------------------------------------- SEO
function setMeta(attr, key, value) {
  if (!value) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.append(el); }
  el.setAttribute('content', value);
}
function setLink(rel, href) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.append(el); }
  el.href = href;
}

export function applySeo(site, { title, description, path = '/', image, type = 'website', jsonld = [] }) {
  const url = baseUrl(site) + path;
  const img = image || publicUrl('media', site.settings.og_image_path);
  document.title = title;
  setMeta('name', 'description', description);
  setMeta('name', 'keywords', site.settings.keywords);
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', description);
  setMeta('property', 'og:type', type);
  setMeta('property', 'og:url', url);
  setMeta('property', 'og:image', img);
  setMeta('name', 'twitter:card', img ? 'summary_large_image' : 'summary');
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', description);
  setLink('canonical', url);
  if (site.settings.favicon_path) setLink('icon', publicUrl('media', site.settings.favicon_path));
  if (site.preview) setMeta('name', 'robots', 'noindex, nofollow');
  document.querySelectorAll('script[data-jsonld]').forEach((s) => s.remove());
  for (const obj of jsonld) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.dataset.jsonld = '1';
    s.textContent = JSON.stringify(obj).replace(/</g, '\\u003c');
    document.head.append(s);
  }
}

export function personJsonLd(site) {
  const p = site.profile;
  const base = baseUrl(site);
  return {
    '@context': 'https://schema.org', '@type': 'Person',
    name: p.full_name, alternateName: p.handle || undefined, jobTitle: p.designation, description: p.hero_description,
    url: `${base}/`, email: p.email ? `mailto:${p.email}` : undefined,
    address: p.location ? { '@type': 'PostalAddress', addressLocality: p.location } : undefined,
    image: publicUrl('media', p.avatar_path) || undefined,
    sameAs: [p.github_url, p.linkedin_url].filter(Boolean),
    alumniOf: site.education.slice(0, 1).map((e) => ({ '@type': 'CollegeOrUniversity', name: e.institution })),
    knowsAbout: (p.focus_areas || []).slice(0, 12),
  };
}
