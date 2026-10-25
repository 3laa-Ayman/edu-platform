/* Small DOM helpers. All user/API data goes through esc() before being placed in HTML. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (d) => (d ? new Date(d).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('ar-EG-u-nu-latn', { dateStyle: 'medium' }) : '—');
const fmtMoney = (n, digits = 2) => `${Number(n || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: digits })} ج`;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let toastTimer;
function toast(msg, type = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 4000);
}

function modal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
  return $('#modal-body');
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modal-body').innerHTML = '';
}
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/** Reads named fields of a form into an object (strings trimmed, empty → undefined). */
function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.type === 'file' || el.type === 'submit') continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else {
      const v = el.value.trim();
      out[el.name] = v === '' ? undefined : v;
    }
  }
  return out;
}

function errorText(err) {
  const details = Array.isArray(err.details) ? err.details.map((d) => d.message).join('، ') : '';
  return details ? `${err.message}: ${details}` : err.message;
}

/** Runs an async action with the button disabled and errors shown as a toast. */
async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(errorText(err), 'err');
    return undefined;
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
}

/** Adds a listener, replacing the one previously set by this helper for the same element/type (views re-render in place). */
function listen(el, type, fn) {
  el._listeners = el._listeners || {};
  if (el._listeners[type]) el.removeEventListener(type, el._listeners[type]);
  el._listeners[type] = fn;
  el.addEventListener(type, fn);
}

/** Delegated click handler: <button data-action="name"> → handlers.name(button, event). */
function onAction(el, handlers) {
  listen(el, 'click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || !el.contains(t)) return;
    const h = handlers[t.dataset.action];
    if (h) {
      e.preventDefault();
      h(t, e);
    }
  });
}

/** Form submit helper with disabled submit button + error toast. */
function onSubmit(form, fn) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(form.querySelector('[type=submit]'), () => fn(formValues(form), form));
  });
}

const bar = (percent, tone = '') => `<div class="bar ${tone}"><span style="width:${Math.max(0, Math.min(100, percent || 0))}%"></span></div>`;
const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
const empty = (text, extra = '') => `<div class="empty"><p>${esc(text)}</p>${extra}</div>`;
const percentTone = (p) => (p == null ? '' : p >= 75 ? 'good' : p >= 50 ? 'mid' : 'bad');

/** Shown when an endpoint answers 403 SUBSCRIPTION_REQUIRED / PLAN_UPGRADE_REQUIRED. */
function subscriptionWall(el, err) {
  el.innerHTML = `<div class="card center">
    <h2>${esc(err.message)}</h2>
    <p class="muted">اشترك عشان تقدر تستخدم الميزة دي.</p>
    <a class="btn primary" href="#/subscribe">عرض الباقات</a></div>`;
}
const isSubError = (err) => err.status === 403 && ['SUBSCRIPTION_REQUIRED', 'PLAN_UPGRADE_REQUIRED'].includes(err.code);

const LABELS = {
  category: { lesson: 'درس', past_exam: 'امتحان سابق' },
  paymentStatus: { pending: 'في انتظار الدفع', under_review: 'قيد المراجعة', paid: 'مدفوع', failed: 'فشل', rejected: 'مرفوض' },
  paymentTone: { pending: 'mid', under_review: 'mid', paid: 'good', failed: 'bad', rejected: 'bad' },
  provider: { paymob: 'Paymob (كارت/محفظة)', fawry: 'فوري', vodafone_cash: 'فودافون كاش', instapay: 'انستاباي' },
  compType: { team_weekly: 'مسابقة التيمات (الجمعة)', individual_monthly: 'المسابقة الشهرية الفردية' },
  compStatus: { upcoming: 'قادمة', active: 'جارية الآن', finished: 'انتهت' },
  compTone: { upcoming: '', active: 'good', finished: 'muted' },
  priority: { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' },
  feature: {
    practice: 'حل الأسئلة والتدريب',
    mistakes_bank: 'بنك الأخطاء التلقائي',
    ai_explanations: 'شرح بالذكاء الاصطناعي',
    competitions: 'المسابقات الأسبوعية والشهرية',
    parent_reports: 'تقارير لولي الأمر',
    past_exams: 'أسئلة الامتحانات السابقة',
    priority_support: 'دعم فني أولوية',
  },
};
