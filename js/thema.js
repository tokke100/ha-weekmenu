// Thema vóór het tekenen toepassen (geen flits). Standaard volgens het systeem.
(function () {
  var t = null;
  try { t = localStorage.getItem('wm-thema'); } catch (e) { /* geen opslag */ }
  if (t === 'licht' || t === 'donker') document.documentElement.setAttribute('data-theme', t === 'licht' ? 'light' : 'dark');
})();
