/* Loaded in <head> (before the page paints) so the theme applies without a flash.
   Dark is the default; a student who picks light (☀️) keeps it — the choice is saved on the device. */
(function () {
  var saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) { /* storage unavailable */ }
  document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
}());
