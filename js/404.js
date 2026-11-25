// GitHub Pages serves 404.html for unknown paths. Projects published in /admin after
// the last deploy have no static /projects/<slug>/ page yet — send visitors to the
// dynamic case-study page instead (the next deploy or the daily build adds the static page).
(function () {
  var m = /^(.*\/)projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(location.pathname);
  if (m) location.replace(m[1] + 'project.html?slug=' + m[2]);
})();
