/* Student-facing views. Each view: async (el, params, query) => void */
const Views = {};

// ---------------------------------------------------------------- Auth
Views.login = async (el) => {
  el.innerHTML = `<div class="auth card">
    <h1>تسجيل الدخول</h1>
    <form id="f" class="form">
      <label>البريد الإلكتروني أو كود الطالب<input name="identifier" required autocomplete="username" placeholder="STU-2026-0001"></label>
      <label>كلمة المرور<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary" type="submit">دخول</button>
    </form>
    <p class="links"><a href="#/register">حساب جديد</a> · <a href="#/forgot">نسيت كلمة المرور؟</a></p>
  </div>`;
  onSubmit($('#f', el), async (v) => {
    try {
      const r = await API.post('/auth/login', v);
      API.setToken(r.token);
      await State.refresh();
      location.hash = State.user.role === 'admin' ? '#/admin' : '#/';
    } catch (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED' && v.identifier.includes('@')) {
        sessionStorage.setItem('verifyEmail', v.identifier);
        toast(err.message, 'err');
        location.hash = '#/verify';
        return;
      }
      throw err;
    }
  });
};

Views.register = async (el) => {
  el.innerHTML = `<div class="auth card wide">
    <h1>إنشاء حساب طالب</h1>
    <form id="f" class="form grid2">
      <label class="span2">الاسم بالكامل<input name="full_name" required minlength="3"></label>
      <label>البريد الإلكتروني<input name="email" type="email" required autocomplete="email"></label>
      <label>كلمة المرور<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="8 أحرف على الأقل، حروف وأرقام"></label>
      <label>رقم الطالب<input name="phone" required inputmode="numeric" placeholder="01012345678"></label>
      <label>رقم ولي الأمر<input name="parent_phone" required inputmode="numeric" placeholder="01212345678"></label>
      <label class="span2">إيميل ولي الأمر (اختياري — لاستلام التقارير)<input name="parent_email" type="email"></label>
      <button class="btn primary span2" type="submit">إنشاء الحساب</button>
    </form>
    <p class="links">عندك حساب؟ <a href="#/login">سجّل دخول</a></p>
  </div>`;
  onSubmit($('#f', el), async (v) => {
    const r = await API.post('/auth/register', v);
    sessionStorage.setItem('verifyEmail', v.email);
    if (r.dev_otp) sessionStorage.setItem('devOtp', r.dev_otp);
    sessionStorage.setItem('newCode', r.student_code);
    location.hash = '#/verify';
  });
};

Views.verify = async (el) => {
  const email = sessionStorage.getItem('verifyEmail') || '';
  const devOtp = sessionStorage.getItem('devOtp');
  const code = sessionStorage.getItem('newCode');
  el.innerHTML = `<div class="auth card">
    <h1>تأكيد البريد الإلكتروني</h1>
    ${code ? `<p class="notice good">تم إنشاء حسابك! كود الطالب الخاص بك: <b class="mono">${esc(code)}</b></p>` : ''}
    <p class="muted">أرسلنا رمز من 6 أرقام إلى بريدك.</p>
    ${devOtp ? `<p class="notice">وضع تجريبي — الرمز: <b class="mono">${esc(devOtp)}</b></p>` : ''}
    <form id="f" class="form">
      <label>البريد الإلكتروني<input name="email" type="email" required value="${esc(email)}"></label>
      <label>رمز التحقق<input name="code" required inputmode="numeric" maxlength="6" pattern="\\d{6}" class="otp" autocomplete="one-time-code"></label>
      <button class="btn primary" type="submit">تأكيد</button>
    </form>
    <p class="links"><a href="#" data-action="resend">إعادة إرسال الرمز</a></p>
  </div>`;
  onSubmit($('#f', el), async (v) => {
    const r = await API.post('/auth/verify-otp', v);
    ['verifyEmail', 'devOtp', 'newCode'].forEach((k) => sessionStorage.removeItem(k));
    API.setToken(r.token);
    await State.refresh();
    toast(r.message);
    location.hash = '#/';
  });
  onAction(el, {
    resend: (b) => run(b, async () => {
      const r = await API.post('/auth/resend-otp', { email: $('[name=email]', el).value.trim() });
      toast(r.message);
      if (r.dev_otp) {
        sessionStorage.setItem('devOtp', r.dev_otp);
        Views.verify(el);
      }
    }),
  });
};

Views.forgot = async (el) => {
  el.innerHTML = `<div class="auth card">
    <h1>نسيت كلمة المرور</h1>
    <form id="f1" class="form">
      <label>البريد الإلكتروني<input name="email" type="email" required></label>
      <button class="btn primary" type="submit">إرسال رمز</button>
    </form>
    <form id="f2" class="form" hidden>
      <p id="dev" class="notice" hidden></p>
      <label>رمز التحقق<input name="code" required inputmode="numeric" maxlength="6" class="otp"></label>
      <label>كلمة المرور الجديدة<input name="new_password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn primary" type="submit">تغيير كلمة المرور</button>
    </form>
    <p class="links"><a href="#/login">رجوع لتسجيل الدخول</a></p>
  </div>`;
  let email;
  onSubmit($('#f1', el), async (v) => {
    const r = await API.post('/auth/forgot-password', v);
    email = v.email;
    toast(r.message);
    $('#f1', el).hidden = true;
    $('#f2', el).hidden = false;
    if (r.dev_otp) Object.assign($('#dev', el), { hidden: false, textContent: `وضع تجريبي — الرمز: ${r.dev_otp}` });
  });
  onSubmit($('#f2', el), async (v) => {
    const r = await API.post('/auth/reset-password', { ...v, email });
    toast(r.message);
    location.hash = '#/login';
  });
};

// ---------------------------------------------------------------- Home
Views.home = async (el) => {
  const [me, perf, mist, tasks, ai] = await Promise.all([
    State.refresh(), API.get('/reports/performance'), API.get('/mistakes/summary'), API.get('/planner/tasks'), API.get('/ai/usage'),
  ]);
  const u = me.user;
  const sub = me.subscription;
  el.innerHTML = `
    <section class="card hero">
      <div>
        <h1>أهلاً ${esc(u.full_name.split(' ')[0])} 👋</h1>
        <p class="muted">كود الطالب: <b class="mono">${esc(u.student_code)}</b>
          <button class="btn tiny ghost" data-action="copy">نسخ</button> — شاركه مع أصحابك عشان يضيفوك للتيم</p>
      </div>
      ${sub
        ? `<div class="sub-chip good">${esc(sub.name_ar)}<small>ساري حتى ${fmtDay(sub.ends_at)}</small></div>`
        : '<a class="btn primary" href="#/subscribe">اشترك دلوقتي</a>'}
    </section>

    <section class="tiles">
      <div class="tile"><span class="tile-label">الأداء العام</span><b class="${percentTone(perf.overall.percent)}">${perf.overall.percent ?? '—'}%</b><small>${esc(perf.overall.rating)}</small></div>
      <a class="tile" href="#/mistakes"><span class="tile-label">بنك الأخطاء</span><b>${mist.total}</b><small>سؤال محتاج مراجعة</small></a>
      <a class="tile" href="#/planner"><span class="tile-label">مهام النهارده</span><b>${tasks.summary.done}/${tasks.summary.total}</b><small>${tasks.summary.planned_minutes} دقيقة مذاكرة</small></a>
      <div class="tile"><span class="tile-label">رصيد الذكاء الاصطناعي</span><b>${fmtMoney(ai.remaining_egp)}</b><small>من ${fmtMoney(ai.limit_egp)}</small>${bar(100 - ai.used_percent, ai.used_percent > 80 ? 'bad' : 'good')}</div>
    </section>

    <section class="card">
      <div class="card-head"><h2>تقييمك في كل مادة</h2><a href="#/report" class="btn tiny ghost">تقرير ولي الأمر</a></div>
      ${perf.subjects.length
        ? perf.subjects.map((s) => `<div class="perf-row">
            <span>${esc(s.subject)}</span>${bar(s.percent, percentTone(s.percent))}
            <b class="${percentTone(s.percent)}">${s.percent}%</b><small class="muted">${esc(s.rating)} · ${s.correct}/${s.attempts}</small></div>`).join('')
        : empty('لسه محلتش أسئلة. ابدأ التدريب عشان يظهر تقييمك.', '<a class="btn primary" href="#/practice">ابدأ التدريب</a>')}
    </section>`;
  onAction(el, {
    copy: () => navigator.clipboard?.writeText(u.student_code).then(() => toast('تم نسخ الكود')),
  });
};

// ---------------------------------------------------------------- Shared question card (practice + mistakes retry)
function questionCard(q, idx, total) {
  return `<div class="card qcard">
    <div class="q-meta">
      <span>سؤال ${idx + 1} من ${total}</span>
      <span>${esc(q.subject || '')}${q.lesson ? ` · ${esc(q.lesson)}` : ''}</span>
      ${q.category === 'past_exam' ? badge(`امتحان سابق${q.exam_year ? ` ${q.exam_year}` : ''}`, 'mid') : ''}
    </div>
    <h2 class="q-text">${esc(q.question)}</h2>
    <div class="options">
      ${['A', 'B', 'C', 'D'].map((k, i) => `<button class="option" data-action="choose" data-key="${k}"><span class="opt-key">${'أبجد'[i]}</span>${esc(q.options[k])}</button>`).join('')}
    </div>
    <div class="feedback" hidden></div>
    <div class="explain" hidden></div>
    <div class="q-actions" hidden>
      <button class="btn ghost" data-action="explain">عرض الشرح</button>
      <button class="btn primary" data-action="next">${idx + 1 < total ? 'السؤال التالي' : 'إنهاء'}</button>
    </div>
  </div>`;
}

function markOptions(card, chosen, correct) {
  $$('.option', card).forEach((b) => {
    b.disabled = true;
    if (b.dataset.key === correct) b.classList.add('correct');
    else if (b.dataset.key === chosen) b.classList.add('wrong');
  });
}

/** Explanation flow: free saved/cached explanation first, then an explicit Gemini button. */
async function showExplanation(card, qid, btn) {
  const box = $('.explain', card);
  const r = await API.get(`/catalog/questions/${qid}/explanation`);
  box.hidden = false;
  const law = r.law_note ? `<p class="law">📐 ${esc(r.law_note)}</p>` : '';
  if (r.explanation) {
    box.innerHTML = `<div class="src">${r.source === 'question_bank' ? 'شرح من بنك الأسئلة — مجاني' : 'شرح محفوظ — مجاني'}</div><p>${esc(r.explanation)}</p>${law}`;
    btn.remove();
    return;
  }
  box.innerHTML = `<p class="muted">${esc(r.message)}</p>${law}<button class="btn ai" data-action="ai">✨ اشرح بالذكاء الاصطناعي</button>`;
  btn.remove();
}

async function askAI(card, qid) {
  const box = $('.explain', card);
  try {
    const r = await API.post(`/ai/explain/${qid}`);
    const cost = r.usage?.cost_egp
      ? `<div class="src">Gemini · ${r.usage.input_tokens + r.usage.output_tokens} توكن · التكلفة ${fmtMoney(r.usage.cost_egp, 4)} · المتبقي ${fmtMoney(r.usage.remaining_egp, 3)}</div>`
      : '<div class="src">شرح محفوظ — مجاني</div>';
    box.innerHTML = `${cost}<p class="pre">${esc(r.explanation)}</p>${r.law_note ? `<p class="law">📐 ${esc(r.law_note)}</p>` : ''}
      ${r.warning ? `<p class="notice bad">${esc(r.warning)}</p>` : ''}`;
  } catch (err) {
    if (err.code === 'AI_LIMIT_REACHED') box.innerHTML = `<p class="notice bad">⛔ ${esc(err.message)}</p>`;
    else throw err;
  }
}

/** Runs a list of questions one by one. answerFn(q, key) → { is_correct, correct_option, note }. */
function runQuiz(el, questions, { answerFn, onDone, allowExplain = true }) {
  let i = 0;
  let correct = 0;
  let shownAt = 0;
  const show = () => {
    el.innerHTML = questionCard(questions[i], i, questions.length);
    shownAt = Date.now();
  };
  const card = () => $('.qcard', el);
  onAction(el, {
    choose: (b) => run(null, async () => {
      if (b.disabled) return;
      $$('.option', card()).forEach((o) => { o.disabled = true; });
      const q = questions[i];
      let r;
      try {
        r = await answerFn(q, b.dataset.key, Date.now() - shownAt);
      } catch (err) {
        $$('.option', card()).forEach((o) => { o.disabled = false; });
        throw err;
      }
      if (r.is_correct) correct++;
      markOptions(card(), b.dataset.key, r.correct_option);
      const fb = $('.feedback', card());
      fb.hidden = false;
      fb.className = `feedback ${r.is_correct ? 'good' : 'bad'}`;
      fb.innerHTML = `${r.is_correct ? '✅ إجابة صحيحة' : '❌ إجابة خاطئة'}${r.note ? ` — <small>${esc(r.note)}</small>` : ''}`;
      $('.q-actions', card()).hidden = false;
      if (!allowExplain) $('[data-action=explain]', card())?.remove();
    }),
    explain: (b) => run(b, () => showExplanation(card(), questions[i].id, b)),
    ai: (b) => run(b, async () => {
      b.textContent = 'جاري التوليد…';
      await askAI(card(), questions[i].id);
    }),
    next: () => {
      i++;
      if (i < questions.length) show();
      else onDone(correct, questions.length);
    },
  });
  show();
}

function quizResult(el, correct, total, again) {
  const p = Math.round((correct / total) * 100);
  el.innerHTML = `<div class="card center">
    <h2>خلصت! 🎯</h2>
    <div class="big ${percentTone(p)}">${correct}/${total}</div>
    <p class="muted">${p}% إجابات صحيحة — الأسئلة الغلط اتضافت لبنك الأخطاء تلقائياً</p>
    <div class="row center"><button class="btn primary" data-action="again">جولة جديدة</button><a class="btn ghost" href="#/mistakes">بنك الأخطاء</a></div>
  </div>`;
  $('[data-action=again]', el).addEventListener('click', again);
}

// ---------------------------------------------------------------- Practice
Views.practice = async (el) => {
  const { subjects } = await API.get('/catalog/subjects');
  const setup = () => {
    el.innerHTML = `<div class="card">
      <h1>التدريب</h1>
      <form id="f" class="form grid3">
        <label>المادة<select name="subject_id"><option value="">كل المواد</option>
          ${subjects.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.questions})</option>`).join('')}</select></label>
        <label>الدرس<select name="lesson_id"><option value="">كل الدروس</option></select></label>
        <label>النوع<select name="category"><option value="">الكل</option><option value="lesson">دروس</option><option value="past_exam">امتحانات سابقة (بريميم)</option></select></label>
        <label>عدد الأسئلة<select name="limit"><option>5</option><option selected>10</option><option>20</option></select></label>
        <label class="check"><input type="checkbox" name="unsolved_only"> أسئلة جديدة بس (محلتهاش قبل كده)</label>
        <button class="btn primary" type="submit">ابدأ</button>
      </form>
    </div>`;
    const form = $('#f', el);
    form.subject_id.addEventListener('change', () => {
      const s = subjects.find((x) => String(x.id) === form.subject_id.value);
      form.lesson_id.innerHTML = '<option value="">كل الدروس</option>'
        + (s ? s.lessons.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.questions})</option>`).join('') : '');
    });
    onSubmit(form, async (v) => {
      const qs = new URLSearchParams();
      for (const [k, val] of Object.entries(v)) if (val !== undefined && val !== false) qs.set(k, String(val));
      let r;
      try {
        r = await API.get(`/catalog/questions?${qs}`);
      } catch (err) {
        if (isSubError(err)) return subscriptionWall(el, err);
        throw err;
      }
      if (!r.questions.length) return toast('مفيش أسئلة بالاختيارات دي', 'err');
      runQuiz(el, r.questions, {
        answerFn: async (q, key, ms) => {
          const a = await API.post('/catalog/answer', { question_id: q.id, choice: key, time_spent_ms: ms });
          return { ...a, note: a.added_to_mistakes ? 'اتضاف لبنك الأخطاء' : a.removed_from_mistakes ? 'اتشال من بنك الأخطاء' : '' };
        },
        onDone: (c, t) => quizResult(el, c, t, setup),
      });
    });
  };
  if (!State.subscription && State.user.role !== 'admin') {
    return subscriptionWall(el, { message: 'التدريب يتطلب اشتراكاً فعالاً' });
  }
  setup();
};

// ---------------------------------------------------------------- Mistakes bank
Views.mistakes = async (el) => {
  const summary = await API.get('/mistakes/summary');
  el.innerHTML = `<div class="card-head page-head"><h1>بنك الأخطاء</h1>${badge(`${summary.total} سؤال`, summary.total ? 'bad' : 'good')}</div>
    <p class="muted">أي سؤال تغلط فيه بيتحفظ هنا تلقائياً. أعد حله — ولو جاوبت صح بيتشال من القائمة.</p>
    ${summary.total ? summary.subjects.map((s) => `<section class="card">
        <div class="card-head"><h2>${esc(s.subject)} ${badge(s.total, 'bad')}</h2>
          <button class="btn primary tiny" data-action="retry" data-subject="${s.subject_id}">أعد حل أخطاء المادة</button></div>
        <ul class="list">${s.lessons.map((l) => `<li><span>${esc(l.lesson)}</span><span class="muted">${l.mistakes} سؤال · آخر غلطة ${fmtDay(l.last_wrong_at)}</span>
          <button class="btn ghost tiny" data-action="retry" data-subject="${s.subject_id}" data-lesson="${l.lesson_id ?? ''}">أعد الحل</button></li>`).join('')}</ul>
      </section>`).join('') : empty('مفيش أخطاء محفوظة 🎉 كمّل تدريب!', '<a class="btn primary" href="#/practice">تدريب</a>')}`;

  onAction(el, {
    retry: (b) => run(b, async () => {
      const qs = new URLSearchParams({ subject_id: b.dataset.subject, limit: '20' });
      if (b.dataset.lesson) qs.set('lesson_id', b.dataset.lesson);
      const { questions } = await API.get(`/mistakes/quiz?${qs}`);
      const host = document.createElement('div');
      el.replaceChildren(host);
      runQuiz(host, questions, {
        answerFn: async (q, key) => {
          const r = await API.post(`/mistakes/${q.id}/retry`, { choice: key });
          return { ...r, note: r.message };
        },
        onDone: (c, t) => {
          host.innerHTML = `<div class="card center"><h2>${c} من ${t} اتحلوا صح واتشالوا من البنك</h2>
            <button class="btn primary" data-action="back">رجوع لبنك الأخطاء</button></div>`;
          $('[data-action=back]', host).addEventListener('click', () => Views.mistakes(el));
        },
      });
    }),
  });
};

// ---------------------------------------------------------------- Competitions
Views.competitions = async (el) => {
  const { competitions } = await API.get('/competitions');
  el.innerHTML = `<h1 class="page-head">المسابقات</h1>
    <p class="muted">مسابقة التيمات كل جمعة، والمسابقة الشهرية فردية. كل طالب بيشوف الأسئلة والاختيارات بترتيب مختلف.</p>
    ${competitions.length ? `<div class="grid-cards">${competitions.map((c) => `<a class="card comp" href="#/competition/${c.id}">
        <div class="row between">${badge(LABELS.compStatus[c.status], LABELS.compTone[c.status])}<small class="muted">${esc(LABELS.compType[c.type])}</small></div>
        <h2>${esc(c.title)}</h2>
        <p class="muted">${fmtDate(c.starts_at)} ← ${fmtDate(c.ends_at)}</p>
        <p>${c.question_count} سؤال · ${c.duration_minutes} دقيقة</p>
        ${c.my_submitted_at ? `<p class="good">درجتك: <b>${c.my_score}/${c.question_count}</b></p>` : c.status === 'active' ? '<span class="btn primary tiny">ادخل المسابقة</span>' : ''}
      </a>`).join('')}</div>` : empty('مفيش مسابقات لسه.')}`;
};

let compTimer = null;
const Cleanup = [];
Cleanup.push(() => { clearInterval(compTimer); compTimer = null; });

Views.competition = async (el, { id }) => {
  const { competitions } = await API.get('/competitions');
  const c = competitions.find((x) => String(x.id) === String(id));
  if (!c) { el.innerHTML = empty('المسابقة غير موجودة'); return; }

  const showBoard = async () => {
    const lb = await API.get(`/competitions/${id}/leaderboard`);
    let review = '';
    if (c.status === 'finished' && c.my_submitted_at) {
      const { answers } = await API.get(`/competitions/${id}/review`);
      review = `<section class="card"><h2>إجاباتك</h2><ol class="review">${answers.map((a) => `<li class="${a.is_correct ? 'good' : 'bad'}">
        <p>${esc(a.question_text)}</p><small>إجابتك: ${esc(a.selected_option ? a[`option_${a.selected_option.toLowerCase()}`] : 'لم تُجب')} · الصحيحة: <b>${esc(a[`option_${a.correct_option.toLowerCase()}`])}</b></small></li>`).join('')}</ol></section>`;
    }
    const me = State.user.student_code;
    el.innerHTML = `<div class="page-head"><h1>${esc(c.title)}</h1>${badge(LABELS.compStatus[c.status], LABELS.compTone[c.status])}</div>
      ${lb.teams ? `<section class="card"><h2>ترتيب التيمات</h2>${table(['#', 'التيم', 'المشاركين', 'النقاط'],
        lb.teams.map((t) => [medal(t.rank), esc(t.team), t.participants, `<b>${t.total_score}</b>`]))}</section>` : ''}
      <section class="card"><h2>ترتيب الطلاب</h2>${lb.individuals.length ? table(['#', 'الطالب', 'الدرجة', 'الوقت'],
        lb.individuals.map((s) => [medal(s.rank), esc(s.student) + (me && s.student.includes(me) ? ' ⭐' : ''), `<b>${s.score}/${s.total_questions}</b>`, fmtDuration(s.duration_seconds)])) : empty('لسه محدش سلّم')}</section>
      ${review}
      ${c.status !== 'finished' && c.my_submitted_at ? '<p class="muted center">الإجابات الصحيحة هتظهر بعد انتهاء المسابقة.</p>' : ''}`;
  };

  if (c.my_submitted_at || c.status !== 'active' || State.user.role === 'admin') return showBoard();

  el.innerHTML = `<div class="card center">
    <h1>${esc(c.title)}</h1><p class="muted">${esc(LABELS.compType[c.type])}</p>
    <p>${c.question_count} سؤال · ${c.duration_minutes} دقيقة من وقت البدء · بتنتهي ${fmtDate(c.ends_at)}</p>
    <p class="muted">التسليم مرة واحدة بس. لو الوقت خلص هيتسلم تلقائياً.</p>
    <button class="btn primary" data-action="start">ابدأ الآن</button></div>`;

  onAction(el, {
    start: (b) => run(b, async () => {
      let entry;
      try {
        entry = await API.post(`/competitions/${id}/start`);
      } catch (err) {
        if (isSubError(err)) return subscriptionWall(el, err);
        if (err.code === 'TEAM_REQUIRED') {
          el.innerHTML = `<div class="card center"><h2>${esc(err.message)}</h2><a class="btn primary" href="#/team">صفحة التيم</a></div>`;
          return undefined;
        }
        throw err;
      }
      const key = `comp-${entry.entry_id}`;
      let saved = {};
      try { saved = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { saved = {}; }

      el.innerHTML = `<div class="timer-bar"><span>${esc(c.title)}</span><b id="timer">--:--</b><span id="answered"></span></div>
        <form id="cf">${entry.questions.map((q) => `<div class="card qcard">
          <div class="q-meta"><span>سؤال ${q.number}</span></div><h2 class="q-text">${esc(q.question)}</h2>
          <div class="options">${q.options.map((o) => `<label class="option radio"><input type="radio" name="q${q.question_id}" value="${o.key}" ${saved[q.question_id] === o.key ? 'checked' : ''}><span>${esc(o.text)}</span></label>`).join('')}</div>
        </div>`).join('')}
        <button class="btn primary block" type="submit">تسليم الإجابات</button></form>`;

      const form = $('#cf', el);
      const answers = () => entry.questions.map((q) => ({ question_id: q.question_id, choice: form[`q${q.question_id}`].value || null }));
      const updateCount = () => { $('#answered', el).textContent = `${answers().filter((a) => a.choice).length}/${entry.questions.length} مُجاب`; };
      form.addEventListener('change', (e) => {
        saved[e.target.name.slice(1)] = e.target.value;
        sessionStorage.setItem(key, JSON.stringify(saved));
        updateCount();
      });
      updateCount();

      let submitting = false;
      const submit = async () => {
        if (submitting) return;
        submitting = true;
        clearInterval(compTimer);
        try {
          const r = await API.post(`/competitions/${id}/submit`, { answers: answers() });
          sessionStorage.removeItem(key);
          c.my_submitted_at = r.submitted_at;
          toast(`تم التسليم — درجتك ${r.score}/${r.total_questions}`);
          await showBoard();
          el.insertAdjacentHTML('afterbegin', `<div class="card center"><h2>درجتك</h2><div class="big ${percentTone(r.percent)}">${r.score}/${r.total_questions}</div></div>`);
        } catch (err) {
          submitting = false;
          toast(errorText(err), 'err');
        }
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const left = answers().filter((a) => !a.choice).length;
        if (left && !confirm(`فيه ${left} سؤال من غير إجابة. تسلّم برضه؟`)) return;
        submit();
      });

      const deadline = new Date(entry.deadline_at).getTime();
      const tick = () => {
        const s = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        const t = $('#timer', el);
        if (!t) return clearInterval(compTimer);
        t.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        t.classList.toggle('bad', s < 60);
        if (s === 0) submit();
        return undefined;
      };
      tick();
      compTimer = setInterval(tick, 1000);
      return undefined;
    }),
  });
};

const medal = (r) => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[r] || r);
const fmtDuration = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
function table(head, rows) {
  return `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------- Team
Views.team = async (el) => {
  const [{ team }, { invites }] = await Promise.all([API.get('/teams/me'), API.get('/teams/invites')]);
  const myId = State.user.id;
  const isCaptain = team && team.captain_id === myId;
  const received = invites.length ? `<section class="card"><h2>دعوات وصلتلك</h2><ul class="list">${invites.map((i) => `<li>
      <span><b>${esc(i.team)}</b> <small class="muted">من ${esc(i.invited_by)} (${esc(i.invited_by_code)}) · ${i.team_size}/4</small></span>
      <span class="row"><button class="btn primary tiny" data-action="accept" data-id="${i.id}">قبول</button>
      <button class="btn ghost tiny" data-action="decline" data-id="${i.id}">رفض</button></span></li>`).join('')}</ul></section>` : '';

  if (!team) {
    el.innerHTML = `<h1 class="page-head">التيم</h1>${received}
      <section class="card"><h2>أنشئ تيم جديد</h2>
        <form id="cf" class="form inline"><input name="name" required minlength="2" placeholder="اسم التيم"><button class="btn primary" type="submit">إنشاء</button></form>
        <p class="muted">التيم 4 طلاب. بعد ما تنشئه ادعي أصحابك بكود الطالب بتاعهم.<br>
        لو مش في تيم يوم الخميس، النظام هيوزعك تلقائياً على تيم قبل مسابقة الجمعة.</p></section>`;
  } else {
    el.innerHTML = `<div class="page-head"><h1>${esc(team.name)}</h1>${badge(`${team.size}/${team.max_size}`, team.size === 4 ? 'good' : 'mid')}${team.is_auto_generated ? badge('توزيع تلقائي') : ''}</div>
      ${received}
      <section class="card"><h2>الأعضاء</h2><ul class="list">${team.members.map((m) => `<li>
        <span>${m.is_captain ? '👑 ' : ''}<b>${esc(m.full_name)}</b> <small class="mono muted">${esc(m.student_code)}</small></span>
        ${isCaptain && m.id !== myId ? `<button class="btn ghost tiny" data-action="kick" data-id="${m.id}">إزالة</button>` : ''}</li>`).join('')}</ul>
      </section>
      ${isCaptain ? `<section class="card"><h2>دعوة عضو</h2>
        ${team.size < 4 ? `<form id="inv" class="form inline"><input name="student_code" required placeholder="STU-2026-0002" class="mono"><button class="btn primary" type="submit">إرسال دعوة</button></form>` : '<p class="good">التيم مكتمل ✅</p>'}
        ${team.pending_invites.length ? `<h3>دعوات في الانتظار</h3><ul class="list">${team.pending_invites.map((p) => `<li><span>${esc(p.full_name)} <small class="mono muted">${esc(p.student_code)}</small></span>
          <button class="btn ghost tiny" data-action="cancel" data-id="${p.id}">إلغاء</button></li>`).join('')}</ul>` : ''}
        <label class="check"><input type="checkbox" id="autofill" ${team.allow_auto_fill ? 'checked' : ''}> اسمح للنظام يكمّل التيم بطلاب عشوائيين قبل مسابقة الجمعة</label>
      </section>` : ''}
      <button class="btn danger" data-action="leave">الخروج من التيم</button>`;
  }
  const reload = () => Views.team(el);
  if ($('#cf', el)) onSubmit($('#cf', el), async (v) => { await API.post('/teams', v); toast('تم إنشاء التيم'); reload(); });
  if ($('#inv', el)) onSubmit($('#inv', el), async (v) => { const r = await API.post('/teams/invites', v); toast(r.message); reload(); });
  $('#autofill', el)?.addEventListener('change', (e) => run(null, async () => {
    await API.patch('/teams/me', { allow_auto_fill: e.target.checked });
    toast('تم الحفظ');
  }));
  onAction(el, {
    accept: (b) => run(b, async () => { const r = await API.post(`/teams/invites/${b.dataset.id}/accept`); toast(r.message); reload(); }),
    decline: (b) => run(b, async () => { await API.post(`/teams/invites/${b.dataset.id}/decline`); reload(); }),
    cancel: (b) => run(b, async () => { await API.del(`/teams/invites/${b.dataset.id}`); reload(); }),
    kick: (b) => run(b, async () => { if (confirm('إزالة العضو؟')) { await API.del(`/teams/members/${b.dataset.id}`); reload(); } }),
    leave: (b) => run(b, async () => { if (confirm('متأكد إنك عايز تخرج من التيم؟')) { await API.post('/teams/leave'); toast('خرجت من التيم'); reload(); } }),
  });
};

// ---------------------------------------------------------------- Planner
Views.planner = async (el, params, query) => {
  const date = query.date || todayStr();
  const [{ tasks, summary }, { subjects }] = await Promise.all([API.get(`/planner/tasks?date=${date}`), API.get('/catalog/subjects')]);
  const shift = (days) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  el.innerHTML = `<div class="page-head"><h1>جدول المذاكرة</h1></div>
    <div class="card row between wrap">
      <a class="btn ghost tiny" href="#/planner?date=${shift(-1)}">→ اليوم السابق</a>
      <input type="date" id="day" value="${date}">
      <a class="btn ghost tiny" href="#/planner?date=${shift(1)}">اليوم التالي ←</a>
    </div>
    <section class="card">
      <div class="card-head"><h2>${fmtDay(`${date}T12:00:00`)}</h2><span class="muted">${summary.done}/${summary.total} مكتملة · ${summary.planned_minutes} دقيقة</span></div>
      ${bar(summary.completion_percent, 'good')}
      ${tasks.length ? `<ul class="list tasks">${tasks.map((t) => `<li class="${t.is_done ? 'done' : ''}">
        <label class="check"><input type="checkbox" data-toggle="${t.id}" ${t.is_done ? 'checked' : ''}>
          <span><b>${esc(t.title)}</b><small class="muted">${t.start_time ? esc(t.start_time.slice(0, 5)) : ''} ${t.duration_minutes ? `· ${t.duration_minutes} د` : ''} ${t.subject ? `· ${esc(t.subject)}` : ''}</small></span></label>
        <span class="row">${badge(LABELS.priority[t.priority], { high: 'bad', medium: 'mid', low: '' }[t.priority])}
        <button class="btn ghost tiny" data-action="del" data-id="${t.id}" aria-label="حذف">🗑</button></span></li>`).join('')}</ul>` : empty('مفيش مهام لليوم ده.')}
    </section>
    <section class="card"><h2>إضافة مهمة</h2>
      <form id="tf" class="form grid3">
        <label class="span3">المهمة<input name="title" required maxlength="200" placeholder="مثلاً: حل 20 سؤال على قوانين نيوتن"></label>
        <label>المادة<select name="subject_id"><option value="">—</option>${subjects.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <label>الوقت<input type="time" name="start_time"></label>
        <label>المدة (دقيقة)<input type="number" name="duration_minutes" min="5" max="720" step="5" value="60"></label>
        <label>الأولوية<select name="priority"><option value="high">عالية</option><option value="medium" selected>متوسطة</option><option value="low">منخفضة</option></select></label>
        <button class="btn primary" type="submit">إضافة</button>
      </form></section>`;
  const reload = () => Views.planner(el, params, { date });
  $('#day', el).addEventListener('change', (e) => { location.hash = `#/planner?date=${e.target.value}`; });
  onSubmit($('#tf', el), async (v) => {
    await API.post('/planner/tasks', {
      title: v.title, task_date: date, priority: v.priority,
      subject_id: v.subject_id ? Number(v.subject_id) : null,
      start_time: v.start_time || null,
      duration_minutes: v.duration_minutes ? Number(v.duration_minutes) : null,
    });
    reload();
  });
  listen(el, 'change', (e) => {
    if (!e.target.dataset.toggle) return;
    run(null, async () => { await API.patch(`/planner/tasks/${e.target.dataset.toggle}`, { is_done: e.target.checked }); reload(); });
  });
  onAction(el, { del: (b) => run(b, async () => { await API.del(`/planner/tasks/${b.dataset.id}`); reload(); }) });
};

// ---------------------------------------------------------------- Subscribe & payments
Views.subscribe = async (el) => {
  const [{ plans, manual_payment: mp }, mine] = await Promise.all([API.get('/payments/plans'), API.get('/payments/me')]);
  const cur = mine.current;
  el.innerHTML = `<h1 class="page-head">الاشتراك</h1>
    ${cur ? `<div class="notice good">اشتراكك الحالي: <b>${esc(cur.name_ar)}</b> — ساري حتى ${fmtDay(cur.ends_at)}. التجديد بيتضاف على المدة.</div>` : ''}
    <div class="grid-cards plans">${plans.map((p) => `<div class="card plan ${p.code === 'premium' ? 'featured' : ''}">
      ${p.code === 'premium' ? '<span class="ribbon">الأكثر قيمة</span>' : ''}
      <h2>${esc(p.name_ar)}</h2>
      <div class="price">${Number(p.price_egp)} <small>جنيه / ${p.duration_days} يوم</small></div>
      <ul class="features">${Object.entries(LABELS.feature).map(([k, label]) => `<li class="${p.features[k] ? '' : 'off'}">${p.features[k] ? '✓' : '✕'} ${esc(label)}</li>`).join('')}</ul>
      <div class="col"><button class="btn primary" data-action="pay" data-plan="${p.code}" data-provider="paymob">ادفع بالكارت / المحفظة</button>
      <button class="btn ghost" data-action="pay" data-plan="${p.code}" data-provider="fawry">ادفع بفوري</button></div>
    </div>`).join('')}</div>

    <section class="card"><h2>تحويل فودافون كاش / انستاباي</h2>
      <p class="muted">حوّل المبلغ لـ: فودافون كاش <b class="mono">${esc(mp.vodafone_cash || '—')}</b> · انستاباي <b class="mono">${esc(mp.instapay || '—')}</b><br>${esc(mp.instructions)}</p>
      <form id="mf" class="form grid2">
        <label>الباقة<select name="plan_code">${plans.map((p) => `<option value="${p.code}">${esc(p.name_ar)} — ${Number(p.price_egp)} ج</option>`).join('')}</select></label>
        <label>طريقة التحويل<select name="provider"><option value="vodafone_cash">فودافون كاش</option><option value="instapay">انستاباي</option></select></label>
        <label>الرقم/الحساب اللي حوّلت منه<input name="sender_account" required minlength="5"></label>
        <label>رقم العملية (من الإيصال)<input name="transfer_ref"></label>
        <label class="span2">صورة الإيصال<input type="file" name="receipt" accept="image/png,image/jpeg,image/webp,application/pdf" required></label>
        <button class="btn primary span2" type="submit">رفع الإيصال للمراجعة</button>
      </form></section>

    <section class="card"><h2>مدفوعاتي</h2>${mine.payments.length ? table(['التاريخ', 'الباقة', 'المبلغ', 'الطريقة', 'الحالة'],
      mine.payments.map((p) => [fmtDate(p.created_at), esc(p.plan_code), fmtMoney(p.amount_egp), esc(LABELS.provider[p.provider]),
        badge(LABELS.paymentStatus[p.status], LABELS.paymentTone[p.status]) + (p.admin_note && p.status === 'rejected' ? `<br><small>${esc(p.admin_note)}</small>` : '')])) : empty('مفيش مدفوعات لسه')}</section>`;

  const reload = () => Views.subscribe(el);
  onAction(el, {
    pay: (b) => run(b, async () => {
      const r = await API.post('/payments/checkout', { plan_code: b.dataset.plan, provider: b.dataset.provider });
      if (r.checkout_url) { location.href = r.checkout_url; return; }
      if (r.fawry_reference) {
        modal(`<h2>ادفع في أي فرع فوري</h2><p>الرقم المرجعي:</p><div class="big mono">${esc(r.fawry_reference)}</div>
          <p class="muted">المبلغ: ${fmtMoney(r.payment.amount_egp)} — الاشتراك هيتفعّل تلقائياً بعد الدفع.</p>`);
        return;
      }
      const m = modal(`<h2>وضع تجريبي</h2><p>مفاتيح ${esc(LABELS.provider[r.provider])} مش متضافة لسه، فده دفع تجريبي.</p>
        <p class="muted">في التشغيل الحقيقي هتتحول لصفحة الدفع، والاشتراك يتفعّل تلقائياً عن طريق الـ Webhook.</p>
        <button class="btn primary" data-sim>محاكاة دفع ناجح (${fmtMoney(r.payment.amount_egp)})</button>`);
      $('[data-sim]', m).addEventListener('click', (e) => run(e.target, async () => {
        await API.post(`/payments/${r.payment.reference}/dev-simulate-paid`);
        closeModal();
        await State.refresh();
        toast('تم الدفع وتفعيل الاشتراك 🎉');
        reload();
      }));
    }),
  });
  onSubmit($('#mf', el), async (v, form) => {
    const fd = new FormData();
    for (const [k, val] of Object.entries(v)) if (val !== undefined) fd.append(k, val);
    fd.append('receipt', form.receipt.files[0]);
    const r = await API.upload('/payments/manual', fd);
    toast(r.message);
    reload();
  });
};

// ---------------------------------------------------------------- Offers
Views.offers = async (el) => {
  const { products } = await API.get('/products');
  el.innerHTML = `<h1 class="page-head">عروض وخصومات المذاكرة</h1>
    ${products.length ? `<div class="grid-cards">${products.map((p) => `<div class="card product">
      ${p.discount_percent ? `<span class="ribbon bad">-${p.discount_percent}%</span>` : ''}
      <small class="muted">${esc(p.category || '')}</small>
      <h2>${esc(p.title)}</h2><p class="muted">${esc(p.description || '')}</p>
      <div class="price">${fmtMoney(p.final_price)} ${p.discount_percent ? `<s class="muted">${fmtMoney(p.original_price)}</s>` : ''}</div>
      ${p.coupon_code ? `<p>كود الخصم: <b class="mono">${esc(p.coupon_code)}</b></p>` : ''}
      ${p.external_url ? `<a class="btn primary" href="${esc(p.external_url)}" target="_blank" rel="noopener noreferrer">اطلب الآن</a>` : ''}
    </div>`).join('')}</div>` : empty('مفيش عروض حالياً')}`;
};

// ---------------------------------------------------------------- Parent report
Views.report = async (el) => {
  const [{ text }, { reports }] = await Promise.all([API.get('/reports/parent/preview'), API.get('/reports/parent/history')]);
  el.innerHTML = `<h1 class="page-head">تقرير ولي الأمر</h1>
    <section class="card"><div class="card-head"><h2>التقرير الأسبوعي</h2><button class="btn primary tiny" data-action="send">إرسال لولي الأمر الآن</button></div>
      <pre class="report">${esc(text)}</pre>
      <p class="muted">بيتبعت تلقائياً كل سبت (بالإيميل لو موجود، وإلا رسالة على رقم ولي الأمر).</p></section>
    <section class="card"><h2>التقارير المرسلة</h2>${reports.length ? table(['التاريخ', 'الفترة', 'الطريقة', 'الحالة'],
      reports.map((r) => [fmtDate(r.sent_at), `${esc(r.period_start.slice(0, 10))} ← ${esc(r.period_end.slice(0, 10))}`, esc({ email: 'إيميل', sms: 'رسالة', log: 'تجريبي' }[r.channel]), badge(r.status === 'sent' ? 'تم' : 'فشل', r.status === 'sent' ? 'good' : 'bad')])) : empty('لسه متبعتش تقارير')}</section>`;
  onAction(el, {
    send: (b) => run(b, async () => { await API.post('/reports/parent/send'); toast('تم إرسال التقرير'); Views.report(el); }),
  });
};
