// Skills: quick add, inline level/visibility edits, per-category ordering, categories tab.
import { h, mount, debounce, LEVELS } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { publicUrl } from '../../core/supabase.js';
import { db, data, run, reorder } from '../api.js';
import { pageHeader, btn, busy, emptyState, loadingRows, confirmDialog, toast, toastError, errorState, tabs } from '../ui.js';
import { openHistory } from '../history.js';
import { CONFIGS, renderCollection, openEditor } from './collections.js';

const LEVEL_OPTS = Object.entries(LEVELS).map(([value, v]) => ({ value, label: v.label }));

function skillConfig(categories) {
  return {
    table: 'skills', singular: 'skill', entityType: 'skill',
    defaults: { level: 'familiar', is_visible: true, category_id: categories[0]?.id },
    sections: () => [{ title: 'Skill', fields: [
      { name: 'name', label: 'Name', required: true, max: 60 },
      { name: 'category_id', label: 'Category', type: 'select', required: true, options: categories.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'level', label: 'Experience', type: 'select', options: LEVEL_OPTS,
        hint: 'Experienced = used in real projects or work · Familiar = working knowledge · Exploring = currently learning.' },
      { name: 'description', label: 'Short description', type: 'textarea', max: 300, rows: 2 },
      { name: 'icon_path', label: 'Icon / logo', type: 'image', folder: 'skill-icons', square: true, hint: 'Optional. Small square PNG/WebP works best.' },
      { name: 'is_visible', label: 'Visible', type: 'toggle', toggleLabel: 'Show in the Skills section' },
    ] }],
  };
}

export async function render({ root, query }) {
  const tabEl = tabs([{ id: 'skills', label: 'Skills', icon: 'layers' }, { id: 'categories', label: 'Categories', icon: 'folder' }], 'skills', (id) => show(id));
  const container = h('div');
  mount(root, pageHeader({ title: 'Skills', desc: 'Add a new technology in seconds. Changes appear on the site immediately — no deployment needed.' }), tabEl, container);
  function show(id) {
    if (id === 'categories') renderCollection(container, CONFIGS.skill_categories);
    else skillsTab(container, query.get('new') === '1');
  }
  show('skills');
}

async function skillsTab(container, openNew) {
  const state = { q: '', level: '', cat: '' };
  let categories = [];
  let skills = [];
  const body = h('div');

  async function load() {
    mount(body, loadingRows(6));
    try {
      [categories, skills] = await Promise.all([
        data(db().from('skill_categories').select('id, name, sort_order, is_visible').order('sort_order')),
        data(db().from('skills').select('*').order('sort_order')),
      ]);
      drawQuickAdd();
      draw();
    } catch (e) { mount(body, errorState(e, load)); }
  }

  // ------------------------------------------------ quick add
  const quick = h('form', { class: 'card card-pad', style: { marginBottom: '20px' }, novalidate: true });
  function drawQuickAdd() {
    if (!categories.length) {
      return mount(quick, h('div', { class: 'alert alert-info' }, icon('info'), h('div', { class: 'grow' }, 'Create a category first (Categories tab), then add skills to it.')));
    }
    const name = h('input', { class: 'input', id: 'qa-name', placeholder: 'e.g. CrewAI', maxlength: 60, autocomplete: 'off' });
    const cat = h('select', { class: 'select', id: 'qa-cat' }, categories.map((c) => h('option', { value: c.id }, c.name)));
    const level = h('select', { class: 'select', id: 'qa-level' }, LEVEL_OPTS.map((o) => h('option', { value: o.value, selected: o.value === 'exploring' }, o.label)));
    const add = btn('Add skill', { icon: 'plus', variant: 'primary', type: 'submit' });
    mount(quick, h('div', { class: 'form-grid quick-grid' },
      h('div', { class: 'field' }, h('label', { for: 'qa-name' }, 'Quick add'), name),
      h('div', { class: 'field' }, h('label', { for: 'qa-cat' }, 'Category'), cat),
      h('div', { class: 'field' }, h('label', { for: 'qa-level' }, 'Experience'), level),
      add));
    quick.onsubmit = (e) => {
      e.preventDefault();
      const n = name.value.trim();
      if (!n) { name.focus(); return toast('Enter a skill name.', 'error'); }
      busy(add, async () => {
        try {
          const max = Math.max(0, ...skills.filter((s) => s.category_id === cat.value).map((s) => s.sort_order));
          await run(db().from('skills').insert({ name: n, category_id: cat.value, level: level.value, sort_order: max + 1 }));
          toast(`“${n}” added.`);
          name.value = '';
          await load();
          document.getElementById('qa-name')?.focus();
        } catch (err) { toastError(err); }
      });
    };
  }

  // ------------------------------------------------ list
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search skills…', aria: { label: 'Search skills' },
    on: { input: debounce((e) => { state.q = e.target.value.trim().toLowerCase(); draw(); }, 120) } });
  const levelSel = h('select', { class: 'select', aria: { label: 'Filter by experience' }, on: { change: (e) => { state.level = e.target.value; draw(); } } },
    h('option', { value: '' }, 'All levels'), LEVEL_OPTS.map((o) => h('option', { value: o.value }, o.label)));

  async function patch(s, values, msg) {
    try { await run(db().from('skills').update(values).eq('id', s.id)); Object.assign(s, values); if (msg) toast(msg); draw(); }
    catch (e) { toastError(e); load(); }
  }
  async function move(s, dir) {
    const ids = skills.filter((x) => x.category_id === s.category_id).map((x) => x.id);
    const i = ids.indexOf(s.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await reorder('skills', ids); load(); } catch (e) { toastError(e); }
  }
  async function remove(s) {
    if (!(await confirmDialog({ title: `Delete “${s.name}”?`, danger: true, confirmText: 'Delete skill',
      message: 'It is also removed from any project technology lists. A snapshot is kept in version history.' }))) return;
    try { await run(db().from('skills').delete().eq('id', s.id)); toast('Skill deleted.'); load(); } catch (e) { toastError(e); }
  }

  function draw() {
    const canReorder = !state.q && !state.level;
    const groups = categories.map((c) => ({ c, list: skills.filter((s) => s.category_id === c.id &&
      (!state.level || s.level === state.level) && (!state.q || s.name.toLowerCase().includes(state.q))) })).filter((g) => g.list.length);
    if (!skills.length) return mount(body, h('div', { class: 'card' }, emptyState({ icon: 'layers', title: 'No skills yet', text: 'Use Quick add above.' })));
    if (!groups.length) return mount(body, h('div', { class: 'card' }, emptyState({ icon: 'search', title: 'No matching skills' })));
    const cfg = skillConfig(categories);
    mount(body, h('div', { class: 'stack' }, groups.map(({ c, list }) => h('section', { class: 'table-wrap' },
      h('div', { class: 'card-head' }, h('h2', null, c.name, !c.is_visible && h('span', { class: 'status status-hidden', style: { marginLeft: '8px' } }, 'Category hidden')),
        h('span', { class: 'small muted' }, `${list.length} skill${list.length === 1 ? '' : 's'}`)),
      h('table', { class: 'data' }, h('tbody', null, list.map((s) => h('tr', null,
        canReorder && h('td', { class: 'hide-sm', style: { width: '40px' } }, h('div', { class: 'order-btns' },
          btn('', { icon: 'arrowUp', variant: 'ghost', ariaLabel: `Move ${s.name} up`, onClick: () => move(s, -1) }),
          btn('', { icon: 'arrowDown', variant: 'ghost', ariaLabel: `Move ${s.name} down`, onClick: () => move(s, 1) }))),
        h('td', { data: { label: 'Skill' } }, h('div', { class: 'row-gap', style: { flexWrap: 'nowrap' } },
          s.icon_path && h('img', { src: publicUrl('media', s.icon_path), alt: '', width: 20, height: 20 }),
          h('div', null, h('div', { class: 'cell-title' }, s.name), s.description && h('div', { class: 'cell-sub' }, s.description)))),
        h('td', { data: { label: 'Experience' } }, h('select', { class: 'select level-select', aria: { label: `Experience level for ${s.name}` },
          on: { change: (e) => patch(s, { level: e.target.value }, `${s.name}: ${LEVELS[e.target.value].label}`) } },
        LEVEL_OPTS.map((o) => h('option', { value: o.value, selected: o.value === s.level }, o.label)))),
        h('td', { data: { label: 'Visible' } }, h('label', { class: 'toggle' },
          h('input', { type: 'checkbox', role: 'switch', checked: s.is_visible, aria: { label: `Show ${s.name} on the site` },
            on: { change: (e) => patch(s, { is_visible: e.target.checked }, e.target.checked ? `${s.name} is visible.` : `${s.name} is hidden.`) } }),
          h('span', { class: 'small muted' }, s.is_visible ? 'Visible' : 'Hidden'))),
        h('td', null, h('div', { class: 'cell-actions' },
          btn('Edit', { icon: 'edit', size: 'sm', onClick: () => openEditor(cfg, s, load) }),
          btn('', { icon: 'history', size: 'sm', variant: 'ghost', title: 'Version history',
            onClick: () => openHistory({ entityType: 'skill', entityId: s.id, table: 'skills', title: s.name, onRestored: load }) }),
          btn('', { icon: 'trash', size: 'sm', variant: 'ghost', title: 'Delete', onClick: () => remove(s) })))))))))),
    !canReorder && h('p', { class: 'small muted mt-4' }, 'Clear search and filters to reorder.'));
  }

  mount(container, quick, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), levelSel), body);
  await load();
  if (openNew) document.getElementById('qa-name')?.focus();
}
