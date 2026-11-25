// Generic ordered-collection manager (list + slide-over editor) and its configs:
// experience, education, certifications, navigation, skill categories.
import { h, mount, formatRange, formatDate, EMPLOYMENT_TYPES, debounce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { db, data, run, reorder } from '../api.js';
import { pageHeader, btn, busy, emptyState, loadingRows, statusBadge, confirmDialog, confirmDiscard, toast, toastError, errorState,
         drawer, createForm, linkSlug, tabs } from '../ui.js';
import { openHistory } from '../history.js';

const STATUS_FIELD = { name: 'status', label: 'Visibility', type: 'select',
  options: [{ value: 'published', label: 'Published — visible on the site' }, { value: 'draft', label: 'Draft — hidden' }, { value: 'archived', label: 'Archived — hidden' }] };
const VISIBLE_FIELD = { name: 'is_visible', label: 'Visible', type: 'toggle', toggleLabel: 'Show on the public site' };

// ---------------------------------------------------------------- configs
export const CONFIGS = {
  experience: {
    table: 'experience', title: 'Experience', singular: 'experience entry', entityType: 'experience', statusMode: 'status',
    desc: 'Jobs, internships and leadership roles, shown as a timeline.',
    search: ['company', 'role_title'], icon: 'briefcase',
    columns: [
      { label: 'Role', render: (r) => [h('div', { class: 'cell-title' }, r.role_title), h('div', { class: 'cell-sub' }, r.company)] },
      { label: 'Dates', render: (r) => formatRange(r.start_date, r.end_date, r.is_current, r.date_precision) },
      { label: 'Type', render: (r) => EMPLOYMENT_TYPES[r.employment_type] },
    ],
    defaults: { status: 'draft', employment_type: 'full_time', date_precision: 'month', responsibilities: [], achievements: [] },
    sections: () => [
      { title: 'Role', fields: [
        { name: 'role_title', label: 'Job title', required: true, max: 120 },
        { name: 'company', label: 'Company', required: true, max: 120 },
        { name: 'employment_type', label: 'Employment type', type: 'select', options: Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => ({ value, label })) },
        { name: 'location', label: 'Location', max: 120 },
        { name: 'company_url', label: 'Company website', type: 'url', max: 2048 },
        { name: 'logo_path', label: 'Company logo', type: 'image', folder: 'logos', square: true },
      ] },
      { title: 'Duration', fields: [
        { name: 'start_date', label: 'Start date', type: 'date', required: true },
        { name: 'end_date', label: 'End date', type: 'date',
          validate: (v, a) => (v && a.is_current ? 'Clear the end date for a current role.' : v && a.start_date && v < a.start_date ? 'End date must be after the start date.' : null) },
        { name: 'is_current', label: 'Current', type: 'toggle', toggleLabel: 'I currently work here' },
        { name: 'date_precision', label: 'Show dates as', type: 'select', options: [{ value: 'month', label: 'Month and year (May 2025)' }, { value: 'year', label: 'Year only (2024)' }] },
      ] },
      { title: 'Details', fields: [
        { name: 'summary', label: 'Summary', type: 'textarea', max: 1000, rows: 3 },
        { name: 'responsibilities', label: 'Responsibilities', type: 'list', rows: 5, maxItems: 30, hint: 'One per line.' },
        { name: 'achievements', label: 'Achievements', type: 'list', rows: 4, maxItems: 30, hint: 'One per line. Only real, verifiable outcomes.' },
        STATUS_FIELD,
      ] },
    ],
  },
  education: {
    table: 'education', title: 'Education', singular: 'education entry', entityType: 'education', statusMode: 'status',
    desc: 'Degrees and schooling.', search: ['institution', 'degree', 'field'], icon: 'graduation',
    columns: [
      { label: 'Qualification', render: (r) => [h('div', { class: 'cell-title' }, r.degree, r.field ? ` — ${r.field}` : ''), h('div', { class: 'cell-sub' }, r.institution)] },
      { label: 'Years', render: (r) => [r.start_year, r.end_year].filter(Boolean).join(' – ') },
      { label: 'Grade', render: (r) => r.grade || '—' },
    ],
    defaults: { status: 'draft' },
    sections: () => [
      { title: 'Qualification', fields: [
        { name: 'degree', label: 'Degree / qualification', required: true, max: 160, placeholder: 'e.g. B.Tech' },
        { name: 'field', label: 'Field of study', max: 160 },
        { name: 'institution', label: 'Institution', required: true, max: 160 },
        { name: 'location', label: 'Location', max: 120 },
        { name: 'start_year', label: 'Start year', type: 'number', minValue: 1950, maxValue: 2100 },
        { name: 'end_year', label: 'End year (or expected)', type: 'number', minValue: 1950, maxValue: 2100,
          validate: (v, a) => (v && a.start_year && v < a.start_year ? 'End year must be after the start year.' : null) },
        { name: 'grade', label: 'Grade / CGPA', max: 60 },
        { name: 'logo_path', label: 'Logo', type: 'image', folder: 'logos', square: true },
        { name: 'description', label: 'Description', type: 'textarea', max: 2000, rows: 3 },
        STATUS_FIELD,
      ] },
    ],
  },
  certifications: {
    table: 'certifications', title: 'Certifications', singular: 'certification', entityType: 'certification', statusMode: 'status',
    desc: 'Certificates with verification links, images or PDFs.', search: ['name', 'issuer'], icon: 'award',
    columns: [
      { label: 'Certification', render: (r) => [h('div', { class: 'cell-title' }, r.name), h('div', { class: 'cell-sub' }, r.issuer)] },
      { label: 'Issued', render: (r) => formatDate(r.issue_date) || '—' },
      { label: 'Proof', render: (r) => [r.verify_url && h('span', { class: 'tag' }, 'Link'), r.file_path && h('span', { class: 'tag' }, r.file_kind === 'pdf' ? 'PDF' : 'Image')] },
    ],
    defaults: { status: 'draft' },
    sections: () => [
      { title: 'Certificate', fields: [
        { name: 'name', label: 'Certificate name', required: true, max: 200 },
        { name: 'issuer', label: 'Issuing organization', required: true, max: 160 },
        { name: 'issue_date', label: 'Issue date', type: 'date' },
        { name: 'expiry_date', label: 'Expiry date', type: 'date', validate: (v, a) => (v && a.issue_date && v < a.issue_date ? 'Expiry must be after the issue date.' : null) },
        { name: 'credential_id', label: 'Credential ID', max: 120 },
        { name: 'verify_url', label: 'Verification link', type: 'url', max: 2048 },
        { name: 'file_path', label: 'Certificate file', type: 'file', bucket: 'certificates', folder: 'certificates', kindField: 'file_kind', full: true },
        { name: 'description', label: 'Description', type: 'textarea', max: 1000, rows: 3 },
        STATUS_FIELD,
      ] },
    ],
  },
  navigation: {
    table: 'nav_items', title: 'Navigation', singular: 'link', entityType: null, statusMode: 'visible',
    desc: 'Header menu, footer links and social profiles. Links are validated, so arbitrary markup or scripts cannot be added.',
    search: ['label', 'url'], icon: 'compass',
    groupBy: { column: 'location', options: [{ id: 'header', label: 'Header menu' }, { id: 'footer', label: 'Footer links' }, { id: 'social', label: 'Social links' }] },
    columns: [
      { label: 'Label', render: (r) => h('div', { class: 'cell-title' }, r.label) },
      { label: 'Target', render: (r) => (r.target_type === 'section' ? `Section: #${r.section_key}` : r.url) },
    ],
    defaults: { location: 'header', target_type: 'section', is_visible: true },
    sections: () => [
      { title: 'Link', fields: [
        { name: 'location', label: 'Placement', type: 'select', options: [{ value: 'header', label: 'Header menu' }, { value: 'footer', label: 'Footer' }, { value: 'social', label: 'Social icons' }] },
        { name: 'label', label: 'Label', required: true, max: 40 },
        { name: 'target_type', label: 'Links to', type: 'select', options: [{ value: 'section', label: 'A section of the home page' }, { value: 'url', label: 'An external URL' }] },
        { name: 'section_key', label: 'Section', type: 'select', allowEmpty: true,
          options: ['about', 'skills', 'projects', 'experience', 'education', 'certifications', 'contact'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
          validate: (v, a) => (a.target_type === 'section' && !v ? 'Choose a section.' : null) },
        { name: 'url', label: 'URL', max: 2048, placeholder: 'https://… or mailto:…',
          validate: (v, a) => (a.target_type === 'url' && !v ? 'Enter a URL.' : v && a.target_type === 'url' && !/^(https:\/\/[^\s<>"'`]+|mailto:[^\s<>"'`@]+@[^\s<>"'`]+)$/i.test(v) ? 'Use an https:// or mailto: link.' : null) },
        { name: 'icon', label: 'Icon (social links)', type: 'select', allowEmpty: true,
          options: ['github', 'linkedin', 'email', 'x', 'website', 'youtube', 'kaggle', 'medium', 'huggingface', 'link'].map((v) => ({ value: v, label: v })) },
        VISIBLE_FIELD,
      ] },
    ],
    toPayload: (v) => ({ ...v, section_key: v.target_type === 'section' ? v.section_key : null, url: v.target_type === 'url' ? v.url : null }),
  },
  skill_categories: {
    table: 'skill_categories', title: 'Skill categories', singular: 'category', entityType: null, statusMode: 'visible',
    search: ['name'], icon: 'layers',
    columns: [
      { label: 'Category', render: (r) => [h('div', { class: 'cell-title' }, r.name), h('div', { class: 'cell-sub' }, r.description || '')] },
    ],
    defaults: { is_visible: true },
    sections: () => [
      { title: 'Category', fields: [
        { name: 'name', label: 'Name', required: true, max: 60 },
        { name: 'slug', label: 'Slug', required: true, max: 120, pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/, patternMessage: 'Lowercase letters, numbers and hyphens.' },
        { name: 'description', label: 'Short description', type: 'textarea', max: 300, rows: 2 },
        VISIBLE_FIELD,
      ] },
    ],
    linkSlug: ['name', 'slug'],
    deleteHint: 'Categories that still contain skills cannot be deleted — move or delete those skills first.',
  },
};

// ---------------------------------------------------------------- editor drawer
export function openEditor(cfg, row, onSaved) {
  const isNew = !row;
  const sections = cfg.sections(row);
  const form = createForm({ sections, values: row || { ...cfg.defaults }, idPrefix: cfg.table });
  if (cfg.linkSlug) linkSlug(form, cfg.linkSlug[0], cfg.linkSlug[1], isNew);
  const saveBtn = btn(isNew ? `Add ${cfg.singular}` : 'Save changes', { variant: 'primary', icon: 'save' });
  const d = drawer({
    title: isNew ? `New ${cfg.singular}` : `Edit ${cfg.singular}`,
    body: form.el,
    footer: [btn('Cancel', { onClick: () => d.close() }), saveBtn],
    beforeClose: async () => !form.isDirty() || confirmDiscard(),
  });
  const fieldNames = sections.flatMap((s) => s.fields.flatMap((f) => [f.name, f.kindField].filter(Boolean)));
  saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
    if (!form.validate().ok) return;
    let payload = form.values();
    payload = Object.fromEntries(Object.entries(cfg.toPayload ? cfg.toPayload(payload) : payload).filter(([k]) => fieldNames.includes(k)));
    try {
      let saved;
      if (isNew) {
        const max = await data(db().from(cfg.table).select('sort_order').order('sort_order', { ascending: false }).limit(1));
        [saved] = await data(db().from(cfg.table).insert({ ...payload, sort_order: (max[0]?.sort_order || 0) + 1 }).select());
      } else {
        [saved] = await data(db().from(cfg.table).update(payload).eq('id', row.id).select());
      }
      form.markClean();
      await d.close(true);
      toast(isNew ? `${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} added.` : 'Changes saved.');
      onSaved?.(saved);
    } catch (e) { toastError(e); }
  }, 'Saving…'));
  setTimeout(() => form.el.querySelector('input, select, textarea')?.focus(), 50);
  return d;
}

// ---------------------------------------------------------------- list
export async function renderCollection(container, cfg, { openNew = false, onChange } = {}) {
  const state = { q: '', status: '', group: cfg.groupBy?.options[0].id };
  let rows = [];
  const body = h('div');
  const search = h('input', { class: 'input', type: 'search', placeholder: `Search ${cfg.title.toLowerCase()}…`, aria: { label: `Search ${cfg.title}` },
    on: { input: debounce((e) => { state.q = e.target.value.trim().toLowerCase(); draw(); }, 150) } });
  const statusSel = cfg.statusMode === 'status' && h('select', { class: 'select', aria: { label: 'Filter by status' },
    on: { change: (e) => { state.status = e.target.value; draw(); } } },
  [['', 'All'], ['published', 'Published'], ['draft', 'Draft'], ['archived', 'Archived']].map(([v, l]) => h('option', { value: v }, l)));

  async function load() {
    mount(body, loadingRows(4));
    try { rows = await data(db().from(cfg.table).select('*').order('sort_order')); draw(); }
    catch (e) { mount(body, errorState(e, load)); }
  }
  const reload = () => { load(); onChange?.(); };

  const visible = (r) => (cfg.statusMode === 'status' ? r.status === 'published' : r.is_visible);
  const inGroup = (r) => !cfg.groupBy || r[cfg.groupBy.column] === state.group;
  const filtered = () => rows.filter((r) => inGroup(r) && (!state.status || r.status === state.status) &&
    (!state.q || cfg.search.some((k) => String(r[k] || '').toLowerCase().includes(state.q))));

  async function move(r, dir) {
    const group = rows.filter(inGroup);
    const ids = group.map((x) => x.id);
    const i = ids.indexOf(r.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await reorder(cfg.table, ids); load(); } catch (e) { toastError(e); }
  }
  async function toggleVisible(r) {
    const patch = cfg.statusMode === 'status' ? { status: visible(r) ? 'draft' : 'published' } : { is_visible: !r.is_visible };
    try { await run(db().from(cfg.table).update(patch).eq('id', r.id)); toast(visible(r) ? 'Hidden from the site.' : 'Now visible on the site.'); reload(); }
    catch (e) { toastError(e); }
  }
  async function remove(r) {
    const label = cfg.columns[0].render(r);
    const name = (Array.isArray(label) ? label[0] : label).textContent;
    const ok = await confirmDialog({ title: `Delete “${name}”?`, danger: true, confirmText: 'Delete',
      message: cfg.entityType ? 'A snapshot is kept in version history, so it can be restored later.' : (cfg.deleteHint || 'This cannot be undone.') });
    if (!ok) return;
    try { await run(db().from(cfg.table).delete().eq('id', r.id)); toast('Deleted.'); reload(); } catch (e) { toastError(e); }
  }

  function draw() {
    const list = filtered();
    const canReorder = !state.q && !state.status;
    if (!rows.filter(inGroup).length) {
      return mount(body, h('div', { class: 'card' }, emptyState({ icon: cfg.icon, title: `No ${cfg.title.toLowerCase()} yet`,
        action: btn(`Add ${cfg.singular}`, { icon: 'plus', variant: 'primary', onClick: () => openEditor(cfg, null, reload) }) })));
    }
    if (!list.length) return mount(body, h('div', { class: 'card' }, emptyState({ icon: 'search', title: 'Nothing matches your search' })));
    mount(body, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, canReorder && h('th', null, h('span', { class: 'sr-only' }, 'Order')),
        cfg.columns.map((c) => h('th', null, c.label)), h('th', null, 'Status'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', null, list.map((r) => h('tr', null,
        canReorder && h('td', { class: 'hide-sm' }, h('div', { class: 'order-btns' },
          btn('', { icon: 'arrowUp', variant: 'ghost', ariaLabel: 'Move up', onClick: () => move(r, -1) }),
          btn('', { icon: 'arrowDown', variant: 'ghost', ariaLabel: 'Move down', onClick: () => move(r, 1) }))),
        cfg.columns.map((c) => h('td', { data: { label: c.label } }, c.render(r))),
        h('td', { data: { label: 'Status' } }, cfg.statusMode === 'status' ? statusBadge(r.status) : statusBadge(r.is_visible ? 'visible' : 'hidden')),
        h('td', null, h('div', { class: 'cell-actions' },
          btn('Edit', { icon: 'edit', size: 'sm', onClick: () => openEditor(cfg, r, reload) }),
          btn(visible(r) ? 'Hide' : (cfg.statusMode === 'status' ? 'Publish' : 'Show'), { size: 'sm', variant: 'ghost', onClick: () => toggleVisible(r) }),
          cfg.entityType && btn('', { icon: 'history', size: 'sm', variant: 'ghost', title: 'Version history',
            onClick: () => openHistory({ entityType: cfg.entityType, entityId: r.id, table: cfg.table, onRestored: reload }) }),
          btn('', { icon: 'trash', size: 'sm', variant: 'ghost', title: 'Delete', onClick: () => remove(r) })))))))),
    h('p', { class: 'small muted mt-4' }, canReorder ? 'Use the arrows to set the display order on the site.' : 'Clear search and filters to reorder.'));
  }

  const add = btn(`Add ${cfg.singular}`, { icon: 'plus', variant: 'primary', onClick: () => {
    const c = cfg.groupBy ? { ...cfg, defaults: { ...cfg.defaults, [cfg.groupBy.column]: state.group,
      ...(state.group === 'social' ? { target_type: 'url' } : {}) } } : cfg;
    openEditor(c, null, reload);
  } });

  mount(container,
    cfg.groupBy && tabs(cfg.groupBy.options, state.group, (id) => { state.group = id; draw(); }),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), statusSel, h('div', { style: { flex: 1 } }), add),
    body);
  await load();
  if (openNew) openEditor(cfg, null, reload);
}

export async function render({ root, params, query }) {
  const cfg = CONFIGS[params[0]];
  const container = h('div');
  mount(root, pageHeader({ title: cfg.title, desc: cfg.desc }), container);
  await renderCollection(container, cfg, { openNew: query.get('new') === '1' });
}

