/* Loaded in <head> (before the page paints) so the saved theme applies without a flash. */
(function () {
  var saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) { /* storage unavailable */ }
  if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
}());
