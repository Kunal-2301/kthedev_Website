// Analytics: real, privacy-conscious event data aggregated server-side (analytics_summary RPC).
// Nothing is estimated or fabricated; empty periods are shown as empty.
import { h, mount } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { rpc, db, data } from '../api.js';
import { pageHeader, btn, emptyState, errorState } from '../ui.js';

const nf = new Intl.NumberFormat();
const SECTION_NAMES = { hero: 'Hero', about: 'About', skills: 'Skills', projects: 'Projects', experience: 'Experience',
  education: 'Education', certifications: 'Certifications', contact: 'Contact' };
const DEVICE_NAMES = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet', unknown: 'Unknown' };

const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const isoDay = (d) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------- line chart (one axis, two count series)
// Axis top = 4 × a "nice" integer step, so every gridline is a whole number.
function niceMax(v) {
  const raw = Math.max(1, v) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => Math.round(m * p * 1e6) / 1e6).find((m) => m >= raw && Number.isInteger(m)) ?? 10 * p);
  return step * 4;
}

function lineChart(daily) {
  const W = 760; const H = 260; const M = { t: 12, r: 64, b: 28, l: 40 };
  const iw = W - M.l - M.r; const ih = H - M.t - M.b;
  const n = daily.length;
  const max = niceMax(Math.max(1, ...daily.map((d) => Math.max(d.views, d.visitors))));
  const x = (i) => M.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => M.t + ih - (v / max) * ih;
  const S = (tag, attrs, ...kids) => h(`svg:${tag}`, attrs, ...kids);
  const path = (key) => daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');

  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const step = Math.max(1, Math.ceil(n / 7));
  const last = daily[n - 1];
  // End labels (direct labels, nudged apart if they collide)
  let y1 = y(last.views); let y2 = y(last.visitors);
  if (Math.abs(y1 - y2) < 12) { const mid = (y1 + y2) / 2; y1 = last.views >= last.visitors ? mid - 7 : mid + 7; y2 = last.views >= last.visitors ? mid + 7 : mid - 7; }

  const cross = S('line', { class: 'crosshair', y1: M.t, y2: M.t + ih, visibility: 'hidden' });
  const dot1 = S('circle', { class: 'dot s1', r: 4.5, visibility: 'hidden' });
  const dot2 = S('circle', { class: 'dot s2', r: 4.5, visibility: 'hidden' });
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Daily page views and unique visitors, ${dayLabel(daily[0].day)} to ${dayLabel(last.day)}` },
    S('g', null, ticks.map((t) => [
      S('line', { class: 'gridline', x1: M.l, x2: M.l + iw, y1: y(t), y2: y(t) }),
      S('text', { class: 'axis-label', x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, nf.format(Math.round(t)))])),
    S('g', null, daily.map((d, i) => (i % step === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= step / 2)
      ? S('text', { class: 'axis-label', x: x(i), y: H - 8, 'text-anchor': 'middle' }, dayLabel(d.day)) : null)),
    S('path', { class: 'line s2', d: path('visitors') }),
    S('path', { class: 'line s1', d: path('views') }),
    S('text', { class: 'end-label', x: x(n - 1) + 8, y: y1 + 4 }, `Views ${nf.format(last.views)}`),
    S('text', { class: 'end-label', x: x(n - 1) + 8, y: y2 + 4 }, `Visitors ${nf.format(last.visitors)}`),
    cross, dot2, dot1);

  const tip = h('div', { class: 'chart-tip', hidden: true, role: 'status' });
  const wrap = h('div', { class: 'chart' }, svg, tip);

  function show(i) {
    const d = daily[i];
    [cross].forEach((el) => { el.setAttribute('x1', x(i)); el.setAttribute('x2', x(i)); el.setAttribute('visibility', 'visible'); });
    dot1.setAttribute('cx', x(i)); dot1.setAttribute('cy', y(d.views)); dot1.setAttribute('visibility', 'visible');
    dot2.setAttribute('cx', x(i)); dot2.setAttribute('cy', y(d.visitors)); dot2.setAttribute('visibility', 'visible');
    mount(tip, h('strong', null, new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })),
      h('div', { class: 'r' }, h('i', { class: 's1' }), `Page views: ${nf.format(d.views)}`),
      h('div', { class: 'r' }, h('i', { class: 's2' }), `Unique visitors: ${nf.format(d.visitors)}`));
    tip.hidden = false;
    const rect = svg.getBoundingClientRect();
    const px = (x(i) / W) * rect.width;
    const left = Math.min(Math.max(px + 12, 0), rect.width - tip.offsetWidth);
    tip.style.left = `${px + 12 + tip.offsetWidth > rect.width ? px - tip.offsetWidth - 12 : left}px`;
    tip.style.top = `${(M.t / H) * rect.height}px`;
  }
  function hide() { tip.hidden = true; [cross, dot1, dot2].forEach((el) => el.setAttribute('visibility', 'hidden')); }
  const idxFrom = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((sx - M.l) / iw) * (n - 1))));
  };
  svg.addEventListener('pointermove', (e) => show(idxFrom(e.clientX)));
  svg.addEventListener('pointerleave', hide);
  // Keyboard access: focus the chart and use arrow keys
  let ki = n - 1;
  svg.setAttribute('tabindex', '0');
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { ki = Math.max(0, ki - 1); show(ki); e.preventDefault(); }
    if (e.key === 'ArrowRight') { ki = Math.min(n - 1, ki + 1); show(ki); e.preventDefault(); }
    if (e.key === 'Escape') hide();
  });
  svg.addEventListener('focus', () => show(ki));
  svg.addEventListener('blur', hide);
  return wrap;
}

function dataTable(daily) {
  return h('div', { class: 'table-wrap', style: { maxHeight: '320px', overflow: 'auto' } }, h('table', { class: 'data' },
    h('caption', { class: 'sr-only' }, 'Daily page views and unique visitors'),
    h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Page views'), h('th', null, 'Unique visitors'))),
    h('tbody', null, daily.slice().reverse().map((d) => h('tr', null, h('td', { data: { label: 'Date' } }, dayLabel(d.day)),
      h('td', { data: { label: 'Page views' } }, nf.format(d.views)), h('td', { data: { label: 'Unique visitors' } }, nf.format(d.visitors)))))));
}

function barList(items, nameFn = (k) => k, emptyText = 'No data in this period.') {
  if (!items.length) return h('p', { class: 'small muted' }, emptyText);
  const max = Math.max(...items.map((i) => i.count));
  const total = items.reduce((s, i) => s + i.count, 0);
  return h('ul', { class: 'bars' }, items.map((i) => h('li', null,
    h('div', { class: 'row' }, h('span', { title: nameFn(i.key) }, nameFn(i.key)),
      h('span', null, nf.format(i.count), h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${Math.round((i.count / total) * 100)}%`))),
    h('div', { class: 'track', aria: { hidden: 'true' } }, h('div', { class: 'fill', style: { width: `${(i.count / max) * 100}%` } })))));
}

// ---------------------------------------------------------------- page
export async function render({ root }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const state = { preset: 30, from: null, to: null, table: false };
  let titles = null;
  const body = h('div');

  const fromIn = h('input', { class: 'input', type: 'date', aria: { label: 'From date' } });
  const toIn = h('input', { class: 'input', type: 'date', aria: { label: 'To date' } });
  const presetBtns = [7, 30, 90, 365].map((d) => btn(d === 365 ? '12 months' : `${d} days`, { size: 'sm', onClick: () => setPreset(d) }));
  const applyBtn = btn('Apply', { size: 'sm', onClick: () => {
    if (!fromIn.value || !toIn.value || fromIn.value > toIn.value) return;
    state.preset = null; state.from = fromIn.value; state.to = toIn.value; load();
  } });

  function setPreset(d) {
    state.preset = d;
    const to = new Date(); const from = new Date(); from.setDate(to.getDate() - (d - 1));
    state.from = isoDay(from); state.to = isoDay(to);
    load();
  }

  async function load() {
    presetBtns.forEach((b, i) => b.setAttribute('aria-pressed', String([7, 30, 90, 365][i] === state.preset)));
    fromIn.value = state.from; toIn.value = state.to;
    mount(body, h('div', { class: 'stats' }, Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: { height: '86px' } }))),
      h('div', { class: 'skeleton', style: { height: '300px' } }));
    try {
      const from = new Date(`${state.from}T00:00:00`);
      const to = new Date(`${state.to}T00:00:00`); to.setDate(to.getDate() + 1);
      const [s, projects] = await Promise.all([
        rpc('analytics_summary', { p_from: from.toISOString(), p_to: to.toISOString(), p_tz: tz }),
        titles ? null : data(db().from('projects').select('slug, title')).catch(() => []),
      ]);
      if (projects) titles = new Map(projects.map((p) => [p.slug, p.title]));
      draw(s);
    } catch (e) { mount(body, errorState(e, load)); }
  }

  function draw(s) {
    const days = s.daily.length || 1;
    const tile = (label, value, ic, sub) => h('div', { class: 'stat' }, h('span', { class: 'label' }, icon(ic), label),
      h('span', { class: 'value' }, value), sub && h('span', { class: 'sub' }, sub));
    const noTraffic = s.page_views === 0;
    const chartBox = h('div');
    const toggle = btn(state.table ? 'Show chart' : 'View as table', { size: 'sm', variant: 'ghost', icon: state.table ? 'chart' : 'file',
      onClick: () => { state.table = !state.table; draw(s); } });
    mount(chartBox, noTraffic ? emptyState({ icon: 'chart', title: 'No visits recorded in this period',
      text: 'Data appears once the track function is deployed and people visit your site. Visitors with Do Not Track / GPC are never counted, and localhost visits are ignored.' })
      : state.table ? dataTable(s.daily) : [h('div', { class: 'chart-legend' }, h('span', null, h('i', { class: 's1' }), 'Page views'),
        h('span', null, h('i', { class: 's2' }), 'Unique visitors (daily)')), lineChart(s.daily)]);

    mount(body,
      h('div', { class: 'stats' },
        tile('Page views', nf.format(s.page_views), 'eye'),
        tile('Visits', nf.format(s.visitor_days), 'user', 'Unique visitors per day, summed'),
        tile('Avg. daily visitors', (s.visitor_days / days).toFixed(1), 'activity'),
        tile('Project views', nf.format(s.project_views), 'folder'),
        tile('Resume downloads', nf.format(s.resume_downloads), 'download'),
        tile('Contact messages', nf.format(s.contact_submissions), 'inbox'),
        tile('Assistant questions', nf.format(s.assistant_questions ?? 0), 'sparkles', 'Counts only — question text is never stored')),
      h('section', { class: 'card', style: { marginBottom: '20px' } },
        h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Visitor trend'), h('div', { class: 'desc' }, `Daily, in your time zone (${tz})`)), !noTraffic && toggle),
        h('div', { class: 'card-body' }, chartBox)),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Popular projects')),
          h('div', { class: 'card-body' }, barList(s.top_projects, (k) => titles?.get(k) || `${k} (deleted)`))),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Most viewed sections')),
          h('div', { class: 'card-body' }, barList(s.top_sections, (k) => SECTION_NAMES[k] || k))),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Referral sources')),
          h('div', { class: 'card-body' }, barList(s.referrers))),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Devices')),
          h('div', { class: 'card-body' }, barList(s.devices, (k) => DEVICE_NAMES[k] || k)))));
  }

  mount(root,
    pageHeader({ title: 'Analytics', desc: 'Cookieless, anonymous analytics. No IP addresses or personal data are stored; visitor IDs rotate daily, so “unique visitors” are counted per day.' }),
    h('div', { class: 'range-bar', role: 'group', aria: { label: 'Date range' } }, presetBtns, h('span', { class: 'small muted', style: { marginLeft: '8px' } }, 'or'), fromIn, toIn, applyBtn),
    body);
  setPreset(30);
}
