// Loaded synchronously in <head> to apply the theme before first paint (no flash).
(function () {
  var t = null;
  try { t = localStorage.getItem('kg:theme'); } catch { /* storage unavailable */ }
  document.documentElement.setAttribute('data-theme', t === 'dark' || t === 'light' ? t : 'light');
  document.documentElement.classList.add('js');
})();
