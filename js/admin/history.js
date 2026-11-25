// Version history drawer: list snapshots, view one, restore with confirmation.
import { h, formatDateTime, relativeTime } from '../core/dom.js';
import { db, data, rpc } from './api.js';
import { drawer, btn, confirmDialog, toast, toastError, emptyState, loadingRows } from './ui.js';

const HIDDEN_KEYS = new Set(['id', 'created_at', 'created_by', 'updated_by', 'revision', '_images', '_technologies']);
const LABELS = { project: 'project', profile: 'profile', settings: 'website settings', skill: 'skill', experience: 'experience entry',
  education: 'education entry', certification: 'certification', resume: 'resume' };

let adminEmails = null;
async function emails() {
  if (adminEmails) return adminEmails;
  const rows = await data(db().from('admin_users').select('user_id, email'));
  adminEmails = Object.fromEntries(rows.map((r) => [r.user_id, r.email]));
  return adminEmails;
}

function renderValue(v) {
  if (v === null || v === undefined || v === '') return h('span', { class: 'muted' }, '—');
  if (Array.isArray(v)) return v.length ? h('ul', { style: { margin: 0, paddingLeft: '1.1em' } }, v.map((x) => h('li', null, typeof x === 'object' ? JSON.stringify(x) : String(x)))) : h('span', { class: 'muted' }, '—');
  if (typeof v === 'object') return h('div', { class: 'json-view' }, JSON.stringify(v, null, 2));
  const s = String(v);
  return s.length > 400 ? h('div', { class: 'json-view' }, s) : s;
}

/** Field-by-field comparison of a snapshot against the current row. */
function snapshotView(snapshot, current) {
  const keys = Object.keys(snapshot).filter((k) => !HIDDEN_KEYS.has(k));
  return h('dl', { class: 'kv' }, keys.flatMap((k) => {
    const changed = current && JSON.stringify(current[k] ?? null) !== JSON.stringify(snapshot[k] ?? null);
    return [h('dt', null, k.replace(/_/g, ' '), changed && h('span', { class: 'status status-scheduled', style: { marginLeft: '6px' } }, 'differs')),
      h('dd', { class: changed ? 'diff-old' : '' }, renderValue(snapshot[k]))];
  }));
}

export async function openHistory({ entityType, entityId, table, title, onRestored }) {
  const d = drawer({ title: `History — ${title || LABELS[entityType]}`, body: loadingRows(4), footer: btn('Close', { onClick: () => d.close() }) });
  async function load() {
    try {
      const [versions, who, current] = await Promise.all([
        data(db().from('content_versions').select('id, version_no, change_kind, changed_by, created_at')
          .eq('entity_type', entityType).eq('entity_id', String(entityId)).order('version_no', { ascending: false }).limit(100)),
        emails(),
        table ? data(db().from(table).select('*').eq('id', entityId).maybeSingle()) : null,
      ]);
      if (!versions.length) {
        return d.setBody(emptyState({ icon: 'history', title: 'No previous versions yet',
          text: 'A snapshot is saved automatically before every significant change, so you can always go back.' }));
      }
      d.setBody(h('p', { class: 'muted small', style: { marginBottom: '12px' } },
        'Each entry is the content as it was before a change. Restoring replaces the current content; the current version is kept in history too.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Version'), h('th', null, 'Saved'), h('th', null, 'By'), h('th', null, ''))),
        h('tbody', null, versions.map((v) => h('tr', null,
          h('td', { data: { label: 'Version' } }, h('div', { class: 'cell-title' }, `v${v.version_no}`),
            h('div', { class: 'cell-sub' }, v.change_kind === 'delete' ? 'Before deletion' : 'Before update')),
          h('td', { data: { label: 'Saved' } }, h('span', { title: formatDateTime(v.created_at) }, relativeTime(v.created_at))),
          h('td', { data: { label: 'By' } }, who[v.changed_by] || (v.changed_by ? 'Former admin' : 'System (scheduler)')),
          h('td', null, h('div', { class: 'cell-actions' },
            btn('View', { size: 'sm', onClick: () => view(v, current) }),
            btn('Restore', { size: 'sm', icon: 'history', onClick: () => restore(v) })))))))));
    } catch (e) { d.setBody(emptyState({ icon: 'alert', title: 'Could not load history', text: e.message })); }
  }
  async function view(v, current) {
    const full = await data(db().from('content_versions').select('snapshot').eq('id', v.id).single()).catch(toastError);
    if (!full) return;
    d.setBody(btn('Back to versions', { icon: 'arrowLeft', size: 'sm', variant: 'ghost', onClick: load }),
      h('h3', { style: { margin: '12px 0' } }, `Version ${v.version_no} · ${formatDateTime(v.created_at)}`),
      snapshotView(full.snapshot, current),
      h('div', { class: 'mt-6' }, btn('Restore this version', { icon: 'history', variant: 'primary', onClick: () => restore(v) })));
  }
  async function restore(v) {
    const ok = await confirmDialog({
      title: `Restore version ${v.version_no}?`,
      message: v.change_kind === 'delete'
        ? 'This re-creates the deleted item as a draft. Nothing will be visible publicly until you publish it.'
        : 'The current content will be replaced by this version. Publication status is kept as it is now. The current content is saved to history first.',
      confirmText: 'Restore version',
    });
    if (!ok) return;
    try {
      await rpc('restore_version', { p_version_id: v.id });
      toast(`Version ${v.version_no} restored.`);
      await d.close(true);
      onRestored?.();
    } catch (e) { toastError(e); }
  }
  load();
}
