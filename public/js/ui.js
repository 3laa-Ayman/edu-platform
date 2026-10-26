/* Small DOM helpers. All user/API data goes through esc() before being placed in HTML. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Math-aware text: escapes HTML, then turns  10^8 / 10^{-19}  into superscripts and  H_2O / x_{12}  into subscripts.
 * Each formula run is wrapped in an LTR isolate so it reads correctly inside Arabic (RTL) sentences.
 */
const MATH_RUN = /[0-9A-Za-z(][0-9A-Za-z.,×·*/+\-−=()]*(?:[\^_](?:\{[^{}<>]*\}|[-−+]?(?:[0-9]+(?:\.[0-9]+)?|[A-Za-z]))[0-9A-Za-z.,×·*/+\-−=()]*)+/g;
// Exponent/index: {anything} or a signed number or ONE letter (so H_2O → H₂O, not H₂ₒ).
const MATH_OP = /([\^_])(?:\{([^{}<>]*)\}|([-−+]?(?:[0-9٠-٩]+(?:\.[0-9٠-٩]+)?|[A-Za-zء-ي])))/g;
const supSub = (op, v) => (op === '^' ? `<sup>${v}</sup>` : `<sub>${v}</sub>`);

/**
 * Brings every common way of typing an exponent / index to the ^ / _ notation:
 * 10 ^ 8 · 10**8 · x^(n+1) · 10 أس 8 · س تربيع / تكعيب · 3E+08 / 1.6e-19 · <sup>8</sup> · look-alike carets (ˆ ＾).
 * Unicode superscripts (10⁸) and Excel superscript formatting already arrive ready.
 */
function normalizeMath(text) {
  return String(text ?? '')
    .replace(/<sup>\s*([\s\S]*?)\s*<\/sup>/gi, '^{$1}')
    .replace(/<sub>\s*([\s\S]*?)\s*<\/sub>/gi, '_{$1}')
    .replace(/[ˆ＾]/g, '^')
    // "1.6 × 10^-19" / "3 x 10^8": keep the whole number together so it is not reordered inside Arabic text
    .replace(/(\d)\s*[×·]\s*(?=\d)/g, '$1×')
    .replace(/(\d)\s+[xX]\s+(?=10\s*(?:\^|\*\*))/g, '$1×')
    .replace(/([A-Za-z0-9)\]])\s*\*\*\s*(?=[-−+]?[A-Za-z0-9(])/g, '$1^') // x**2 (markdown **bold** is left alone)
    .replace(/\s*\^\s*/g, '^')
    .replace(/([\^_])\(([^()]*)\)/g, '$1{$2}')
    .replace(/(\S)\s+(?:أُس|أس|اس)\s+([-−+]?[0-9٠-٩]+)/g, '$1^{$2}')
    .replace(/(\S)\s+تربيع(?=$|[\s.,،؛؟?!)])/g, '$1^{2}')
    .replace(/(\S)\s+تكعيب(?=$|[\s.,،؛؟?!)])/g, '$1^{3}')
    .replace(/(^|[^A-Za-z0-9.])(\d+(?:\.\d+)?)[eE]([+-]?)(\d+)(?![A-Za-z0-9])/g,
      (_, pre, m, sign, e) => `${pre}${m}×10^{${sign === '-' ? '-' : ''}${Number(e)}}`);
}

function rich(text) {
  return esc(normalizeMath(text))
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>') // markdown bold (e.g. in AI explanations)
    // Latin/number formulas: render + keep them left-to-right inside Arabic text.
    .replace(MATH_RUN, (match) => {
      const [, run, tail] = match.match(/^(.*?)([.,]*)$/); // sentence punctuation stays outside the LTR formula
      return `<bdi dir="ltr" class="math">${run.replace(MATH_OP, (_, op, b, r) => supSub(op, b ?? r))}</bdi>${tail}`;
    })
    // Arabic bases (م^2, س^2): only the exponent is converted, the word order is left to the browser.
    .replace(/(\S)([\^_])(?:\{([^{}<>]*)\}|([-−+]?(?:[0-9٠-٩]+(?:\.[0-9٠-٩]+)?|[A-Za-zء-ي])))/g, (_, pre, op, b, r) => pre + supSub(op, b ?? r));
}

const fmtDate = (d) => (d ? new Date(d).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('ar-EG-u-nu-latn', { dateStyle: 'medium' }) : '—');
const fmtMoney = (n, digits = 2) => `${Number(n || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: digits })} ج`;
/** AI budget is shown in points (rate from platform settings; default 100 points = 1 EGP). */
const pointsRate = () => (typeof Site !== 'undefined' && Site.pointsPerEgp) || 100;
const egpToPoints = (egp) => Math.round(Number(egp || 0) * pointsRate() * 10) / 10;
const fmtPoints = (points) => `${Number(points || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 1 })} نقطة`;
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
