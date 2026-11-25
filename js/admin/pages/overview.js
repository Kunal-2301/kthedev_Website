// Dashboard overview: real database counts, quick actions, recent activity.
import { h, mount, relativeTime, formatDateTime } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { db, rpc, data } from '../api.js';
import { pageHeader, btn, errorState, emptyState } from '../ui.js';
import { activityIcon, describeAction } from './activity.js';

export async function render({ root, app }) {
  try {
    const [stats, logs, messages] = await Promise.all([
      rpc('dashboard_stats'),
      data(db().from('admin_activity_logs').select('*').order('created_at', { ascending: false }).limit(10)),
      data(db().from('contact_messages').select('id, name, subject, message, created_at').eq('status', 'unread')
        .order('created_at', { ascending: false }).limit(5)),
    ]);
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    const stat = (label, value, ic, href, sub) => h('a', { class: 'stat', href },
      h('span', { class: 'label' }, icon(ic), label), h('span', { class: 'value' }, String(value ?? 0)), sub && h('span', { class: 'sub' }, sub));

    const notices = [
      stats.has_profile_draft && h('div', { class: 'alert alert-warning' }, icon('edit'),
        h('div', { class: 'grow' }, 'Your profile has unpublished changes.'), btn('Review', { size: 'sm', href: '#/profile' })),
      stats.has_settings_draft && h('div', { class: 'alert alert-warning' }, icon('settings'),
        h('div', { class: 'grow' }, 'Website settings have unpublished changes.'), btn('Review', { size: 'sm', href: '#/settings' })),
      !stats.default_resume && h('div', { class: 'alert alert-info' }, icon('file'),
        h('div', { class: 'grow' }, 'No public resume is set, so the Download resume button is hidden on the site.'),
        btn('Upload resume', { size: 'sm', href: '#/resume' })),
    ].filter(Boolean);

    mount(root,
      pageHeader({ title: 'Overview', desc: `${greet} — signed in as ${app.user.email}. Every number here is live database data.`,
        actions: [btn('New project', { icon: 'plus', variant: 'primary', href: '#/projects/new' })] }),
      notices.length > 0 && h('div', { class: 'stack', style: { marginBottom: '24px' } }, notices),
      h('div', { class: 'stats' },
        stat('Total projects', stats.projects_total, 'folder', '#/projects'),
        stat('Published', stats.projects_published, 'checkCircle', '#/projects?status=published'),
        stat('Drafts', stats.projects_draft, 'edit', '#/projects?status=draft', stats.projects_scheduled ? `${stats.projects_scheduled} scheduled` : null),
        stat('Skills', stats.skills_total, 'layers', '#/skills'),
        stat('Experience', stats.experience_total, 'briefcase', '#/experience'),
        stat('Certifications', stats.certifications_total, 'award', '#/certifications'),
        stat('Unread messages', stats.messages_unread, 'inbox', '#/messages'),
        stat('Resumes', stats.resumes_total, 'file', '#/resume', stats.default_resume ? `Public: ${stats.default_resume}` : 'None public')),
      h('div', { class: 'card', style: { marginBottom: '20px' } },
        h('div', { class: 'card-head' }, h('h2', null, 'Quick actions')),
        h('div', { class: 'card-body quick-actions' },
          btn('Add new project', { icon: 'plus', href: '#/projects/new' }),
          btn('Add new skill', { icon: 'layers', href: '#/skills?new=1' }),
          btn('Add experience', { icon: 'briefcase', href: '#/experience?new=1' }),
          btn('Add certification', { icon: 'award', href: '#/certifications?new=1' }),
          btn('Edit profile', { icon: 'user', href: '#/profile' }),
          btn('Manage resume', { icon: 'file', href: '#/resume' }))),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Recent activity'), btn('View all', { size: 'sm', variant: 'ghost', href: '#/activity' })),
          h('div', { class: 'card-body' }, logs.length ? h('ul', { class: 'feed' }, logs.map((l) => h('li', null,
            h('span', { class: 'ico' }, icon(activityIcon(l.action))),
            h('div', null, h('div', null, describeAction(l)), h('div', { class: 'who' }, l.actor_email || 'system')),
            h('span', { class: 'when', title: formatDateTime(l.created_at) }, relativeTime(l.created_at))))) :
            emptyState({ icon: 'activity', title: 'No activity yet', text: 'Changes you make will be listed here.' }))),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Unread messages'), btn('Open inbox', { size: 'sm', variant: 'ghost', href: '#/messages' })),
          h('div', { class: 'card-body' }, messages.length ? h('ul', { class: 'feed' }, messages.map((m) => h('li', null,
            h('span', { class: 'ico' }, icon('email')),
            h('div', null, h('a', { href: `#/messages?id=${m.id}` }, h('strong', null, m.name)),
              h('div', { class: 'who' }, m.subject || m.message.slice(0, 80))),
            h('span', { class: 'when' }, relativeTime(m.created_at))))) :
            emptyState({ icon: 'inbox', title: 'Inbox zero', text: 'New contact form submissions will appear here.' })))));
  } catch (e) {
    mount(root, pageHeader({ title: 'Overview' }), errorState(e, () => render({ root, app })));
  }
}
