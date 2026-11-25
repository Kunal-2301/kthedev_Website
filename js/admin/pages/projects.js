// Projects list: search, filter, reorder, quick publish/feature, delete.
import { h, mount, relativeTime, formatDateTime, debounce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { publicUrl } from '../../core/supabase.js';
import { db, data, run, reorder } from '../api.js';
import { pageHeader, btn, emptyState, loadingRows, statusBadge, confirmDialog, toast, toastError, errorState, pager } from '../ui.js';
import { openHistory } from '../history.js';

const PAGE = 25;

export function projectStatusBadge(p) {
  const now = Date.now();
  if (p.status === 'scheduled') {
    return new Date(p.publish_at).getTime() <= now ? statusBadge('published')
      : statusBadge('scheduled', `Scheduled · ${new Date(p.publish_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
  }
  if (p.status === 'published' && p.unpublish_at && new Date(p.unpublish_at).getTime() <= now) return statusBadge('draft', 'Expired');
  return statusBadge(p.status);
}

export async function render({ root, query }) {
  const state = { q: '', status: query.get('status') || '', page: 0 };
  let all = [];
  const body = h('div');

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search projects…', aria: { label: 'Search projects' },
    on: { input: debounce((e) => { state.q = e.target.value.trim().toLowerCase(); state.page = 0; draw(); }, 150) } });
  const statusSel = h('select', { class: 'select', aria: { label: 'Filter by status' }, on: { change: (e) => { state.status = e.target.value; state.page = 0; draw(); } } },
    [['', 'All statuses'], ['published', 'Published'], ['draft', 'Draft'], ['scheduled', 'Scheduled'], ['archived', 'Archived']]
      .map(([v, l]) => h('option', { value: v, selected: v === state.status }, l)));

  async function load() {
    mount(body, loadingRows(5));
    try {
      all = await data(db().from('projects')
        .select('id, slug, title, category, status, publish_at, unpublish_at, is_featured, sort_order, cover_image_path, updated_at')
        .order('sort_order'));
      draw();
    } catch (e) { mount(body, errorState(e, load)); }
  }

  const filtered = () => all.filter((p) => (!state.status || p.status === state.status) &&
    (!state.q || p.title.toLowerCase().includes(state.q) || p.slug.includes(state.q) || (p.category || '').toLowerCase().includes(state.q)));

  async function move(p, dir) {
    const ids = all.map((x) => x.id);
    const i = ids.indexOf(p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await reorder('projects', ids); await load(); } catch (e) { toastError(e); }
  }

  async function setStatus(p, status) {
    if (status === 'archived' && !(await confirmDialog({ title: `Archive “${p.title}”?`, message: 'Archived projects are hidden from the public site but kept in the CMS.', confirmText: 'Archive' }))) return;
    try {
      await run(db().from('projects').update({ status, ...(status !== 'scheduled' ? { publish_at: null } : {}) }).eq('id', p.id));
      toast(status === 'published' ? `“${p.title}” is now live.` : `“${p.title}” is no longer public.`);
      load();
    } catch (e) { toastError(e); }
  }

  async function toggleFeatured(p) {
    try { await run(db().from('projects').update({ is_featured: !p.is_featured }).eq('id', p.id)); load(); }
    catch (e) { toastError(e); }
  }

  async function remove(p) {
    const ok = await confirmDialog({ title: `Delete “${p.title}”?`,
      message: 'The project is removed from the site immediately. A snapshot is kept, so it can be restored from Activity logs → Version history.',
      confirmText: 'Delete project', danger: true });
    if (!ok) return;
    try { await run(db().from('projects').delete().eq('id', p.id)); toast('Project deleted.'); load(); }
    catch (e) { toastError(e); }
  }

  function draw() {
    const list = filtered();
    const canReorder = !state.q && !state.status;
    if (!all.length) {
      return mount(body, h('div', { class: 'card' }, emptyState({ icon: 'folder', title: 'No projects yet',
        text: 'Create your first case study. It stays a private draft until you publish it.',
        action: btn('New project', { icon: 'plus', variant: 'primary', href: '#/projects/new' }) })));
    }
    if (!list.length) return mount(body, h('div', { class: 'card' }, emptyState({ icon: 'search', title: 'No matching projects', text: 'Try a different search or status.' })));
    const pageRows = list.slice(state.page * PAGE, state.page * PAGE + PAGE);
    mount(body, h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', null, h('tr', null, canReorder && h('th', null, h('span', { class: 'sr-only' }, 'Order')), h('th', null, 'Project'),
          h('th', null, 'Status'), h('th', null, 'Featured'), h('th', null, 'Updated'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', null, pageRows.map((p) => {
          const live = p.status === 'published' || (p.status === 'scheduled' && new Date(p.publish_at) <= new Date());
          return h('tr', null,
            canReorder && h('td', { class: 'hide-sm' }, h('div', { class: 'order-btns' },
              btn('', { icon: 'arrowUp', variant: 'ghost', ariaLabel: `Move ${p.title} up`, onClick: () => move(p, -1) }),
              btn('', { icon: 'arrowDown', variant: 'ghost', ariaLabel: `Move ${p.title} down`, onClick: () => move(p, 1) }))),
            h('td', { data: { label: 'Project' } }, h('div', { class: 'row-gap', style: { flexWrap: 'nowrap' } },
              p.cover_image_path ? h('img', { class: 'thumb', src: publicUrl('media', p.cover_image_path), alt: '', loading: 'lazy' })
                : h('span', { class: 'thumb', style: { display: 'grid', placeItems: 'center' } }, icon('image', { size: 16 })),
              h('div', null, h('div', { class: 'cell-title' }, h('a', { href: `#/projects/${p.id}` }, p.title)),
                h('div', { class: 'cell-sub' }, [p.category, `/${p.slug}`].filter(Boolean).join(' · '))))),
            h('td', { data: { label: 'Status' } }, projectStatusBadge(p)),
            h('td', { data: { label: 'Featured' } }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', aria: { pressed: String(p.is_featured) },
              title: p.is_featured ? 'Click to unfeature' : 'Click to feature', on: { click: () => toggleFeatured(p) } },
            h('span', { style: { color: p.is_featured ? 'var(--warning)' : 'var(--subtle)' } }, icon('star', { size: 16 })), 'Featured',
            h('span', { class: 'sr-only' }, `: ${p.title}`))),
            h('td', { data: { label: 'Updated' } }, h('span', { title: formatDateTime(p.updated_at) }, relativeTime(p.updated_at))),
            h('td', null, h('div', { class: 'cell-actions' },
              btn('Edit', { icon: 'edit', size: 'sm', href: `#/projects/${p.id}` }),
              btn('', { icon: 'eye', size: 'sm', variant: 'ghost', title: 'Preview',
                href: `#/preview?path=${encodeURIComponent(`project.html?slug=${p.slug}`)}` }),
              live ? btn('Unpublish', { size: 'sm', variant: 'ghost', onClick: () => setStatus(p, 'draft') })
                : btn('Publish', { size: 'sm', variant: 'ghost', onClick: () => setStatus(p, 'published') }),
              p.status !== 'archived' && btn('', { icon: 'archive', size: 'sm', variant: 'ghost', title: 'Archive', onClick: () => setStatus(p, 'archived') }),
              btn('', { icon: 'history', size: 'sm', variant: 'ghost', title: 'Version history',
                onClick: () => openHistory({ entityType: 'project', entityId: p.id, table: 'projects', title: p.title, onRestored: load }) }),
              btn('', { icon: 'trash', size: 'sm', variant: 'ghost', title: 'Delete', onClick: () => remove(p) }))));
        }))),
      list.length > PAGE && pager({ page: state.page, pageSize: PAGE, total: list.length, onPage: (n) => { state.page = n; draw(); } })),
    canReorder ? h('p', { class: 'small muted mt-4' }, 'Use the arrows to set the order projects appear in on the site. Featured projects are shown first.')
      : h('p', { class: 'small muted mt-4' }, 'Clear search and filters to reorder.'));
  }

  mount(root,
    pageHeader({ title: 'Projects', desc: 'Case studies shown on your portfolio. Only published projects are visible to visitors.',
      actions: [btn('New project', { icon: 'plus', variant: 'primary', href: '#/projects/new' })] }),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), statusSel),
    body);
  load();
}
