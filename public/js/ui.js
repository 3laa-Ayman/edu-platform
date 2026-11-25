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

/**
 * A run of English/code inside Arabic text (print(10 // 3), Integer (int), F = m×a^2...). Without an LTR isolate the
 * browser reorders its brackets and spaces around the Arabic words. Must contain a Latin letter (checked when matching).
 */
// Unicode sub/superscript digits (CH₄, m², 10⁻¹⁹), Greek letters (ΔH, λ), reaction arrows (⇌ →) and ½ ¼ ¾ belong to the formula.
const LTR_RUN = /(?:[A-Za-z0-9\u0370-\u03FF\u00BC-\u00BE\u2150-\u215E]|[-−–+](?=\s?[0-9])|[(\[{](?=[A-Za-z0-9]))[A-Za-z0-9 .,:;!?'"=+\-−–*/%<>()[\]{}^_×÷·&|#@$\\~°µΩ\u0370-\u03FF\u00BC-\u00BE\u2150-\u215E⇌⇄↔→←⟶⟵⇒⇔≈≠≤≥\u2070-\u207E\u2080-\u208E\u00B9\u00B2\u00B3]*[A-Za-z0-9)\]}'"%°\u2070-\u207E\u2080-\u208E\u00B9\u00B2\u00B3]/g;

/** Formats one piece of text: escape, then exponents / subscripts. */
function richChunk(text) {
  return esc(text)
    // Latin/number formulas: render + keep them left-to-right inside Arabic text.
    .replace(MATH_RUN, (match) => {
      const [, run, tail] = match.match(/^(.*?)([.,]*)$/); // sentence punctuation stays outside the LTR formula
      return `<bdi dir="ltr" class="math">${run.replace(MATH_OP, (_, op, b, r) => supSub(op, b ?? r))}</bdi>${tail}`;
    })
    // Arabic bases (م^2, س^2): only the exponent is converted, the word order is left to the browser.
    .replace(/(\S)([\^_])(?:\{([^{}<>]*)\}|([-−+]?(?:[0-9٠-٩]+(?:\.[0-9٠-٩]+)?|[A-Za-zء-ي])))/g, (_, pre, op, b, r) => pre + supSub(op, b ?? r));
}

/**
 * Fractions typed as (numerator)/(denominator) — or number/number like 3/4 or ٣/٤ — become a stacked fraction with
 * a bar (the outer brackets are dropped). Units (م/ث), dates (2026/11/20) and code (10 // 3) are left as they are.
 * Returns the text with \u0003<n>\u0004 placeholders and the rendered fractions.
 */
function extractFractions(t) {
  const parts = [];
  const POWER = /^[\^_](?:\{[^{}]*\}|[-−+]?[0-9٠-٩]+|[A-Za-z\u0621-\u064A])/;
  const isTerm = (c) => /[0-9٠-٩.A-Za-z\u0621-\u064A^_{}]/.test(c || '');
  const operand = (from, dir) => { // dir -1: left of the slash, +1: right of it
    let i = from;
    while (t[i] === ' ') i += dir;
    if (t[i] === (dir < 0 ? ')' : '(')) { // balanced brackets
      const open = dir < 0 ? ')' : '(';
      const close = dir < 0 ? '(' : ')';
      let depth = 0;
      for (let j = i; j >= 0 && j < t.length; j += dir) {
        if (t[j] === open) depth++;
        else if (t[j] === close && --depth === 0) {
          const [a, b] = dir < 0 ? [j, i] : [i, j];
          // (س + ٢)^٢ on the right: the power belongs to the bracket, so it stays with it (brackets kept).
          const pow = dir > 0 && t.slice(b + 1).match(POWER);
          if (pow) return { start: a, end: b + 1 + pow[0].length, inner: t.slice(a, b + 1 + pow[0].length), paren: true };
          return { start: a, end: b + 1, inner: t.slice(a + 1, b), paren: true };
        }
      }
      return null;
    }
    // A number (3, ٣, 1.5) or a short algebra term (س، ٢س، س^٢، x).
    let j = i;
    while (isTerm(t[j])) j += dir;
    if (j === i) return null;
    const [a, b] = dir < 0 ? [j + 1, i + 1] : [i, j];
    // (س + ١)^٢ on the left: the scan stopped at the power — take the bracket with it.
    if (dir < 0 && /^[\^_]/.test(t.slice(a, b)) && t[a - 1] === ')') {
      const br = operand(a - 1, -1);
      if (br) return { start: br.start, end: b, inner: t.slice(br.start, b), paren: true };
    }
    const inner = t.slice(a, b);
    return { start: a, end: b, inner, paren: false, letter: /[A-Za-z\u0621-\u064A]/.test(inner) };
  };
  let out = '';
  let last = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '/' || t[i - 1] === '/' || t[i + 1] === '/') continue;
    const left = operand(i - 1, -1);
    const right = left && operand(i + 1, 1);
    if (!left || !right || left.start < last) continue;
    // Units are not fractions: J/(g·°C), kJ/(mol·K) — Latin unit letters over a unit, no numbers or + − = in them.
    const unit = (o) => /[A-Za-z°µΩ]/.test(o.inner) && !/[\u0600-\u06FF0-9٠-٩+\-−–=]/.test(o.inner);
    if (!left.paren && unit(left) && unit(right)) continue;
    if (!left.paren && !right.paren) {
      // Without brackets: number/number or number/term (٣/٤، ١/س، س/٢) — never term/term (units like م/ث، كم/س),
      // and not part of a date or a longer a/b/c chain.
      if (left.letter && right.letter) continue;
      const before = t.slice(0, left.start).match(/(\S)\s*$/)?.[1];
      const after = t.slice(right.end).match(/^\s*(\S)/)?.[1];
      if (before === '/' || after === '/') continue;
    }
    out += t.slice(last, left.start) + `\u0003${parts.length}\u0004`;
    parts.push(`<span class="frac"><span class="frac-num">${rich(left.inner)}</span><span class="frac-den">${rich(right.inner)}</span></span>`);
    last = right.end;
    i = right.end - 1;
  }
  return { text: out + t.slice(last), parts };
}

function rich(text) {
  // Markdown bold (e.g. in AI explanations) → placeholder chars, so it never ends up split by an LTR run.
  // Units as in the book: J/(g·°C) → J/g·°C, kJ/(mol·K) → kJ/mol·K (brackets around a unit-only denominator dropped).
  const fr = extractFractions(normalizeMath(text)
    .replace(/([A-Za-zµΩ°])\/\(([A-Za-zµΩ°·⋅. ]+)\)/g, (m, a, unit) => (/[A-Za-z]/.test(unit) ? `${a}/${unit.trim()}` : m)));
  const t = fr.text.replace(/\*\*([^*\n]+?)\*\*/g, '\u0001$1\u0002');
  let out = '';
  let last = 0;
  const count = (str, ch) => str.split(ch).length - 1;
  /** Index of the first bracket without its partner inside the run — opened and not closed, or closed without
   * being opened there (or −1). */
  const unmatched = (str) => {
    const stack = [];
    for (let k = 0; k < str.length; k++) {
      if ('([{'.includes(str[k])) stack.push(k);
      else if (')]}'.includes(str[k])) {
        if (!stack.length) return k; // closes a bracket of the Arabic sentence: «(… ÷ Nₐ) ÷ a³»
        stack.pop();
      }
    }
    return stack.length ? stack[0] : -1;
  };
  const handle = (pos, run) => {
    if (!run) return;
    // A bracket whose partner is in the Arabic sentence («… 9.1 g/cm³. (2.3 g/cm³ بذرة …)»، «(… ÷ Nₐ) ÷ a³») belongs to
    // the sentence: split there — what comes before and after it are separate pieces (operators next to it stay Arabic).
    const b = unmatched(run);
    if (b >= 0) {
      handle(pos, run.slice(0, b).replace(/[\s.,;:=×+\-−–/·÷]+$/, ''));
      const after = run.slice(b + 1);
      const lead = after.length - after.replace(/^[\s=×+\-−–/·÷]+/, '').length;
      handle(pos + b + 1 + lead, after.slice(lead));
      return;
    }
    // A closing bracket with no partner in the run belongs to the Arabic sentence around it: «(… O = 16)».
    while (/[)\]}]$/.test(run) && count(run, '(') + count(run, '[') + count(run, '{') < count(run, ')') + count(run, ']') + count(run, '}')) run = run.slice(0, -1).trimEnd();
    // An equation written in Arabic words («سرعة تكوّن HI = 2 × سرعة اختفاء H₂») reads right-to-left: when the run is
    // followed by an operator and then Arabic, only its leading symbol (HI) is kept left-to-right.
    if (/^\s*[×+\-−–=/·÷]\s*[؀-ۿ]/.test(t.slice(pos + run.length))) {
      run = run.match(/^[^\s=×+\-−–/·÷]+/)?.[0] || '';
    }
    // Latin text/units, or a signed number (−273، −5): its sign must stay on its left —
    // or numbers joined by a dash / operator (4–5%، 10-20، 5 - 3 = 2), which would otherwise be read right-to-left.
    if (!/[A-Za-z]/.test(run) && !/^[-−–+]\s?[0-9]/.test(run) && !/[0-9]\s?[-−–+=×÷/]\s?[0-9]/.test(run)) return;
    // A formula followed by a new quantity (CH₄ ΔH = −891 kJ/mol): two pieces, so the formula stays next to its
    // Arabic name and the quantity follows it.
    const pieces = [];
    let rest = run;
    let at = pos;
    for (let g = rest.search(/\s+(?=[Ͱ-Ͽ][A-Za-z])/); g > 0 && !/[=×+\-−–/·÷]\s*$/.test(rest.slice(0, g));
      g = rest.search(/\s+(?=[Ͱ-Ͽ][A-Za-z])/)) {
      pieces.push([at, rest.slice(0, g)]);
      const skip = rest.slice(g).length - rest.slice(g).trimStart().length;
      at += g + skip;
      rest = rest.slice(g + skip);
    }
    pieces.push([at, rest]);
    for (const [ppos, piece] of pieces) {
      // A short formula never breaks across two lines (it moves to the next line whole); long English text still wraps.
      out += `${richChunk(t.slice(last, ppos))}<bdi dir="ltr"${piece.length <= 40 ? ' class="nw"' : ''}>${richChunk(piece)}</bdi>`;
      last = ppos + piece.length;
    }
  };
  for (const m of t.matchAll(LTR_RUN)) handle(m.index, m[0]);
  out += richChunk(t.slice(last));
  return out.replace(/\u0001/g, '<strong>').replace(/\u0002/g, '</strong>')
    .replace(/\u0003(\d+)\u0004/g, (_, n) => fr.parts[Number(n)]);
}

/**
 * Explanations (saved or AI) may use LaTeX or Markdown habits; turn them into the platform's notation before rich():
 * $…$ \frac{a}{b} \sqrt{x} \times \Delta \rightarrow \text{} … and "### title", "* item", "- item".
 */
const LATEX_SYMBOLS = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  to: '→', rightarrow: '→', longrightarrow: '⟶', leftarrow: '←', Rightarrow: '⇒', leftrightarrow: '↔', rightleftharpoons: '⇌',
  infty: '∞', degree: '°', circ: '°', percent: '%', ldots: '…', cdots: '⋯', propto: '∝', therefore: '∴',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', pi: 'π',
  rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', omega: 'ω', Omega: 'Ω',
};
function cleanExplanation(text) {
  let t = String(text ?? '');
  for (let k = 0; k < 3; k++) { // nested \frac{\frac{…}{…}}{…}
    t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
      .replace(/\\(?:text|mathrm|textbf|mathbf|operatorname|mbox)\s*\{([^{}]*)\}/g, '$1');
  }
  t = t.replace(/\^\s*\{?\\circ\}?/g, '°')
    // \Delta H → ΔH (the space after a Greek command belongs to LaTeX, not to the text)
    .replace(/\\([A-Za-z]+)( (?=[A-Za-z]))?/g, (m, w, sp = '') => {
      const sym = LATEX_SYMBOLS[w];
      if (!sym) return w + sp; // unknown command: keep its name
      return /[\u0370-\u03FF]/.test(sym) ? sym : sym + sp;
    })
    .replace(/°\s+([CFK])\b/g, '°$1')
    .replace(/\\[(\[)\]]|\$\$?/g, '') // \( \) \[ \] $ $$
    .replace(/\\[,;: !]/g, ' ')
    .replace(/\{([^{}^_]*)\}/g, (m, inner, i, all) => (/[\^_]$/.test(all.slice(0, i)) ? m : inner)) // stray braces (not ^{…} _{…})
    .replace(/[ \t]*->[ \t]*/g, ' → ').replace(/[ \t]*=>[ \t]*/g, ' ⇒ ').replace(/<=>/g, '⇔');
  return t.split('\n').map((line) => line
    .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/, '**$1**') // ### title → bold line
    .replace(/^\s*[*•]\s+/, '• ') // * item → • item
    .replace(/^\s*-\s+(?=\D)/, '• ')) // - item → • item (a minus before a number stays)
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; else if (!(el.name in out)) out[el.name] = undefined; }
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
    <p class="muted">اشترك لتتمكن من استخدام هذه الميزة.</p>
    <a class="btn primary" href="#/subscribe">عرض الباقات</a></div>`;
}
const isSubError = (err) => err.status === 403 && ['SUBSCRIPTION_REQUIRED', 'PLAN_UPGRADE_REQUIRED'].includes(err.code);

const LABELS = {
  category: { lesson: 'درس', past_exam: 'امتحان سابق' },
  paymentStatus: { pending: 'في انتظار الدفع', under_review: 'قيد المراجعة', paid: 'مدفوع', failed: 'فشل', rejected: 'مرفوض' },
  paymentTone: { pending: 'mid', under_review: 'mid', paid: 'good', failed: 'bad', rejected: 'bad' },
  provider: { paymob: 'Paymob (كارت/محفظة)', fawry: 'فوري', vodafone_cash: 'محفظة إلكترونية', instapay: 'انستاباي' },
  compType: { team_weekly: 'مسابقة الفرق (الجمعة)', individual_monthly: 'المسابقة الشهرية الفردية' },
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
    priority_support: 'خدمة العملاء عبر واتساب',
  },
};
