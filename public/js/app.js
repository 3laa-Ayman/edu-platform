/* Hash router + top navigation. */
const ROUTES = [
  ['/login', Views.login, 'guest'],
  ['/register', Views.register, 'guest'],
  ['/verify', Views.verify, 'guest'],
  ['/forgot', Views.forgot, 'guest'],
  ['/', Views.home, 'student'],
  ['/practice', Views.practice, 'student'],
  ['/mistakes', Views.mistakes, 'student'],
  ['/competitions', Views.competitions, 'student'],
  ['/competition/:id', Views.competition, 'user'],
  ['/team', Views.team, 'student'],
  ['/planner', Views.planner, 'student'],
  ['/subscribe', Views.subscribe, 'student'],
  ['/offers', Views.offers, 'user'],
  ['/report', Views.report, 'student'],
  ['/admin', Admin.dashboard, 'admin'],
  ['/admin/questions', Admin.questions, 'admin'],
  ['/admin/payments', Admin.payments, 'admin'],
  ['/admin/competitions', Admin.competitions, 'admin'],
  ['/admin/students', Admin.students, 'admin'],
  ['/admin/student/:id', Admin.student, 'admin'],
  ['/admin/subjects', Admin.subjects, 'admin'],
  ['/admin/plans', Admin.plans, 'admin'],
  ['/admin/teams', Admin.teams, 'admin'],
  ['/admin/products', Admin.products, 'admin'],
  ['/admin/settings', Admin.settings, 'admin'],
];

const NAV = {
  student: [['/', 'الرئيسية'], ['/practice', 'التدريب'], ['/mistakes', 'بنك الأخطاء'], ['/competitions', 'المسابقات'], ['/team', 'التيم'],
    ['/planner', 'المذاكرة'], ['/subscribe', 'الاشتراك'], ['/offers', 'العروض']],
  admin: [['/admin', 'اللوحة'], ['/admin/questions', 'الأسئلة'], ['/admin/subjects', 'المواد'], ['/admin/students', 'الطلاب'],
    ['/admin/payments', 'المدفوعات'], ['/admin/plans', 'الباقات'], ['/admin/competitions', 'المسابقات'], ['/admin/teams', 'التيمات'],
    ['/admin/products', 'المنتجات'], ['/admin/settings', 'الإعدادات']],
};

function matchRoute(path) {
  for (const [pattern, view, access] of ROUTES) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    const m = path.match(re);
    if (m) return { view, access, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

const Site = { name: 'منصة المذاكرة' };
async function loadSiteSettings() {
  try {
    const s = await API.get('/settings/public');
    Site.name = s.site_name || Site.name;
    document.title = Site.name;
  } catch { /* keep default */ }
}

function renderTopbar(path) {
  const u = State.user;
  const links = u ? NAV[u.role === 'admin' ? 'admin' : 'student'] : [];
  $('#topbar').innerHTML = `<div class="container topbar-inner">
    <a class="brand" href="#/">📚 ${esc(Site.name)}</a>
    ${u ? `<nav class="nav">${links.map(([href, label]) => `<a href="#${href}" class="${href === path || (path.startsWith('/admin/student/') && href === '/admin/students') ? 'active' : ''}">${label}</a>`).join('')}</nav>
      <div class="user"><span class="mono">${esc(u.student_code || 'Admin')}</span><button class="btn tiny ghost" id="logout">خروج</button></div>`
    : '<nav class="nav"><a href="#/login">دخول</a><a href="#/register">حساب جديد</a></nav>'}
  </div>`;
  $('#logout')?.addEventListener('click', () => {
    API.setToken(null);
    State.user = null;
    State.subscription = null;
    location.hash = '#/login';
  });
}

async function render() {
  Cleanup.forEach((fn) => fn());
  closeModal();
  const [rawPath, rawQuery = ''] = (location.hash.slice(1) || '/').split('?');
  const path = rawPath || '/';
  const query = Object.fromEntries(new URLSearchParams(rawQuery));

  if (API.token && !State.user) {
    try { await State.refresh(); } catch { API.setToken(null); }
  }
  const route = matchRoute(path);
  const u = State.user;
  const home = u?.role === 'admin' ? '#/admin' : '#/';

  if (!route) { location.hash = home; return; }
  if (route.access === 'guest' && u) { location.hash = home; return; }
  if (route.access !== 'guest' && !u) { location.hash = '#/login'; return; }
  if (route.access === 'admin' && u.role !== 'admin') { location.hash = '#/'; return; }
  if (route.access === 'student' && u.role === 'admin') { location.hash = '#/admin'; return; }

  renderTopbar(path);
  // Fresh element per navigation so listeners from the previous page never leak.
  const el = document.createElement('div');
  el.className = 'view';
  $('#app').replaceChildren(el);
  el.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  try {
    await route.view(el, route.params, query);
  } catch (err) {
    if (isSubError(err)) subscriptionWall(el, err);
    else el.innerHTML = `<div class="card center"><h2>حصلت مشكلة</h2><p class="muted">${esc(errorText(err))}</p>
      <button class="btn primary" data-retry>حاول تاني</button></div>`;
    $('[data-retry]', el)?.addEventListener('click', render);
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
loadSiteSettings().finally(render);
