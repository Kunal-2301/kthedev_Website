// Live preview of the public site with drafts, in desktop / tablet / mobile frames.
// The public pages only show drafts when ?preview=1 AND the viewer is a signed-in admin.
import { h, mount } from '../../core/dom.js';
import { pageHeader, btn } from '../ui.js';

const DEVICES = [
  { id: 'desktop', label: 'Desktop', icon: 'monitor', w: 1280, h: 800 },
  { id: 'tablet', label: 'Tablet', icon: 'tablet', w: 820, h: 1180 },
  { id: 'mobile', label: 'Mobile', icon: 'smartphone', w: 390, h: 844 },
];
const ALLOWED = /^(index\.html|project\.html\?slug=[a-z0-9-]+)(#[a-z-]+)?$/;

export async function render({ root, query }) {
  const raw = query.get('path') || 'index.html';
  const path = ALLOWED.test(raw) ? raw : 'index.html';
  const back = /^\/[a-z0-9/-]*$/.test(query.get('back') || '') ? query.get('back') : null;
  const src = `../${path}${path.includes('?') ? '&' : '?'}preview=1`;
  let device = DEVICES[0];

  const iframe = h('iframe', { src, title: 'Site preview', loading: 'eager' });
  const frame = h('div', { class: 'device' }, iframe);
  const wrap = h('div', { class: 'preview-frame-wrap' }, frame);
  const buttons = DEVICES.map((d) => btn(d.label, { icon: d.icon, size: 'sm', onClick: () => { device = d; fit(); } }));

  function fit() {
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(DEVICES[i] === device)));
    const avail = wrap.clientWidth - 32;
    const scale = Math.min(1, avail / device.w);
    iframe.style.width = `${device.w}px`;
    iframe.style.height = `${device.h}px`;
    frame.style.transformOrigin = 'top left';
    frame.style.transform = `scale(${scale})`;
    frame.style.width = `${device.w}px`;
    frame.style.marginLeft = `${Math.max(0, (avail - device.w * scale) / 2)}px`;
    wrap.style.height = `${device.h * scale + 34}px`;
  }
  const ro = new ResizeObserver(fit);

  mount(root,
    pageHeader({ title: 'Preview', crumbs: back ? [{ label: 'Back to editor', href: `#${back}` }, { label: 'Preview' }] : [],
      desc: 'Draft preview: includes unpublished content and is only visible to you. Visitors see published content only.',
      actions: [h('div', { class: 'row-gap', role: 'group', aria: { label: 'Device size' } }, buttons),
        btn('Reload', { icon: 'refresh', size: 'sm', variant: 'ghost', onClick: () => { iframe.src = src; } }),
        btn('Open in new tab', { icon: 'external', size: 'sm', variant: 'ghost', href: src })] }),
    wrap);
  ro.observe(wrap);
  fit();
  return () => ro.disconnect();
}
