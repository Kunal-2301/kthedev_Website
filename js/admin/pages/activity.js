// Activity log (immutable audit trail) + recent versions across all content.
import { h, mount, formatDateTime, relativeTime, debounce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { db, run } from '../api.js';
import { pageHeader, emptyState, loadingRows, pager, errorState, btn, tabs } from '../ui.js';
import { openHistory } from '../history.js';

const ICONS = { project: 'folder', skill: 'layers', skill_category: 'layers', experience: 'briefcase', education: 'graduation',
  certification: 'award', resume: 'file', profile: 'user', settings: 'settings', navigation: 'compass', auth: 'lock', version: 'history' };
export const activityIcon = (action) => ICONS[action.split('.')[0]] || 'activity';

const NOUN = { project: 'Project', skill: 'Skill', skill_category: 'Skill category', experience: 'Experience', education: 'Education',
  certification: 'Certification', resume: 'Resume', profile: 'Profile', settings: 'Website settings', navigation: 'Navigation link' };
const AUTH = { 'auth.login': 'Signed in', 'auth.logout': 'Signed out', 'auth.password_changed': 'Password changed',
  'auth.unauthorized_access': 'Unauthorized sign-in attempt (access denied)', 'auth.session_expired': 'Session expired' };

export function describeAction(l) {
  if (AUTH[l.action]) return AUTH[l.action] + (l.action === 'auth.unauthorized_access' && l.summary ? ` — ${l.summary}` : '');
  const [type, verb] = l.action.split('.');
  if (type === 'version') return `Restored a previous version of ${NOUN[l.entity_type]?.toLowerCase() || 'content'} (${l.summary || ''})`;
  const label = l.summary ? `“${l.summary}”` : '';
  return `${NOUN[type] || type} ${label} ${verb.replace(/_/g, ' ')}`.replace(/\s+/g, ' ').trim();
}

const VERSION_TABLES = { project: 'projects', profile: 'profiles', settings: 'site_settings', skill: 'skills', experience: 'experience',
  education: 'education', certification: 'certifications', resume: 'resumes' };

export async function render({ root }) {
  const state = { tab: 'logs', page: 0, type: '', q: '' };
  const PAGE = 30;
  const body = h('div');
  const typeSel = h('select', { class: 'select', aria: { label: 'Filter by type' }, on: { change: (e) => { state.type = e.target.value; state.page = 0; load(); } } },
    h('option', { value: '' }, 'All activity'), Object.entries({ ...NOUN, auth: 'Authentication', version: 'Restores' }).map(([k, v]) => h('option', { value: k }, v)));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search…', aria: { label: 'Search activity' },
    on: { input: debounce((e) => { state.q = e.target.value.trim(); state.page = 0; load(); }, 250) } });
  const toolbar = h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), typeSel);

  async function load() {
    mount(body, loadingRows(8));
    try {
      if (state.tab === 'logs') {
        let q = db().from('admin_activity_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false })
          .range(state.page * PAGE, state.page * PAGE + PAGE - 1);
        if (state.type) q = q.like('action', `${state.type}.%`);
        if (state.q) q = q.or(`summary.ilike.%${state.q.replace(/[%,()]/g, '')}%,action.ilike.%${state.q.replace(/[%,()]/g, '')}%`);
        const { data: rows, count } = await run(q);
        if (!rows.length) return mount(body, h('div', { class: 'card' }, emptyState({ icon: 'activity', title: 'No activity found' })));
        mount(body, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Event'), h('th', null, 'By'), h('th', null, 'When'))),
          h('tbody', null, rows.map((l) => h('tr', null,
            h('td', { data: { label: 'Event' } }, h('div', { class: 'row-gap' }, icon(activityIcon(l.action), { size: 16 }), describeAction(l))),
            h('td', { data: { label: 'By' } }, l.actor_email || 'system'),
            h('td', { data: { label: 'When' } }, h('span', { title: formatDateTime(l.created_at) }, relativeTime(l.created_at))))))),
        pager({ page: state.page, pageSize: PAGE, total: count, onPage: (p) => { state.page = p; load(); } })));
      } else {
        let q = db().from('content_versions').select('id, entity_type, entity_id, version_no, change_kind, created_at', { count: 'exact' })
          .order('created_at', { ascending: false }).range(state.page * PAGE, state.page * PAGE + PAGE - 1);
        if (state.type && VERSION_TABLES[state.type]) q = q.eq('entity_type', state.type);
        const { data: rows, count } = await run(q);
        if (!rows.length) return mount(body, h('div', { class: 'card' }, emptyState({ icon: 'history', title: 'No versions yet' })));
        mount(body, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Content'), h('th', null, 'Version'), h('th', null, 'Saved'), h('th', null, ''))),
          h('tbody', null, rows.map((v) => h('tr', null,
            h('td', { data: { label: 'Content' } }, NOUN[v.entity_type] || v.entity_type, h('div', { class: 'cell-sub' }, v.entity_id)),
            h('td', { data: { label: 'Version' } }, `v${v.version_no} · ${v.change_kind === 'delete' ? 'before deletion' : 'before update'}`),
            h('td', { data: { label: 'Saved' } }, relativeTime(v.created_at)),
            h('td', null, h('div', { class: 'cell-actions' }, btn('History', { size: 'sm', icon: 'history',
              onClick: () => openHistory({ entityType: v.entity_type, entityId: v.entity_id, table: VERSION_TABLES[v.entity_type], onRestored: load }) }))))))),
        pager({ page: state.page, pageSize: PAGE, total: count, onPage: (p) => { state.page = p; load(); } })));
      }
    } catch (e) { mount(body, errorState(e, load)); }
  }

  mount(root,
    pageHeader({ title: 'Activity logs', desc: 'An append-only audit trail of every change and sign-in. Entries cannot be edited or deleted from the dashboard.' }),
    tabs([{ id: 'logs', label: 'Activity', icon: 'activity' }, { id: 'versions', label: 'Version history', icon: 'history' }], 'logs',
      (id) => { state.tab = id; state.page = 0; search.parentElement.hidden = id === 'versions'; load(); }),
    toolbar, body);
  load();
}
