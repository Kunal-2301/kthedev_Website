// Safe DOM construction. CMS content is ALWAYS inserted as text (never innerHTML),
// except Markdown, which goes through DOMPurify in markdown.js.

const SAFE_URL = /^(https?:|mailto:|tel:)/i;
const RELATIVE = /^(\/(?!\/)|\.\/|\.\.\/|#|\?|[a-z0-9_-]+\.html)/i;

/** Returns the URL if it is safe to put in href/src, otherwise null. */
export function safeUrl(url) {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;
  if (SAFE_URL.test(u) || RELATIVE.test(u)) return u;
  return null;
}

/**
 * h('a', { href, class: 'x', on: { click }, aria: { label }, data: { id } }, ...children)
 * Children may be strings (inserted as text), nodes, arrays, null/false (skipped).
 */
export function h(tag, attrs, ...children) {
  const el = tag.startsWith('svg:') ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'aria') for (const [a, av] of Object.entries(v)) { if (av !== undefined && av !== null) el.setAttribute(`aria-${a}`, String(av)); }
      else if (k === 'data') for (const [a, av] of Object.entries(v)) { if (av !== undefined && av !== null) el.dataset[a] = String(av); }
      else if (k === 'href' || k === 'src' || k === 'action' || k === 'formaction') {
        const s = safeUrl(String(v));
        if (s) el.setAttribute(k, s);
      }
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) throw new Error('Use the "on" attribute for event handlers');
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' ||
               k === 'multiple' || k === 'required' || k === 'readOnly' || k === 'indeterminate') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }
export function mount(el, ...children) { clear(el); return append(el, children); }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Format a 'YYYY-MM-DD' date without timezone shifts. */
export function formatDate(iso, precision = 'month') {
  if (!iso) return '';
  const [y, m] = String(iso).split('-').map(Number);
  if (precision === 'year' || !m) return String(y);
  return `${MONTHS[m - 1]} ${y}`;
}
export function formatRange(start, end, isCurrent, precision = 'month') {
  const s = formatDate(start, precision);
  const e = isCurrent ? 'Present' : formatDate(end, precision);
  return e && e !== s ? `${s} – ${e}` : s;
}
export function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
export function relativeTime(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(diff) < 45) return 'just now';
  const units = [['year', 31557600], ['month', 2629800], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, sec] of units) if (Math.abs(diff) >= sec) return rtf.format(-Math.round(diff / sec), unit);
  return rtf.format(-Math.round(diff), 'second');
}

export const LEVELS = {
  experienced: { label: 'Experienced', hint: 'Used in projects or professional work' },
  familiar: { label: 'Familiar', hint: 'Working knowledge' },
  exploring: { label: 'Currently exploring', hint: 'Actively learning' },
};

export const EMPLOYMENT_TYPES = {
  full_time: 'Full-time', part_time: 'Part-time', internship: 'Internship', contract: 'Contract',
  freelance: 'Freelance', leadership: 'Leadership', volunteer: 'Volunteer',
};

export const PROJECT_STATUS = { completed: 'Completed', in_progress: 'In progress', maintained: 'Live & maintained', planned: 'Planned' };

export function slugify(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
