// Scheduled content: upcoming publishes, auto-unpublishes and scheduled updates.
// Execution is server-side (pg_cron, every minute) — this page only views/edits/cancels.
import { h, mount, formatDateTime, relativeTime } from '../../core/dom.js';
import { db, data, run, rpc } from '../api.js';
import { pageHeader, btn, busy, statusBadge, confirmDialog, toast, toastError, errorState, loadingRows } from '../ui.js';

export async function render({ root }) {
  const body = h('div', { class: 'stack' });

  async function load() {
    mount(body, loadingRows(4));
    try {
      const nowIso = new Date().toISOString();
      const [toPublish, toUnpublish, updates] = await Promise.all([
        data(db().from('projects').select('id, title, slug, publish_at').eq('status', 'scheduled').order('publish_at')),
        data(db().from('projects').select('id, title, status, unpublish_at').not('unpublish_at', 'is', null).gt('unpublish_at', nowIso).order('unpublish_at')),
        data(db().from('scheduled_updates').select('id, entity_id, run_at, status, error, created_at, payload->project->>title')
          .in('status', ['pending', 'failed']).order('run_at')),
      ]);

      const table = (title, rows, cols, empty) => h('section', { class: 'table-wrap' },
        h('div', { class: 'card-head' }, h('h2', null, title), h('span', { class: 'small muted' }, String(rows.length))),
        rows.length ? h('table', { class: 'data' }, h('tbody', null, rows.map((r) => h('tr', null, cols.map((c) => h('td', { data: { label: c.label } }, c.render(r)))))))
          : h('div', { class: 'card-body' }, h('p', { class: 'small muted' }, empty)));

      mount(body,
        table('Scheduled to publish', toPublish, [
          { label: 'Project', render: (p) => h('a', { class: 'cell-title', href: `#/projects/${p.id}` }, p.title) },
          { label: 'Publishes', render: (p) => [formatDateTime(p.publish_at), h('div', { class: 'cell-sub' }, new Date(p.publish_at) <= new Date() ? 'Due — publishing within a minute' : relativeTime(p.publish_at))] },
          { label: '', render: (p) => h('div', { class: 'cell-actions' }, btn('Edit', { size: 'sm', icon: 'edit', href: `#/projects/${p.id}` }),
            btn('Cancel', { size: 'sm', variant: 'ghost', onClick: async () => {
              if (!(await confirmDialog({ title: `Cancel scheduled publishing of “${p.title}”?`, message: 'The project returns to draft.', confirmText: 'Cancel schedule', cancelText: 'Keep' }))) return;
              try { await run(db().from('projects').update({ status: 'draft', publish_at: null }).eq('id', p.id)); toast('Schedule cancelled.'); load(); }
              catch (e) { toastError(e); }
            } })) },
        ], 'Nothing is scheduled. Set a project’s status to “Scheduled” in its Publishing tab.'),
        table('Scheduled to unpublish', toUnpublish, [
          { label: 'Project', render: (p) => h('a', { class: 'cell-title', href: `#/projects/${p.id}` }, p.title) },
          { label: 'Unpublishes', render: (p) => [formatDateTime(p.unpublish_at), h('div', { class: 'cell-sub' }, relativeTime(p.unpublish_at))] },
          { label: '', render: (p) => h('div', { class: 'cell-actions' }, btn('Keep published', { size: 'sm', variant: 'ghost', onClick: async () => {
            try { await run(db().from('projects').update({ unpublish_at: null }).eq('id', p.id)); toast('Automatic unpublishing cancelled.'); load(); }
            catch (e) { toastError(e); }
          } })) },
        ], 'No automatic unpublishing is scheduled.'),
        table('Scheduled updates', updates, [
          { label: 'Project', render: (u) => h('a', { class: 'cell-title', href: `#/projects/${u.entity_id}` }, u.title || 'Project') },
          { label: 'Applies', render: (u) => [formatDateTime(u.run_at), u.error && h('div', { class: 'cell-sub', style: { color: 'var(--danger)' } }, u.error)] },
          { label: 'Status', render: (u) => statusBadge(u.status) },
          { label: '', render: (u) => h('div', { class: 'cell-actions' }, btn('Cancel', { size: 'sm', variant: 'ghost', onClick: async () => {
            if (!(await confirmDialog({ title: 'Cancel this scheduled update?', confirmText: 'Cancel update', cancelText: 'Keep' }))) return;
            try { await run(db().from('scheduled_updates').update({ status: 'cancelled' }).eq('id', u.id)); toast('Update cancelled.'); load(); }
            catch (e) { toastError(e); }
          } })) },
        ], 'No scheduled updates. Create one from a published project’s Publishing tab.'));
    } catch (e) { mount(body, errorState(e, load)); }
  }

  const runNow = btn('Run scheduler now', { icon: 'refresh' });
  runNow.addEventListener('click', () => busy(runNow, async () => {
    try {
      const r = await rpc('run_scheduled_now');
      toast(`Scheduler ran: ${r.published} published, ${r.unpublished} unpublished, ${r.updates_applied} updates applied${r.failed ? `, ${r.failed} failed` : ''}.`, r.failed ? 'error' : 'success');
      load();
    } catch (e) { toastError(e); }
  }));

  mount(root,
    pageHeader({ title: 'Scheduled content', actions: [runNow],
      desc: 'Scheduling runs inside the database every minute (pg_cron), so it works even when this dashboard is closed. Due content is also hidden/shown correctly the moment its time passes.' }),
    body);
  load();
}
