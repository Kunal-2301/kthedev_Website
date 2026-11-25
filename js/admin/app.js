// Admin entry point: authentication gate, shell, router, notifications.
// Route protection here is a UX layer only — the database independently
// rejects every non-admin request through RLS and is_admin() checks.
import { h, mount, $, relativeTime } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { isConfigured } from '../config.js';
import { db, rpc, data, friendlyError, setSessionExpiredHandler } from './api.js';
import { toast, confirmDiscard, btn } from './ui.js';

const root = $('#app');

// ---------------------------------------------------------------- routes
const NAV = [
  { group: null, items: [{ path: '/', label: 'Overview', icon: 'home', page: 'overview' }] },
  { group: 'Content', items: [
    { path: '/projects', label: 'Projects', icon: 'folder', page: 'projects' },
    { path: '/skills', label: 'Skills', icon: 'layers', page: 'skills' },
    { path: '/experience', label: 'Experience', icon: 'briefcase', page: 'experience' },
    { path: '/education', label: 'Education', icon: 'graduation', page: 'education' },
    { path: '/certifications', label: 'Certifications', icon: 'award', page: 'certifications' },
  ] },
  { group: 'Inbox', items: [{ path: '/messages', label: 'Messages', icon: 'inbox', page: 'messages', count: 'messages' }] },
  { group: 'Site', items: [
    { path: '/profile', label: 'Profile', icon: 'user', page: 'profile' },
    { path: '/resume', label: 'Resume', icon: 'file', page: 'resume' },
    { path: '/navigation', label: 'Navigation', icon: 'compass', page: 'navigation' },
    { path: '/settings', label: 'Website settings', icon: 'settings', page: 'settings' },
  ] },
  { group: 'Insights', items: [
    { path: '/analytics', label: 'Analytics', icon: 'chart', page: 'analytics' },
    { path: '/scheduled', label: 'Scheduled', icon: 'clock', page: 'scheduled' },
    { path: '/activity', label: 'Activity logs', icon: 'activity', page: 'activity' },
  ] },
];

const ROUTES = [
  [/^\/$/, 'overview'],
  [/^\/projects$/, 'projects'],
  [/^\/projects\/(new|[0-9a-f-]{36})$/, 'project-editor'],
  [/^\/skills$/, 'skills'],
  [/^\/(experience|education|certifications|navigation)$/, 'collections'],
  [/^\/messages$/, 'messages'],
  [/^\/(profile|settings)$/, 'singleton'],
  [/^\/resume$/, 'resume'],
  [/^\/analytics$/, 'analytics'],
  [/^\/scheduled$/, 'scheduled'],
  [/^\/activity$/, 'activity'],
  [/^\/preview$/, 'preview'],
];

// ---------------------------------------------------------------- state
const state = { user: null, guard: null, cleanup: null, lastHash: location.hash || '#/', ignoreHash: false, notifTimer: null };
export const app = {
  get user() { return state.user; },
  setGuard(fn) { state.guard = fn; },
  navigate(path) { location.hash = `#${path}`; },
  refreshCounts: () => refreshCounts(),
};

// ---------------------------------------------------------------- auth views
function authCard(title, sub, ...body) {
  return h('main', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand-mark', aria: { hidden: 'true' } }, 'KG'),
    h('div', null, h('h1', null, title), sub && h('p', { class: 'sub' }, sub)), ...body));
}
const alertBox = () => h('div', { role: 'alert', aria: { live: 'assertive' } });
function showAlert(box, type, msg) {
  mount(box, msg ? h('div', { class: `alert alert-${type}` }, icon(type === 'error' ? 'alert' : type === 'success' ? 'checkCircle' : 'info'),
    h('div', { class: 'grow' }, msg)) : null);
}

function field(id, label, attrs) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { class: 'input', id, ...attrs }));
}

function loginView(message) {
  const box = alertBox();
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
  const form = h('form', { novalidate: true },
    field('email', 'Email', { type: 'email', autocomplete: 'username', required: true, inputmode: 'email', spellcheck: 'false' }),
    field('password', 'Password', { type: 'password', autocomplete: 'current-password', required: true }),
    submit,
    h('div', { class: 'auth-links' },
      h('button', { class: 'link-btn', type: 'button', on: { click: () => mount(root, forgotView()) } }, 'Forgot password?'),
      h('a', { href: '../index.html' }, 'View site')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) return showAlert(box, 'error', 'Enter your email and password.');
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    showAlert(box);
    try {
      const { error } = await db().auth.signInWithPassword({ email, password });
      if (error) {
        const msg = /invalid login credentials/i.test(error.message) ? 'Incorrect email or password.'
          : /email not confirmed/i.test(error.message) ? 'This email address has not been confirmed yet.'
          : /rate limit|too many/i.test(error.message) ? 'Too many attempts. Please wait a few minutes and try again.'
          : friendlyError(error);
        throw new Error(msg);
      }
      form.password.value = '';
      await enter({ fromLogin: true });
    } catch (err) {
      showAlert(box, 'error', err.message);
      form.password.focus();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });
  if (message) showAlert(box, message.type, message.text);
  setTimeout(() => form.email.focus(), 0);
  return authCard('Sign in', 'Portfolio administration', box, form);
}

function forgotView() {
  const box = alertBox();
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send reset link');
  const form = h('form', { novalidate: true },
    field('email', 'Email', { type: 'email', autocomplete: 'username', required: true, inputmode: 'email' }), submit,
    h('div', { class: 'auth-links' }, h('button', { class: 'link-btn', type: 'button', on: { click: () => mount(root, loginView()) } }, 'Back to sign in')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!email) return showAlert(box, 'error', 'Enter your email address.');
    submit.disabled = true;
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await db().auth.resetPasswordForEmail(email, { redirectTo });
    submit.disabled = false;
    // Same message either way: never reveal whether an account exists.
    if (error && /rate limit/i.test(error.message)) showAlert(box, 'error', 'Too many requests. Please try again later.');
    else showAlert(box, 'success', 'If an administrator account exists for this email, a reset link is on its way.');
  });
  return authCard('Reset password', 'We will email you a secure link.', box, form);
}

function resetView() {
  const box = alertBox();
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Update password');
  const form = h('form', { novalidate: true },
    field('pw1', 'New password', { type: 'password', autocomplete: 'new-password', minlength: 12 }),
    field('pw2', 'Confirm new password', { type: 'password', autocomplete: 'new-password' }),
    h('p', { class: 'hint' }, 'At least 12 characters. A passphrase is a good choice.'), submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = form.pw1.value; const b = form.pw2.value;
    if (a.length < 12) return showAlert(box, 'error', 'Use at least 12 characters.');
    if (a !== b) return showAlert(box, 'error', 'The passwords do not match.');
    submit.disabled = true;
    const { error } = await db().auth.updateUser({ password: a });
    submit.disabled = false;
    if (error) return showAlert(box, 'error', friendlyError(error));
    await rpc('log_auth_event', { p_event: 'password_changed' }).catch(() => {});
    history.replaceState(null, '', location.pathname + '#/');
    toast('Password updated.');
    enter();
  });
  return authCard('Choose a new password', null, box, form);
}

// ---------------------------------------------------------------- session
async function enter({ fromLogin = false } = {}) {
  const { data: s } = await db().auth.getSession();
  if (!s.session) return mount(root, loginView());
  let isAdmin = false;
  try { isAdmin = (await rpc('is_admin')) === true; }
  catch (e) { return mount(root, loginView({ type: 'error', text: friendlyError(e) })); }

  if (!isAdmin) {
    await rpc('log_auth_event', { p_event: 'login' }).catch(() => {}); // records the unauthorized attempt
    await db().auth.signOut({ scope: 'local' });
    return mount(root, loginView({ type: 'error', text: 'This account is not authorized to access the dashboard.' }));
  }
  state.user = s.session.user;
  if (fromLogin) rpc('log_auth_event', { p_event: 'login' }).catch(() => {});
  renderShell();
  route();
}

async function logout() {
  if (state.guard?.() && !(await confirmDiscard())) return;
  state.guard = null;
  await rpc('log_auth_event', { p_event: 'logout' }).catch(() => {});
  await db().auth.signOut({ scope: 'global' }); // revokes refresh tokens on all devices
  state.user = null;
  clearInterval(state.notifTimer);
  history.replaceState(null, '', location.pathname);
  mount(root, loginView({ type: 'success', text: 'You have been signed out.' }));
}

setSessionExpiredHandler(() => {
  if (!state.user) return;
  state.user = null;
  state.guard = null;
  db().auth.signOut({ scope: 'local' });
  mount(root, loginView({ type: 'info', text: 'Your session expired. Please sign in again — unsaved form drafts are kept in this browser.' }));
});

// ---------------------------------------------------------------- shell
let sidebar, scrim, content, countEls = {}, bell;

function renderShell() {
  const closeSidebar = () => { sidebar.classList.remove('open'); scrim.classList.remove('open'); };
  sidebar = h('aside', { class: 'sidebar', id: 'sidebar', aria: { label: 'Dashboard navigation' } },
    h('a', { class: 'sidebar-brand', href: '#/' }, h('span', { class: 'brand-mark' }, 'KG'),
      h('span', null, 'Portfolio CMS', h('small', null, 'Kunal Gupta'))),
    NAV.map((g) => h('nav', { class: 'nav-group', aria: { label: g.group || 'Main' } },
      g.group && h('div', { class: 'nav-group-title' }, g.group),
      g.items.map((it) => {
        const count = it.count ? (countEls[it.count] = h('span', { class: 'count', hidden: true })) : null;
        return h('a', { class: 'side-link', href: `#${it.path}`, data: { path: it.path }, on: { click: closeSidebar } }, icon(it.icon), it.label, count);
      }))),
    h('div', { class: 'sidebar-foot' },
      h('a', { class: 'side-link', href: '../index.html', target: '_blank', rel: 'noopener' }, icon('external'), 'View live site'),
      h('button', { class: 'side-link', type: 'button', on: { click: logout } }, icon('logout'), 'Log out'),
      h('div', { class: 'who', title: state.user.email }, state.user.email)));
  scrim = h('div', { class: 'scrim', on: { click: closeSidebar } });
  content = h('main', { class: 'content', id: 'content', tabindex: '-1' });
  bell = notificationsBell();
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'btn btn-ghost btn-icon menu-btn', type: 'button', aria: { label: 'Open navigation', controls: 'sidebar' },
      on: { click: () => { sidebar.classList.add('open'); scrim.classList.add('open'); sidebar.querySelector('a')?.focus(); } } }, icon('menu')),
    h('div', { class: 'spacer' }),
    btn('Preview site', { icon: 'eye', size: 'sm', href: '#/preview?path=index.html' }),
    bell.el);
  mount(root, h('a', { class: 'skip-link', href: '#content' }, 'Skip to content'),
    h('div', { class: 'shell' }, sidebar, scrim, h('div', { class: 'main-col' }, topbar, content)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar(); });
  refreshCounts();
  clearInterval(state.notifTimer);
  state.notifTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshCounts(); }, 60_000);
}

async function refreshCounts() {
  try {
    const { count } = await db().from('contact_messages').select('id', { count: 'exact', head: true }).eq('status', 'unread');
    const el = countEls.messages;
    if (el) { el.hidden = !count; el.textContent = count > 99 ? '99+' : String(count || ''); }
    bell?.refresh();
  } catch { /* non-critical */ }
}

const NOTIF_ICON = { contact_message: 'inbox', publish_success: 'checkCircle', publish_failure: 'alert', upload_failure: 'alert', security: 'lock', info: 'info' };

function notificationsBell() {
  const badge = h('span', { class: 'notif-badge', hidden: true });
  const list = h('ul', { class: 'notif-list' });
  const panel = h('div', { class: 'notif-panel', hidden: true, role: 'dialog', aria: { label: 'Notifications' } },
    h('header', null, h('h2', null, 'Notifications'),
      btn('Mark all read', { size: 'sm', variant: 'ghost', onClick: async () => {
        await db().from('notifications').update({ is_read: true }).eq('is_read', false);
        refresh();
      } })), list);
  const toggle = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', aria: { label: 'Notifications', expanded: 'false', haspopup: 'dialog' },
    on: { click: () => { const open = panel.hidden; panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); if (open) refresh(); } } },
  icon('bell'), badge);
  document.addEventListener('click', (e) => { if (!el.contains(e.target)) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } });
  const el = h('div', { class: 'notif-wrap' }, toggle, panel);

  async function refresh() {
    try {
      const items = await data(db().from('notifications').select('*').order('created_at', { ascending: false }).limit(20));
      const unread = items.filter((n) => !n.is_read).length;
      badge.hidden = !unread;
      badge.textContent = unread > 9 ? '9+' : String(unread);
      toggle.setAttribute('aria-label', `Notifications${unread ? ` (${unread} unread)` : ''}`);
      mount(list, items.length ? items.map((n) => h('li', null, h('button', { type: 'button', class: n.is_read ? '' : 'unread', on: { click: async () => {
        panel.hidden = true;
        if (!n.is_read) await db().from('notifications').update({ is_read: true }).eq('id', n.id);
        if (n.entity_type === 'contact_message') app.navigate('/messages');
        else if (n.entity_type === 'project' && n.entity_id) app.navigate(`/projects/${n.entity_id}`);
        refresh();
      } } }, icon(NOTIF_ICON[n.kind] || 'info'), h('div', null, h('div', { class: 't' }, n.title),
        n.body && h('div', { class: 'b' }, n.body), h('div', { class: 'b' }, relativeTime(n.created_at)))))) :
        h('li', { class: 'empty small' }, 'You are all caught up.'));
    } catch { /* ignore */ }
  }
  return { el, refresh };
}

// ---------------------------------------------------------------- router
function parseHash() {
  const raw = (location.hash || '#/').slice(1);
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs || '') };
}

async function route() {
  if (!state.user || !content) return;
  const { path, query } = parseHash();
  const match = ROUTES.find(([re]) => re.test(path));
  sidebar.querySelectorAll('.side-link[data-path]').forEach((a) => {
    const p = a.dataset.path;
    a.toggleAttribute('aria-current', p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`));
    if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page');
  });
  state.cleanup?.();
  state.cleanup = null;
  state.guard = null;
  if (!match) {
    mount(content, h('div', { class: 'empty' }, h('h3', null, 'Page not found'), btn('Go to overview', { href: '#/' })));
    return;
  }
  const [re, page] = match;
  const params = path.match(re).slice(1);
  mount(content, h('div', { class: 'page-loading', aria: { busy: 'true' } }, h('div', { class: 'skeleton', style: { height: '40px', width: '40%' } }),
    h('div', { class: 'skeleton', style: { height: '240px' } })));
  try {
    const mod = await import(`./pages/${page}.js`);
    const view = await mod.render({ root: content, params, query, path, app });
    if (typeof view === 'function') state.cleanup = view;
    content.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    document.title = `${content.querySelector('h1')?.textContent || 'Dashboard'} · Portfolio CMS`;
  } catch (e) {
    console.error(e);
    mount(content, h('div', { class: 'card' }, h('div', { class: 'empty', role: 'alert' }, h('h3', null, 'This page failed to load'),
      h('p', null, friendlyError(e)), btn('Retry', { icon: 'refresh', onClick: route }))));
  }
}

window.addEventListener('hashchange', async () => {
  if (state.ignoreHash) { state.ignoreHash = false; return; }
  if (state.guard?.() && !(await confirmDiscard())) {
    state.ignoreHash = true;
    location.hash = state.lastHash;
    return;
  }
  state.lastHash = location.hash;
  route();
});

window.addEventListener('beforeunload', (e) => {
  if (state.guard?.()) { e.preventDefault(); e.returnValue = ''; }
});

// ---------------------------------------------------------------- boot
(async function boot() {
  // Clickjacking defence: GitHub Pages cannot send X-Frame-Options / frame-ancestors headers,
  // so the dashboard refuses to run inside any frame.
  if (window.top !== window.self) {
    mount(root, h('p', { style: { padding: '24px' } }, 'The dashboard cannot be displayed inside a frame.'));
    try { window.top.location = window.self.location.href; } catch { /* cross-origin: stay inert */ }
    return;
  }
  if (!isConfigured()) {
    mount(root, authCard('Setup required', null, h('div', { class: 'alert alert-warning' }, icon('alert'),
      h('div', { class: 'grow' }, 'Supabase is not configured. Add your project URL and publishable key to js/config.js — see docs/SETUP.md.'))));
    return;
  }
  const client = db();
  let recovering = /type=recovery/.test(location.hash) || /type=recovery/.test(location.search);
  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; mount(root, resetView()); }
    if (event === 'SIGNED_OUT' && state.user) {
      state.user = null;
      mount(root, loginView({ type: 'info', text: 'You have been signed out.' }));
    }
  });
  // PKCE recovery links arrive as ?code=...; supabase-js exchanges it automatically.
  const { data: s } = await client.auth.getSession();
  if (recovering || (new URLSearchParams(location.search).get('type') === 'recovery' && s.session)) return mount(root, resetView());
  if (s.session) enter(); else mount(root, loginView());
})();
