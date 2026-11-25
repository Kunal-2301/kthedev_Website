// Contact inbox: filter, search, read/unread, archive, delete, reply by email.
import { h, mount, formatDateTime, relativeTime, debounce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { db, run } from '../api.js';
import { pageHeader, btn, emptyState, loadingRows, statusBadge, confirmDialog, toast, toastError, errorState, tabs, pager } from '../ui.js';

const PAGE = 25;

export async function render({ root, query, app }) {
  const state = { status: 'inbox', q: '', page: 0, selected: query.get('id') };
  let rows = [];
  let total = 0;
  const listPane = h('div', { class: 'msg-pane' });
  const detail = h('div', { class: 'msg-detail' });
  const inbox = h('div', { class: 'inbox' }, listPane, detail);

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search name, email, subject…', aria: { label: 'Search messages' },
    on: { input: debounce((e) => { state.q = e.target.value.trim(); state.page = 0; load(); }, 250) } });

  async function load() {
    mount(listPane, loadingRows(6));
    try {
      let q = db().from('contact_messages').select('id, name, email, subject, message, status, created_at, read_at', { count: 'exact' })
        .order('created_at', { ascending: false }).range(state.page * PAGE, state.page * PAGE + PAGE - 1);
      if (state.status === 'inbox') q = q.in('status', ['unread', 'read']);
      else if (state.status !== 'all') q = q.eq('status', state.status);
      if (state.q) {
        const term = state.q.replace(/[%,()*]/g, '');
        q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%,subject.ilike.%${term}%,message.ilike.%${term}%`);
      }
      const res = await run(q);
      rows = res.data; total = res.count || 0;
      drawList();
      if (state.selected) {
        const m = rows.find((r) => r.id === state.selected);
        if (m) open(m); else drawDetail(null);
      } else drawDetail(null);
    } catch (e) { mount(listPane, errorState(e, load)); }
  }

  function drawList() {
    if (!rows.length) {
      return mount(listPane, h('div', { class: 'card' }, emptyState({ icon: 'inbox', title: state.q ? 'No matching messages' : 'No messages here',
        text: state.status === 'inbox' ? 'Messages sent through your contact form will appear here.' : null })));
    }
    mount(listPane, h('div', { class: 'table-wrap' }, h('ul', { class: 'msg-list' }, rows.map((m) => h('li', { class: m.status === 'unread' ? 'unread' : '' },
      h('button', { type: 'button', aria: { current: String(m.id === state.selected) }, on: { click: () => open(m) } },
        h('div', { class: 'row1' }, h('span', { class: 'from' }, m.name), h('span', { class: 'small muted' }, relativeTime(m.created_at))),
        h('span', { class: 'subj' }, m.subject || '(no subject)'),
        h('span', { class: 'snippet' }, m.message.slice(0, 120)))))),
    total > PAGE && pager({ page: state.page, pageSize: PAGE, total, onPage: (p) => { state.page = p; load(); } })));
  }

  async function setStatus(m, status, msg) {
    try {
      await run(db().from('contact_messages').update({ status, read_at: status === 'unread' ? null : (m.read_at || new Date().toISOString()) }).eq('id', m.id));
      m.status = status;
      if (msg) toast(msg);
      app.refreshCounts();
      if ((state.status === 'inbox' && status === 'archived') || (state.status === 'archived' && status !== 'archived') ||
          (state.status === 'unread' && status !== 'unread')) { state.selected = null; return load(); }
      drawList(); drawDetail(m);
    } catch (e) { toastError(e); }
  }

  async function open(m) {
    state.selected = m.id;
    inbox.classList.add('has-selection');
    drawList();
    drawDetail(m);
    if (m.status === 'unread') await setStatus(m, 'read');
  }

  function drawDetail(m) {
    if (!m) {
      inbox.classList.remove('has-selection');
      return mount(detail, h('div', { class: 'card' }, emptyState({ icon: 'mailOpen', title: 'Select a message', text: 'Choose a message from the list to read it.' })));
    }
    const replyHref = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${m.subject || 'Your message'}`)}`;
    mount(detail, h('article', { class: 'card' },
      h('div', { class: 'card-head' },
        btn('Back', { icon: 'arrowLeft', size: 'sm', variant: 'ghost', onClick: () => { state.selected = null; drawList(); drawDetail(null); } }),
        h('div', { class: 'row-gap' },
          btn('Reply', { icon: 'send', size: 'sm', variant: 'primary', href: replyHref }),
          m.status === 'unread' ? btn('Mark read', { icon: 'mailOpen', size: 'sm', onClick: () => setStatus(m, 'read', 'Marked as read.') })
            : btn('Mark unread', { icon: 'email', size: 'sm', onClick: () => setStatus(m, 'unread', 'Marked as unread.') }),
          m.status === 'archived' ? btn('Unarchive', { icon: 'inbox', size: 'sm', onClick: () => setStatus(m, 'read', 'Moved to inbox.') })
            : btn('Archive', { icon: 'archive', size: 'sm', onClick: () => setStatus(m, 'archived', 'Archived.') }),
          btn('', { icon: 'trash', size: 'sm', variant: 'ghost', title: 'Delete', onClick: async () => {
            if (!(await confirmDialog({ title: 'Delete this message permanently?', message: 'Messages are not kept in version history.', confirmText: 'Delete', danger: true }))) return;
            try { await run(db().from('contact_messages').delete().eq('id', m.id)); toast('Message deleted.'); state.selected = null; app.refreshCounts(); load(); }
            catch (e) { toastError(e); }
          } }))),
      h('div', { class: 'card-body stack' },
        h('div', null, h('h2', { style: { fontSize: 'var(--text-lg)' } }, m.subject || '(no subject)'),
          h('div', { class: 'meta', style: { marginTop: '6px' } },
            h('div', null, h('strong', null, m.name), ' · ', h('a', { href: `mailto:${m.email}` }, m.email)),
            h('div', null, formatDateTime(m.created_at), ' · ', statusBadge(m.status)))),
        h('div', { class: 'msg-body' }, m.message))));
    detail.querySelector('h2')?.setAttribute('tabindex', '-1');
  }

  const tabBar = tabs([{ id: 'inbox', label: 'Inbox' }, { id: 'unread', label: 'Unread' }, { id: 'archived', label: 'Archived' }, { id: 'all', label: 'All' }],
    'inbox', (id) => { state.status = id; state.page = 0; state.selected = null; load(); });

  mount(root, pageHeader({ title: 'Messages', desc: 'Submissions from your contact form. Spam is filtered and rate-limited on the server before it reaches this inbox.' }),
    tabBar, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search)), inbox);
  load();
}
