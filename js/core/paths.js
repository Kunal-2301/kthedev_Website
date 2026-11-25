// Site-root-relative URLs that work from any page depth (/, /projects/<slug>/)
// and under a GitHub Pages project sub-path. This module lives in js/core/,
// so the site root is two directories up from it.
export const rootUrl = new URL('../../', import.meta.url).href;

/** Absolute URL for a path relative to the site root, e.g. siteHref('index.html#about'). */
export const siteHref = (path = '') => new URL(path, rootUrl).href;

/** Public case-study URL. Drafts (preview) only exist on the dynamic page. */
export function projectHref(slug, { preview = false } = {}) {
  const s = encodeURIComponent(slug);
  return preview ? siteHref(`project.html?slug=${s}&preview=1`) : siteHref(`projects/${s}/`);
}

/** Slug of the current project page: ?slug=… or /projects/<slug>/ */
export function currentProjectSlug() {
  const q = new URLSearchParams(location.search).get('slug');
  if (q) return q.toLowerCase();
  const m = /\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?(?:index\.html)?$/.exec(location.pathname);
  return m ? m[1] : '';
}
