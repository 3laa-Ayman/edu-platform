/* Student-facing views. Each view: async (el, params, query) => void */
const Views = {};

// ---------------------------------------------------------------- Auth
Views.login = async (el) => {
  const notice = sessionStorage.getItem('loginNotice');
  sessionStorage.removeItem('loginNotice');
  el.innerHTML = `<div class="auth card">
    <h1>تسجيل الدخول</h1>
    ${notice ? `<p class="notice mid">📱 ${esc(notice)}</p>` : ''}
    <div id="device-limit"></div>
    <form id="f" class="form">
      <label>البريد الإلكتروني أو كود الطالب<input name="identifier" required autocomplete="username" placeholder="STU-2026-0001"></label>
      <label>كلمة المرور<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary" type="submit">دخول</button>
    </form>
    <p class="links"><a href="#/register">حساب جديد</a> · <a href="#/forgot">نسيت كلمة المرور؟</a></p>
  </div>`;
  onSubmit($('#f', el), async (v) => {
    $('#device-limit', el).innerHTML = '';
    try {
      const r = await API.post('/auth/login', { ...v, device_id: deviceId() });
      if (r.device_verification) {
        // New device: confirm with the code sent to the student's email.
        sessionStorage.setItem('deviceToken', r.device_token);
        sessionStorage.setItem('deviceEmail', r.email_hint || '');
        if (r.dev_otp) sessionStorage.setItem('devOtp', r.dev_otp);
        else sessionStorage.removeItem('devOtp');
        location.hash = '#/verify-device';
        return;
      }
      API.setToken(r.token);
      await State.refresh();
      location.hash = State.user.role === 'admin' ? '#/admin' : '#/';
    } catch (err) {
      if (err.code === 'DEVICE_LIMIT') {
        $('#device-limit', el).innerHTML = deviceLimitNotice(err);
        return;
      }
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

const deviceLimitNotice = (err) => `<div class="notice bad">
    <b>⛔ هذا الحساب مفتوح على ${err.details?.max || 2} أجهزة بالفعل</b>
    ${err.details?.devices?.length ? `<ul class="device-names">${err.details.devices.map((d) => `<li>📱 ${esc(d)}</li>`).join('')}</ul>` : ''}
    <small>للدخول من هذا الجهاز: ادخل من أحدها ← «أجهزتي» ← احذف الجهاز الآخر. وإن لم يكن معك أيٌّ منها فتواصل مع الإدارة.</small></div>`;

/** Login from a new device: the code sent to the student's email adds this device (max 2). */
Views.verifyDevice = async (el) => {
  const token = sessionStorage.getItem('deviceToken');
  if (!token) { location.hash = '#/login'; return; }
  const hint = sessionStorage.getItem('deviceEmail');
  const devOtp = sessionStorage.getItem('devOtp');
  el.innerHTML = `<div class="auth card">
    <h1>📱 جهاز جديد</h1>
    <p class="muted">تدخل من هذا الجهاز لأول مرة. أرسلنا رمزًا من 6 أرقام إلى ${hint ? `<b class="mono">${esc(hint)}</b>` : 'بريدك الإلكتروني'}.</p>
    <div class="notice mid small spam-tip">📩 <b>لم تجد الرسالة؟</b> افتح مجلد <b>Spam</b> (الرسائل غير المرغوب فيها) — وإن وجدتها هناك فاضغط <b>«Not spam / ليست رسالة غير مرغوب فيها»</b> لتصلك رسائلنا القادمة في الـ Inbox.</div>
    <p class="notice">يعمل الحساب على جهازين بحدٍّ أقصى، وعلى جهاز واحد فقط في الوقت نفسه.</p>
    ${devOtp ? `<p class="notice">وضع تجريبي — الرمز: <b class="mono">${esc(devOtp)}</b></p>` : ''}
    <div id="device-limit"></div>
    <form id="f" class="form">
      <label>رمز التحقق<input name="code" required inputmode="numeric" maxlength="6" pattern="\\d{6}" class="otp" autocomplete="one-time-code"></label>
      <button class="btn primary" type="submit">تأكيد الجهاز</button>
    </form>
    <p class="links"><a href="#" data-action="resend">إعادة إرسال الرمز</a> · <a href="#/login">رجوع</a></p>
  </div>`;
  const done = () => ['deviceToken', 'deviceEmail', 'devOtp'].forEach((k) => sessionStorage.removeItem(k));
  onSubmit($('#f', el), async (v) => {
    try {
      const r = await API.post('/auth/verify-device', { device_token: token, code: v.code });
      done();
      API.setToken(r.token);
      await State.refresh();
      toast('تم تأكيد الجهاز ✓');
      location.hash = '#/';
    } catch (err) {
      if (err.code === 'DEVICE_LIMIT') { done(); $('#device-limit', el).innerHTML = deviceLimitNotice(err); return; }
      if (err.status === 401) { done(); location.hash = '#/login'; }
      throw err;
    }
  });
  onAction(el, {
    resend: (b) => run(b, async () => {
      const r = await API.post('/auth/resend-device-otp', { device_token: token });
      toast(r.message);
      if (r.dev_otp) { sessionStorage.setItem('devOtp', r.dev_otp); Views.verifyDevice(el); }
    }),
  });
};

/** «أجهزتي»: the 2 devices of the account; the student can remove the other one (limited per month). */
Views.devices = async (el) => {
  const d = await API.get('/auth/devices');
  el.innerHTML = `<h1 class="page-head">📱 أجهزتي</h1>
    <section class="card">
      <p class="muted">يعمل حسابك على <b>${d.max}</b> أجهزة بحدٍّ أقصى، وعلى جهاز واحد فقط في الوقت نفسه — إذا دخلت من الجهاز الآخر فسيُغلق هذا الجهاز.
        يحتاج أي جهاز جديد إلى رمز يُرسَل إلى بريدك الإلكتروني.</p>
      <div class="device-list">${d.devices.map((x) => `<div class="device ${x.current ? 'current' : ''}">
          <span class="device-icon" aria-hidden="true">${/iPhone|موبايل|iPad|تابلت/.test(x.name) ? '📱' : '💻'}</span>
          <div class="device-main"><span><b>${esc(x.name)}</b> ${x.current ? badge('هذا الجهاز', 'good') : ''}</span>
            <small class="muted">أُضيف ${fmtDay(x.created_at)} · آخر دخول ${fmtDate(x.last_seen_at)}</small></div>
          ${x.current ? '' : `<button class="btn danger tiny" data-action="remove" data-id="${x.id}" ${d.removals_left ? '' : 'disabled'}>احذف الجهاز</button>`}
        </div>`).join('')}
        ${Array.from({ length: Math.max(d.max - d.devices.length, 0) }, () => '<div class="device empty"><span class="device-icon">＋</span><div class="device-main muted">مكان شاغر لجهاز</div></div>').join('')}
      </div>
      <p class="muted small">${d.removals_left
        ? `يمكنك حذف جهاز ${d.removals_left === 1 ? 'مرة واحدة أخرى' : `${d.removals_left} مرات`} خلال آخر 30 يومًا (الحد ${d.removals_per_month}). بعد ذلك يكون التغيير عن طريق الإدارة.`
        : 'استخدمت كل مرات تغيير الأجهزة المتاحة خلال آخر 30 يومًا — إذا احتجت إلى تغيير جهاز فتواصل مع الإدارة.'}</p>
    </section>`;
  onAction(el, {
    remove: (b) => run(b, async () => {
      if (!confirm('هل تريد حذف هذا الجهاز من حسابك؟ إذا كان أحد يستخدمه فسيُغلق، وسيحتاج إلى رمز على بريدك الإلكتروني ليدخل مرة أخرى.')) return;
      await API.del(`/auth/devices/${b.dataset.id}`);
      toast('تم حذف الجهاز');
      Views.devices(el);
    }),
  });
};

/** Registration steps indicator: 1 details → 2 email code → 3 password. */
const regSteps = (active) => `<ol class="steps">${['بياناتك', 'تأكيد البريد', 'كلمة المرور'].map((t, i) =>
  `<li class="${i + 1 < active ? 'done' : i + 1 === active ? 'active' : ''}"><span>${i + 1 < active ? '✓' : i + 1}</span>${t}</li>`).join('')}</ol>`;

Views.register = async (el) => {
  el.innerHTML = `<div class="auth card wide">
    <h1>إنشاء حساب طالب</h1>
    ${regSteps(1)}
    <form id="f" class="form grid2">
      <label class="span2">الاسم بالكامل<input name="full_name" required minlength="3" value="${esc(sessionStorage.getItem('regName') || '')}"></label>
      <label class="span2">البريد الإلكتروني<input name="email" type="email" required autocomplete="email" value="${esc(sessionStorage.getItem('verifyEmail') || '')}"></label>
      <label>رقم الطالب<input name="phone" required inputmode="numeric" placeholder="01012345678"></label>
      <label>رقم ولي الأمر<input name="parent_phone" required inputmode="numeric" placeholder="01212345678"></label>
      <label class="span2">البريد الإلكتروني لولي الأمر (اختياري — لاستلام التقارير)<input name="parent_email" type="email"></label>
      <button class="btn primary span2" type="submit">إرسال رمز التأكيد إلى البريد الإلكتروني</button>
    </form>
    <p class="links">لديك حساب؟ <a href="#/login">سجّل الدخول</a></p>
  </div>`;
  onSubmit($('#f', el), async (v) => {
    const r = await API.post('/auth/register', v);
    sessionStorage.setItem('verifyEmail', v.email);
    sessionStorage.setItem('regName', v.full_name);
    if (r.dev_otp) sessionStorage.setItem('devOtp', r.dev_otp);
    else sessionStorage.removeItem('devOtp');
    location.hash = '#/verify';
  });
};

Views.verify = async (el) => {
  const email = sessionStorage.getItem('verifyEmail') || '';
  const devOtp = sessionStorage.getItem('devOtp');
  el.innerHTML = `<div class="auth card">
    <h1>تأكيد البريد الإلكتروني</h1>
    ${regSteps(2)}
    <p class="muted">أرسلنا رمزًا من 6 أرقام إلى ${email ? `<b>${esc(email)}</b>` : 'بريدك'}.</p>
    <div class="notice mid small spam-tip">📩 <b>لم تجد الرسالة؟</b> افتح مجلد <b>Spam</b> (الرسائل غير المرغوب فيها) — وإن وجدتها هناك فاضغط <b>«Not spam / ليست رسالة غير مرغوب فيها»</b> لتصلك رسائلنا القادمة في الـ Inbox.</div>
    ${devOtp ? `<p class="notice">وضع تجريبي — الرمز: <b class="mono">${esc(devOtp)}</b></p>` : ''}
    <form id="f" class="form">
      <label ${email ? 'hidden' : ''}>البريد الإلكتروني<input name="email" type="email" required value="${esc(email)}"></label>
      <label>رمز التحقق<input name="code" required inputmode="numeric" maxlength="6" pattern="\\d{6}" class="otp" autocomplete="one-time-code"></label>
      <button class="btn primary" type="submit">تأكيد</button>
    </form>
    <p class="links"><a href="#" data-action="resend">إعادة إرسال الرمز</a> · <a href="#/register">تعديل البيانات</a></p>
  </div>`;
  onSubmit($('#f', el), async (v) => {
    const r = await API.post('/auth/verify-otp', v);
    sessionStorage.removeItem('devOtp');
    sessionStorage.setItem('setupToken', r.setup_token);
    toast(r.message);
    location.hash = '#/set-password';
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

Views.setPassword = async (el) => {
  const setupToken = sessionStorage.getItem('setupToken');
  if (!setupToken) { location.hash = '#/register'; return; }
  el.innerHTML = `<div class="auth card">
    <h1>عيّن كلمة المرور</h1>
    ${regSteps(3)}
    <p class="notice good">✓ تم تأكيد بريدك الإلكتروني</p>
    <form id="f" class="form">
      <label>كلمة المرور<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="8 أحرف على الأقل، حروف وأرقام"></label>
      <label>تأكيد كلمة المرور<input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn primary" type="submit">إنشاء الحساب</button>
    </form>
  </div>`;
  onSubmit($('#f', el), async (v) => {
    if (v.password !== v.confirm) throw new Error('كلمتا المرور غير متطابقتين');
    let r;
    try {
      r = await API.post('/auth/set-password', { setup_token: setupToken, password: v.password, device_id: deviceId() });
    } catch (err) {
      if (err.status === 401) { sessionStorage.removeItem('setupToken'); location.hash = '#/verify'; }
      throw err;
    }
    ['setupToken', 'verifyEmail', 'regName'].forEach((k) => sessionStorage.removeItem(k));
    API.setToken(r.token);
    await State.refresh();
    renderTopbar('/');
    el.innerHTML = `<div class="auth card center">
      <h1>🎉 تم إنشاء حسابك</h1>
      <p class="muted">هذا كود الطالب الخاص بك — احفظه؛ يمكنك الدخول به ومشاركته مع أصدقائك ليضيفوك إلى الفريق:</p>
      <div class="big mono">${esc(r.student_code)}</div>
      <div class="row center"><button class="btn ghost" data-action="copy">نسخ الكود</button><a class="btn primary" href="#/">ادخل إلى حسابك</a></div>
    </div>`;
    onAction(el, { copy: () => navigator.clipboard?.writeText(r.student_code).then(() => toast('تم نسخ الكود')) });
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
      <div class="notice mid small spam-tip">📩 <b>لم تجد الرسالة؟</b> افتح مجلد <b>Spam</b> — وإن وجدتها هناك فاضغط <b>«Not spam»</b> لتصلك رسائلنا القادمة في الـ Inbox.</div>
      <label>رمز التحقق<input name="code" required inputmode="numeric" maxlength="6" class="otp"></label>
      <label>كلمة المرور الجديدة<input name="new_password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn primary" type="submit">تغيير كلمة المرور</button>
    </form>
    <p class="links"><a href="#/login">العودة إلى تسجيل الدخول</a></p>
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
  const [me, perf, mist, tasks, ai, ann, notif] = await Promise.all([
    State.refresh(), API.get('/reports/performance'), API.get('/mistakes/summary'), API.get('/planner/tasks'), API.get('/ai/usage'),
    API.get('/announcements').catch(() => ({ announcements: [], unread: 0 })),
    API.get('/notifications').catch(() => ({ notifications: [], unread: 0 })),
  ]);
  // No subscription, or a plan without AI: the points can't be used, so the tile shows which plan unlocks them.
  const aiLocked = !me.subscription?.features?.ai_explanations;
  const aiPlanName = aiLocked
    ? ((await API.get('/payments/plans').catch(() => ({ plans: [] }))).plans.find((p) => p.features?.ai_explanations)?.name_ar || 'Premium')
    : '';
  // Unread announcements (and pinned ones, always) on top of the home page.
  const shown = ann.announcements.filter((a) => !a.is_read || a.pinned);
  // Personal notifications not read yet (payment accepted, results announced, renewal…) go first.
  const newNotes = notif.notifications.filter((n) => !n.is_read);
  // Subscription ending within 3 days: a renewal reminder (computed here, so it shows even before the daily job).
  const daysLeft = me.subscription ? Math.ceil((new Date(me.subscription.ends_at) - Date.now()) / 86400000) : null;
  const renew = daysLeft !== null && daysLeft <= 3
    ? `<div class="notice mid renew-banner">⏰ سينتهي اشتراكك ${daysLeft <= 1 ? 'خلال يوم' : `بعد ${daysLeft} أيام`} (${fmtDay(me.subscription.ends_at)}) — جدِّد حتى لا تتوقف، ويُضاف التجديد إلى المدة المتبقية.
        <a class="btn primary tiny" href="#/subscribe">جدِّد الآن</a></div>` : '';
  const u = me.user;
  const sub = me.subscription;
  el.innerHTML = `
    <section class="card hero">
      <div>
        <h1>أهلاً ${esc(u.full_name.split(' ')[0])} 👋</h1>
        <p class="muted">كود الطالب: <b class="mono">${esc(u.student_code)}</b>
          <button class="btn tiny ghost" data-action="copy">نسخ</button> — شاركه مع أصدقائك ليضيفوك إلى الفريق</p>
        <p class="muted small"><a href="#/devices">📱 أجهزتي</a></p>
      </div>
      ${sub
        ? `<div class="sub-chip good">${esc(sub.name_ar)}<small>ساري حتى ${fmtDay(sub.ends_at)}</small></div>`
        : '<a class="btn primary" href="#/subscribe">اشترك الآن</a>'}
    </section>

    ${renew}
    <section class="announcements" id="home-notes">${newNotes.map((n) => noteCard(n, true)).join('')}</section>
    <section class="announcements" id="home-ann">${shown.map((a) => announceCard(a, !a.is_read)).join('')}</section>

    <section class="tiles">
      <div class="tile"><span class="tile-label">الأداء العام</span><b class="${percentTone(perf.overall.percent)}">${perf.overall.percent ?? '—'}%</b><small>${esc(perf.overall.rating)}</small></div>
      <a class="tile" href="#/practice"><span class="tile-label">أسئلة اليوم</span><b>${perf.today.answered}</b><small>${perf.today.answered ? `منها ${perf.today.correct} صحيحة` : 'لم تحل أسئلة اليوم بعد'}</small></a>
      <a class="tile" href="#/mistakes"><span class="tile-label">بنك الأخطاء</span><b>${mist.total}</b><small>سؤال يحتاج إلى مراجعة</small></a>
      <a class="tile" href="#/planner"><span class="tile-label">مهام اليوم</span><b>${tasks.summary.done}/${tasks.summary.total}</b><small>${tasks.summary.planned_minutes} دقيقة مذاكرة</small></a>
      ${aiLocked
        ? `<a class="tile" href="#/subscribe"><span class="tile-label">نقاط الذكاء الاصطناعي</span><b>🔒</b><small>الشرح بالذكاء الاصطناعي متاح في باقة ${esc(aiPlanName)}</small></a>`
        : `<div class="tile"><span class="tile-label">نقاط الذكاء الاصطناعي</span><b>${fmtPoints(ai.remaining_points)}</b><small>متبقي من ${fmtPoints(ai.limit_points)}</small>${bar(100 - ai.used_percent, ai.used_percent > 80 ? 'bad' : 'good')}</div>`}
    </section>

    <section class="card">
      <div class="card-head"><h2>تقييمك في كل مادة</h2><a href="#/report" class="btn tiny ghost">تقرير ولي الأمر</a></div>
      ${perf.subjects.length
        ? perf.subjects.map((s) => `<div class="perf-row">
            <span>${esc(s.subject)}</span>${bar(s.percent, percentTone(s.percent))}
            <b class="${percentTone(s.percent)}">${s.percent}%</b><small class="muted">${esc(s.rating)} · ${s.correct}/${s.attempts}</small></div>`).join('')
        : empty('لم تحل أي أسئلة بعد. ابدأ التدريب ليظهر تقييمك.', '<a class="btn primary" href="#/practice">ابدأ التدريب</a>')}
    </section>`;
  onAction(el, {
    copy: () => navigator.clipboard?.writeText(u.student_code).then(() => toast('تم نسخ الكود')),
    readAnn: (b) => markAnnouncementRead(b),
    readNote: (b) => run(b, async () => {
      await API.post(`/notifications/${b.dataset.id}/read`);
      b.closest('.announce')?.remove();
      refreshBell();
    }),
  });
};

// ---------------------------------------------------------------- Announcements (from the admins)
const TONE_ICON = { info: '📢', success: '🎉', warning: '⚠️' };
/**
 * Payment method logos (manual payment card). InstaPay: a text badge until its logo is added (public/img/pay/instapay.png).
 */
const PAY_LOGOS = {
  vodafone: '<img class="pay-logo" src="/img/pay/vodafone.svg" alt="فودافون كاش" title="فودافون كاش">',
  etisalat: '<img class="pay-logo" src="/img/pay/etisalat.png" alt="اتصالات كاش" title="اتصالات كاش">',
  orange: '<img class="pay-logo full" src="/img/pay/orange.png" alt="أورانج كاش" title="أورانج كاش">',
  instapay: '<span class="pay-logo text instapay" title="إنستاباي">InstaPay</span>',
};

/** A personal notification (same look as an announcement), with its link and an "تمام" to mark it read. */
const noteCard = (n, dismissable = false) => `<article class="announce ${esc(n.tone)}${n.is_read ? ' read' : ''}">
    <div class="announce-main">
      <div class="announce-title"><b>${esc(n.title)}</b>${n.is_read ? '' : ' <span class="badge bad">جديد</span>'}</div>
      ${n.body ? `<p>${esc(n.body)}</p>` : ''}
      <div class="row wrap"><small class="muted">${fmtDate(n.created_at)}</small>
        ${n.link && n.link !== '#/' ? `<a class="btn tiny primary" href="${esc(n.link)}">افتح</a>` : ''}</div>
    </div>
    ${dismissable ? `<button class="btn tiny ghost" data-action="readNote" data-id="${n.id}">حسنًا</button>` : ''}
  </article>`;

const announceCard = (a, dismissable = false) => `<article class="announce ${esc(a.tone)}${a.is_read ? ' read' : ''}" data-ann="${a.id}">
    <span class="announce-icon" aria-hidden="true">${TONE_ICON[a.tone] || '📢'}</span>
    <div class="announce-main">
      <div class="announce-title">${a.pinned ? '<span title="مثبت">📌</span> ' : ''}<b>${esc(a.title)}</b>
        ${a.is_read ? '' : '<span class="badge bad">جديد</span>'}</div>
      ${a.body ? `<p class="pre">${rich(a.body)}</p>` : ''}
      <div class="row wrap"><small class="muted">${fmtDate(a.starts_at)}</small>
        ${a.link_url ? `<a class="btn tiny ghost" href="${esc(a.link_url)}" target="_blank" rel="noopener">افتح الرابط ↗</a>` : ''}</div>
    </div>
    ${dismissable ? `<button class="btn tiny ghost" data-action="readAnn" data-id="${a.id}">حسنًا</button>` : ''}
  </article>`;

/** Marks one announcement read: the card leaves the home page (pinned ones stay, without the "new" tag). */
async function markAnnouncementRead(b) {
  await run(b, async () => {
    await API.post(`/announcements/${b.dataset.id}/read`);
    const card = b.closest('.announce');
    if (card && !card.querySelector('[title="مثبت"]')) card.remove();
    else if (card) { card.classList.add('read'); card.querySelector('.badge')?.remove(); b.remove(); }
    refreshBell();
  });
}

/** The 🔔 in the top bar: unread count, and a list of every current announcement. */
const BELL_TTL_MS = 60_000; // page navigation reuses the last answer for a minute (fewer requests under load)
let bellCache = { at: 0, data: null };
async function refreshBell(force = true) {
  const b = $('#bell');
  if (!b) return null;
  try {
    const fresh = !force && bellCache.data && Date.now() - bellCache.at < BELL_TTL_MS;
    const data = fresh ? bellCache.data : await Promise.all([
      API.get('/announcements'), API.get('/notifications').catch(() => ({ notifications: [], unread: 0 })),
    ]).then(([a, n]) => ({ announcements: a.announcements, notifications: n.notifications, unread: a.unread + n.unread, notesUnread: n.unread, annUnread: a.unread }));
    bellCache = fresh ? bellCache : { at: Date.now(), data };
    const n = $('.bell-count', b);
    n.textContent = data.unread > 9 ? '9+' : data.unread;
    n.hidden = !data.unread;
    b.setAttribute('aria-label', data.unread ? `الإشعارات (${data.unread} جديد)` : 'الإشعارات');
    return data;
  } catch { return null; }
}
async function openAnnouncements() {
  const data = await refreshBell();
  if (!data) return;
  modal(`<h2>الإشعارات</h2>
    ${data.notifications.length ? `<h3>إشعاراتك</h3><div class="announcements">${data.notifications.slice(0, 10).map((n) => noteCard(n)).join('')}</div>` : ''}
    <h3>إعلانات المنصة</h3>${data.announcements.length
    ? `<div class="announcements">${data.announcements.map((a) => announceCard(a)).join('')}</div>`
    : empty('لا توجد إعلانات الآن')}`);
  if (data.notesUnread) {
    await API.post('/notifications/read-all').catch(() => {});
    $$('#home-notes .announce').forEach((c) => c.remove());
    refreshBell();
  }
  if (data.annUnread) {
    await API.post('/announcements/read-all').catch(() => {});
    refreshBell();
    // The home page no longer needs to show them as new.
    $$('#home-ann .announce').forEach((c) => (c.querySelector('[title="مثبت"]') ? (c.classList.add('read'), c.querySelector('.badge')?.remove(), c.querySelector('[data-action=readAnn]')?.remove()) : c.remove()));
  }
}

// ---------------------------------------------------------------- Images (served from /api/media, same origin)
const qImage = (url, alt) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="q-img-link"><img class="q-img" src="${esc(url)}" alt="${esc(alt)}" loading="lazy"></a>` : '');
const optImage = (url, alt) => (url ? `<img class="opt-img" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">` : '');

// ---------------------------------------------------------------- Reading passage / shared figure (stays fixed above its questions)
/** range: [first, last] question numbers of this passage, shown in the title when it covers several questions. */
/** A long passage (or a big figure with text) doesn't fit above the question: it goes in a side column / phone drawer. */
const isLongPassage = (p) => Boolean(p) && ((p.text || '').length > 500 || (Boolean(p.image) && (p.text || '').length > 200));

function passageBox(p, range, { open = true, side = false } = {}) {
  if (!p) return '';
  const what = p.text ? 'القطعة' : 'الرسمة';
  const nums = range && range[1] > range[0] ? ` — الأسئلة من ${range[0]} إلى ${range[1]}` : '';
  if (side) {
    // Computer: a sticky column beside the questions. Phone: a drawer opened by the button.
    return `<div class="p-backdrop" data-passage-close></div>
      <aside class="passage-side" data-passage="${p.id}" aria-label="${what}">
        <header class="ps-head"><b>📖 ${what}${nums}</b><button type="button" class="btn ghost tiny ps-close" data-passage-close>✕ إغلاق</button></header>
        <div class="ps-body">${p.text ? `<p class="passage-text">${rich(p.text)}</p>` : ''}${qImage(p.image, what)}</div>
      </aside>
      <button type="button" class="btn primary p-open" data-passage-open>📖 اعرض ${what}${nums}</button>`;
  }
  return `<details class="passage" data-passage="${p.id}" ${open ? 'open' : ''}>
    <summary>${p.text ? '📖' : '🖼️'} ${what}${nums} <small class="muted">(اضغط للإخفاء/الإظهار)</small></summary>
    <div class="passage-body">${p.text ? `<p class="passage-text">${rich(p.text)}</p>` : ''}${qImage(p.image, what)}</div>
  </details>`;
}
// Phone drawer for long passages (one handler for practice and competitions).
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-passage-open]');
  const closer = e.target.closest('[data-passage-close]');
  if (!opener && !closer) return;
  const box = (opener || closer).closest('.passage-slot, .passage-group');
  const open = Boolean(opener);
  box?.querySelector('.passage-side')?.classList.toggle('open', open);
  box?.querySelector('.p-backdrop')?.classList.toggle('open', open);
  document.body.classList.toggle('drawer-open', open);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  $$('.passage-side.open, .p-backdrop.open').forEach((x) => x.classList.remove('open'));
  document.body.classList.remove('drawer-open');
});

/** [first, last] (1-based) of the questions around index i that share its passage. */
function passageRange(questions, i, pidOf = (q) => q.passage?.id) {
  const pid = pidOf(questions[i]);
  let a = i;
  let b = i;
  while (a > 0 && pidOf(questions[a - 1]) === pid) a--;
  while (b < questions.length - 1 && pidOf(questions[b + 1]) === pid) b++;
  return [a + 1, b + 1];
}

// ---------------------------------------------------------------- Shared question card (practice + mistakes retry)
function questionCard(q, idx, total) {
  return `<div class="card qcard">
    <div class="q-meta">
      <span>سؤال ${idx + 1} من ${total}</span>
      <span>${esc(q.subject || '')}${q.lesson ? ` · ${esc(q.lesson)}` : ''}</span>
      ${q.category === 'past_exam' ? badge(`امتحان سابق${q.exam_year ? ` ${q.exam_year}` : ''}`, 'mid') : ''}
    </div>
    ${q.question ? `<h2 class="q-text">${rich(q.question)}</h2>` : ''}
    ${qImage(q.image, 'صورة السؤال')}
    <div class="options">
      ${['A', 'B', 'C', 'D'].map((k, i) => `<button class="option" data-action="choose" data-key="${k}"><span class="opt-key">${'أبجد'[i]}</span>
        <span class="opt-body">${q.options[k] ? `<span>${rich(q.options[k])}</span>` : ''}${optImage(q.option_images?.[k], `الاختيار ${'أبجد'[i]}`)}</span></button>`).join('')}
    </div>
    <div class="feedback" hidden></div>
    <div class="explain" hidden></div>
    <div class="q-actions">
      <button class="btn ghost tiny" data-action="skip">تخطي السؤال ←</button>
      <button class="btn ghost" data-action="explain" hidden>عرض الشرح</button>
      <button class="btn primary" data-action="next" disabled title="اختر إجابة أولًا">${idx + 1 < total ? 'السؤال التالي' : 'إنهاء'}</button>
    </div>
    <p class="next-hint">اختر إجابة لتتمكن من المتابعة، أو اضغط "تخطي السؤال"</p>
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
  const law = r.law_note ? `<p class="law">📐 ${rich(r.law_note)}</p>` : '';
  if (r.explanation || r.explanation_image) {
    box.innerHTML = `<div class="src">${r.source === 'question_bank' ? 'شرح من بنك الأسئلة — مجاني' : 'شرح محفوظ — مجاني'}</div>${r.explanation ? `<p>${rich(r.explanation)}</p>` : ''}${qImage(r.explanation_image, 'صورة الشرح')}${law}
      ${r.source === 'question_bank' ? '<div class="ai-more"><button class="btn ai" data-action="ai" data-simpler="1">🤔 لم أفهم، اشرح لي أكثر</button></div>' : ''}`;
    btn.remove();
    return;
  }
  box.innerHTML = `<p class="muted">${esc(r.message)}</p>${law}<button class="btn ai" data-action="ai">✨ اشرح بالذكاء الاصطناعي</button>`;
  btn.remove();
}

/** simpler: "مش فاهم" under a saved explanation — the AI answer goes below it instead of replacing it. */
async function askAI(card, qid, simpler = false) {
  const box = simpler ? $('.explain .ai-more', card) : $('.explain', card);
  try {
    const r = await API.post(`/ai/explain/${qid}${simpler ? '?simpler=1' : ''}`);
    const cost = r.usage?.cost_egp
      ? `<div class="src">✨ شرح بالذكاء الاصطناعي · استُهلك ${fmtPoints(r.usage.cost_points)} · متبقي ${fmtPoints(r.usage.remaining_points)}</div>`
      : `<div class="src">${simpler ? '✨ شرح أبسط بالذكاء الاصطناعي — مجاني' : 'شرح محفوظ — مجاني'}</div>`;
    box.innerHTML = `${cost}<p class="pre">${rich(r.explanation)}</p>${r.law_note && !simpler ? `<p class="law">📐 ${rich(r.law_note)}</p>` : ''}
      ${r.warning ? `<p class="notice bad">${esc(r.warning)}</p>` : ''}`;
  } catch (err) {
    if (err.code === 'AI_LIMIT_REACHED') box.innerHTML = `<p class="notice bad">⛔ ${esc(err.message)}</p>`;
    else if (isSubError(err)) {
      // e.g. Plus: the button is shown, but using it needs Premium.
      box.innerHTML = `<div class="notice mid upgrade">🔒 ${esc(err.message)}
        <a class="btn primary tiny" href="#/subscribe">${err.details?.plan_name ? `اشترك في ${esc(err.details.plan_name)}` : 'عرض الباقات'}</a></div>`;
    } else throw err;
  }
}

/**
 * Runs a list of questions one by one. answerFn(q, key) → { is_correct, correct_option, note }.
 * Skipped questions are never sent to the server, so they are not counted wrong; onDone gets
 * { correct, wrong, skipped: [questions] } so the student can come back to them.
 */
function runQuiz(el, questions, { answerFn, onDone, allowExplain = true }) {
  let i = 0;
  let correct = 0;
  let wrong = 0;
  const skipped = [];
  let shownAt = 0;
  const show = () => {
    const q = questions[i];
    if (!$('.q-slot', el)) el.innerHTML = '<div class="quiz-wrap"><div class="passage-slot"></div><div class="q-slot"></div></div>';
    // The passage is replaced only when the question belongs to another one, so it stays put (scroll, open/closed) between its questions.
    const slot = $('.passage-slot', el);
    const pid = String(q.passage?.id || '');
    if (slot.dataset.pid !== pid) {
      slot.dataset.pid = pid;
      const side = isLongPassage(q.passage);
      slot.innerHTML = passageBox(q.passage, passageRange(questions, i), { side });
      $('.quiz-wrap', el).classList.toggle('split', side);
      document.body.classList.remove('drawer-open');
    }
    $('.q-slot', el).innerHTML = questionCard(q, i, questions.length);
    shownAt = Date.now();
    // Next question of a long passage: bring the passage back into view (below the sticky top bar).
    const barH = $('#topbar')?.offsetHeight || 0;
    const top = (q.passage ? slot : $('.q-slot', el)).getBoundingClientRect().top;
    if (top < barH) window.scrollBy({ top: top - barH - 8 });
  };
  const card = () => $('.qcard', el);
  const advance = () => {
    i++;
    if (i < questions.length) show();
    else onDone({ correct, wrong, skipped });
  };
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
      else wrong++;
      markOptions(card(), b.dataset.key, r.correct_option);
      // Answered: no more skipping; "next" becomes active (it stays visible but disabled until now).
      $('[data-action=skip]', card())?.remove();
      $('.next-hint', card())?.remove();
      const next = $('[data-action=next]', card());
      next.disabled = false;
      next.removeAttribute('title');
      const fb = $('.feedback', card());
      fb.hidden = false;
      fb.className = `feedback ${r.is_correct ? 'good' : 'bad'}`;
      fb.innerHTML = `${r.is_correct ? '✅ إجابة صحيحة' : '❌ إجابة خاطئة'}${r.note ? ` — <small>${esc(r.note)}</small>` : ''}`;
      if (allowExplain) $('[data-action=explain]', card()).hidden = false;
    }),
    skip: () => {
      skipped.push(questions[i]);
      toast(`⚠️ تخطيت السؤال ${i + 1} — لن يُحتسب خطأً، ويمكنك العودة إليه في النهاية`, 'warn');
      advance();
    },
    explain: (b) => run(b, () => showExplanation(card(), questions[i].id, b)),
    ai: (b) => run(b, async () => {
      b.textContent = 'جارٍ التوليد…';
      await askAI(card(), questions[i].id, b.dataset.simpler === '1');
    }),
    next: advance,
  });
  show();
}

/** End-of-quiz summary: correct / wrong / skipped, with a warning + shortcut back to the skipped questions. */
function quizSummary({ correct, wrong, skipped }, { title, note, actions = '' }) {
  const answered = correct + wrong;
  const p = answered ? Math.round((correct / answered) * 100) : 0;
  return `<div class="card center">
    <h2>${title}</h2>
    ${answered ? `<div class="big ${percentTone(p)}">${correct}/${answered}</div><p class="muted">${p}% من الأسئلة التي أجبت عنها${note ? ` — ${note}` : ''}</p>` : ''}
    <div class="score-split"><span class="good">✅ صحيحة: ${correct}</span><span class="bad">❌ خاطئة: ${wrong}</span><span class="mid">⏭ متروك: ${skipped.length}</span></div>
    ${skipped.length ? `<div class="notice mid">⚠️ تخطيت <b>${skipped.length}</b> سؤال — لم تُحتسب خطأً وليست في بنك الأخطاء، لكن ما زلت بحاجة إلى حلها.</div>
      <button class="btn primary" data-action="solveSkipped">حل الأسئلة التي تخطيتها (${skipped.length})</button>` : ''}
    <div class="row center wrap">${actions}</div>
  </div>`;
}

function quizResult(el, result, { again, solveSkipped }) {
  el.innerHTML = quizSummary(result, {
    title: result.skipped.length ? 'انتهت الجولة — لكن توجد أسئلة فاتتك' : 'انتهيت! 🎯',
    note: 'أُضيفت الأخطاء إلى بنك الأخطاء',
    actions: `<button class="btn ${result.skipped.length ? 'ghost' : 'primary'}" data-action="again">جولة جديدة</button><a class="btn ghost" href="#/mistakes">بنك الأخطاء</a>`,
  });
  $('[data-action=again]', el).addEventListener('click', again);
  $('[data-action=solveSkipped]', el)?.addEventListener('click', solveSkipped);
}

// ---------------------------------------------------------------- Practice
/** Lesson select: "الدرس" shown until a choice, then "كل الدروس" + each lesson with its question count. */
const lessonOptions = (subject) => `<option value="all">كل الدروس</option>${
  (subject?.lessons || []).map((l) => `<option value="${l.id}">${esc(l.name)} (${l.questions})</option>`).join('')}`;

Views.practice = async (el) => {
  // Students only see subjects/lessons that actually have questions.
  const subjects = (await API.get('/catalog/subjects')).subjects
    .filter((s) => s.questions > 0)
    .map((s) => ({ ...s, lessons: s.lessons.filter((l) => l.questions > 0) }));
  if (!subjects.length) { el.innerHTML = empty('لا توجد أسئلة متاحة للتدريب بعد.'); return; }
  const setup = () => {
    el.innerHTML = `<div class="card">
      <h1>التدريب</h1>
      <form id="f" class="form grid3">
        <label>المادة<span class="select-ph" data-ph="المادة"><select name="subject_id" required>
          ${subjects.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></span></label>
        <label>الدرس<span class="select-ph" data-ph="الدرس"><select name="lesson_id" required>${lessonOptions(null)}</select></span></label>
        <label>النوع<select name="category"><option value="">الكل</option><option value="lesson">دروس</option><option value="past_exam">امتحانات سابقة</option></select></label>
        <label>عدد الأسئلة<select name="limit">${[10, 20, 30, 40, 50].map((n) => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="unsolved_only"> أسئلة جديدة فقط (لم تحلها من قبل)</label>
        <button class="btn primary" type="submit">ابدأ</button>
      </form>
      <div id="practice-msg"></div>
    </div>`;
    const form = $('#f', el);
    const msg = $('#practice-msg', el);
    // Any change to the choices clears a previous "all solved" message.
    form.addEventListener('change', () => { msg.innerHTML = ''; });
    // "المادة" / "الدرس" are drawn over an empty select (no placeholder option), so they never appear
    // inside the dropdown list — on iPhone too, where hidden <option>s are still listed.
    const blank = (sel) => { sel.selectedIndex = -1; sel.parentElement.classList.remove('filled'); };
    form.addEventListener('change', (e) => {
      if (e.target.tagName === 'SELECT') e.target.parentElement.classList.toggle('filled', e.target.selectedIndex >= 0);
    });
    form.subject_id.addEventListener('change', () => {
      const s = subjects.find((x) => String(x.id) === form.subject_id.value);
      form.lesson_id.innerHTML = lessonOptions(s);
      blank(form.lesson_id);
    });
    blank(form.subject_id);
    blank(form.lesson_id);
    onSubmit(form, async (v) => {
      const qs = new URLSearchParams();
      for (const [k, val] of Object.entries(v)) if (val !== undefined && val !== false && val !== 'all') qs.set(k, String(val));
      let r;
      try {
        r = await API.get(`/catalog/questions?${qs}`);
      } catch (err) {
        if (isSubError(err)) return subscriptionWall(el, err);
        throw err;
      }
      if (!r.questions.length) {
        if (v.unsolved_only) {
          // Everything in this scope was already answered at least once.
          const subject = subjects.find((s) => String(s.id) === v.subject_id);
          const lesson = subject?.lessons.find((l) => String(l.id) === v.lesson_id);
          const scope = lesson ? `درس "${esc(lesson.name)}"` : `مادة ${esc(subject?.name || '')}`;
          msg.innerHTML = `<div class="notice good all-solved">
            <b>🎉 لقد حللت كل الأسئلة</b> في ${scope}${v.category ? ` (${esc(LABELS.category[v.category])})` : ''}!
            <p>ألغِ اختيار "أسئلة جديدة فقط" لمراجعتها مرة أخرى، أو راجع بنك الأخطاء.</p>
            <div class="row wrap"><button class="btn primary tiny" type="button" data-review>راجع الأسئلة مرة أخرى</button>
            <a class="btn ghost tiny" href="#/mistakes">بنك الأخطاء</a></div></div>`;
          $('[data-review]', msg).addEventListener('click', () => { form.unsolved_only.checked = false; form.requestSubmit(); });
          return undefined;
        }
        return toast('لا توجد أسئلة بهذه الاختيارات', 'err');
      }
      const start = (questions) => runQuiz(el, questions, {
        answerFn: async (q, key, ms) => {
          const a = await API.post('/catalog/answer', { question_id: q.id, choice: key, time_spent_ms: ms });
          return { ...a, note: a.added_to_mistakes ? 'أُضيف إلى بنك الأخطاء' : a.removed_from_mistakes ? 'حُذف من بنك الأخطاء' : '' };
        },
        onDone: (res) => quizResult(el, res, { again: setup, solveSkipped: () => start(res.skipped) }),
      });
      start(r.questions);
    });
  };
  if (!State.subscription && State.user.role !== 'admin') {
    return subscriptionWall(el, { message: 'التدريب يتطلب اشتراكًا فعالًا' });
  }
  setup();
};

// ---------------------------------------------------------------- Mistakes bank
Views.mistakes = async (el) => {
  const summary = await API.get('/mistakes/summary');
  el.innerHTML = `<div class="card-head page-head"><h1>بنك الأخطاء</h1>${badge(`${summary.total} سؤال`, summary.total ? 'bad' : 'good')}</div>
    <p class="muted">أي سؤال تخطئ فيه يُحفظ هنا تلقائيًا. أعد حله — وإذا أجبت إجابة صحيحة يُحذف من القائمة.</p>
    ${summary.total ? summary.subjects.map((s) => `<section class="card">
        <div class="card-head"><h2>${esc(s.subject)} ${badge(s.total, 'bad')}</h2>
          <button class="btn primary tiny" data-action="retry" data-subject="${s.subject_id}">أعد حل أخطاء المادة</button></div>
        <ul class="list">${s.lessons.map((l) => `<li><span>${esc(l.lesson)}</span><span class="muted">${l.mistakes} سؤال · آخر خطأ ${fmtDay(l.last_wrong_at)}</span>
          <button class="btn ghost tiny" data-action="retry" data-subject="${s.subject_id}" data-lesson="${l.lesson_id ?? ''}">أعد الحل</button></li>`).join('')}</ul>
      </section>`).join('') : empty('لا توجد أخطاء محفوظة 🎉 واصل التدريب!', '<a class="btn primary" href="#/practice">تدريب</a>')}`;

  onAction(el, {
    retry: (b) => run(b, async () => {
      const qs = new URLSearchParams({ subject_id: b.dataset.subject, limit: '20' });
      if (b.dataset.lesson) qs.set('lesson_id', b.dataset.lesson);
      const { questions } = await API.get(`/mistakes/quiz?${qs}`);
      const host = document.createElement('div');
      el.replaceChildren(host);
      const start = (qs) => runQuiz(host, qs, {
        answerFn: async (q, key) => {
          const r = await API.post(`/mistakes/${q.id}/retry`, { choice: key });
          return { ...r, note: r.message };
        },
        onDone: (res) => {
          host.innerHTML = quizSummary(res, {
            title: `${res.correct} سؤال حُلّت بشكل صحيح وحُذفت من البنك`,
            actions: `<button class="btn ${res.skipped.length ? 'ghost' : 'primary'}" data-action="back">العودة إلى بنك الأخطاء</button>`,
          });
          $('[data-action=back]', host).addEventListener('click', () => Views.mistakes(el));
          $('[data-action=solveSkipped]', host)?.addEventListener('click', () => start(res.skipped));
        },
      });
      start(questions);
    }),
  });
};

// ---------------------------------------------------------------- Competitions
Views.competitions = async (el) => {
  const { competitions } = await API.get('/competitions');
  el.innerHTML = `<h1 class="page-head">المسابقات</h1>
    <p class="muted">مسابقة الفرق كل جمعة، والمسابقة الشهرية فردية. يرى كل طالب الأسئلة والاختيارات بترتيب مختلف.</p>
    ${competitions.length ? `<div class="grid-cards">${competitions.map((c) => `<a class="card comp" href="#/competition/${c.id}">
        <div class="row between">${badge(LABELS.compStatus[c.status], LABELS.compTone[c.status])}<small class="muted">${esc(LABELS.compType[c.type])}</small></div>
        <h2>${esc(c.title)}</h2>
        <p class="muted">${fmtDate(c.starts_at)} ← ${fmtDate(c.ends_at)}</p>
        <p>${c.question_count} سؤال · ${c.duration_minutes} دقيقة</p>
        ${c.my_submitted_at
          ? (c.results_published ? `<p class="good">درجتك: <b>${c.my_score}/${c.question_count}</b></p>` : '<p class="good">✅ تم التسليم بنجاح</p>')
          : c.status === 'active' ? '<span class="btn primary tiny">ادخل المسابقة</span>' : ''}
      </a>`).join('')}</div>` : empty('لا توجد مسابقات بعد.')}`;
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
    if (lb.results_hidden) {
      // Results not announced yet: nothing about scores, ranking or correct answers.
      el.innerHTML = `<div class="page-head"><h1>${esc(c.title)}</h1>${badge(LABELS.compStatus[c.status], LABELS.compTone[c.status])}</div>
        ${c.my_submitted_at
          ? '<section class="card center results-hidden submitted-ok"><div class="check-big" aria-hidden="true">✓</div><h2>تم التسليم بنجاح</h2></section>'
          : '<section class="card center results-hidden"><div class="big">🔒</div><h2>لم تُعلن النتيجة بعد</h2></section>'}`;
      return;
    }
    let review = '';
    if (c.status === 'finished' && c.my_submitted_at) {
      const { answers } = await API.get(`/competitions/${id}/review`);
      review = `<section class="card"><h2>إجاباتك</h2><ol class="review">${answers.map((a, i) => `<li class="${a.is_correct ? 'good' : a.selected_option ? 'bad' : 'skip'}">
        ${a.passage && answers[i - 1]?.passage?.id !== a.passage.id ? passageBox(a.passage, passageRange(answers, i), { open: false }) : ''}
        <p>${rich(a.question_text)}</p>${qImage(a.media.question, 'صورة السؤال')}
        <small>إجابتك: ${a.selected_option ? `${letterAr(a.selected_option)} ${rich(a[`option_${a.selected_option.toLowerCase()}`])}` : 'لم تُجب'} · الصحيحة: <b>${letterAr(a.correct_option)} ${rich(a[`option_${a.correct_option.toLowerCase()}`])}</b></small></li>`).join('')}</ol></section>`;
    }
    const me = State.user.student_code;
    el.innerHTML = `<div class="page-head"><h1>${esc(c.title)}</h1>${badge(LABELS.compStatus[c.status], LABELS.compTone[c.status])}</div>
      ${lb.published === false ? '<p class="notice mid">🔒 النتيجة ما زالت مخفية عن الطلاب — تراها لأنك أدمن. أعلنها من صفحة المسابقات.</p>' : ''}
      ${lb.teams ? `<section class="card"><h2>ترتيب الفرق</h2>${table(['#', 'الفريق', 'المشاركون', 'النقاط'],
        lb.teams.map((t) => [medal(t.rank), esc(t.team), t.participants, `<b>${t.total_score}</b>`]))}</section>` : ''}
      <section class="card"><h2>ترتيب الطلاب</h2>${lb.individuals.length ? table(['#', 'الطالب', 'الدرجة', 'الوقت'],
        lb.individuals.map((s) => [medal(s.rank), esc(s.student) + (me && s.student.includes(me) ? ' ⭐' : ''), `<b>${s.score}/${s.total_questions}</b>`, fmtDuration(s.duration_seconds)])) : empty('لم يسلّم أحد بعد')}</section>
      ${review}
      ${c.status !== 'finished' && c.my_submitted_at ? '<p class="muted center">ستظهر الإجابات الصحيحة بعد انتهاء المسابقة.</p>' : ''}`;
  };

  if (c.my_submitted_at || c.status !== 'active' || State.user.role === 'admin') return showBoard();

  el.innerHTML = `<div class="card center">
    <h1>${esc(c.title)}</h1><p class="muted">${esc(LABELS.compType[c.type])}</p>
    <p>${c.question_count} سؤال · ${c.duration_minutes} دقيقة من وقت البدء · تنتهي ${fmtDate(c.ends_at)}</p>
    <p class="muted">التسليم مرة واحدة فقط. إذا انتهى الوقت فستُسلَّم الإجابات تلقائيًا.</p>
    <button class="btn primary" data-action="start">ابدأ الآن</button></div>`;

  onAction(el, {
    start: (b) => run(b, async () => {
      let entry;
      try {
        entry = await API.post(`/competitions/${id}/start`);
      } catch (err) {
        if (isSubError(err)) return subscriptionWall(el, err);
        if (err.code === 'TEAM_REQUIRED') {
          el.innerHTML = `<div class="card center"><h2>${esc(err.message)}</h2><a class="btn primary" href="#/team">صفحة الفريق</a></div>`;
          return undefined;
        }
        if (err.code === 'TIME_UP') {
          // Time ran out while the student was away: the server already submitted the saved answers.
          c.my_submitted_at = new Date().toISOString();
          toast(err.message, 'warn');
          await showBoard();
          return undefined;
        }
        throw err;
      }
      const key = `comp-${entry.entry_id}`;
      let local = {};
      try { local = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { local = {}; }
      // Answers saved on the server (e.g. from another device) + anything newer in this tab.
      const saved = { ...entry.saved_answers, ...local };

      el.innerHTML = `<div class="timer-bar"><div class="timer-row"><span>${esc(c.title)}</span><b id="timer">--:--</b><span id="answered"></span><span id="sync" class="sync"></span></div>
          <nav class="qnav" aria-label="أرقام الأسئلة">${entry.questions.map((q) => `<a href="#" data-goto="${q.question_id}" class="${saved[q.question_id] ? 'done' : ''}">${q.number}</a>`).join('')}</nav></div>
        <form id="cf">${entry.questions.map((q, i) => `${q.passage && entry.questions[i - 1]?.passage?.id !== q.passage.id
          ? (isLongPassage(q.passage)
            ? `<div class="passage-group split">${passageBox(q.passage, passageRange(entry.questions, i), { side: true })}<div class="pg-qs">`
            : `<div class="passage-group"><div class="pg-qs">${passageBox(q.passage, passageRange(entry.questions, i))}`) : ''}<div class="card qcard" id="cq-${q.question_id}">
          <div class="q-meta"><span>سؤال ${q.number}</span><span class="unanswered-tag">لم تُجب بعد</span></div>${q.question ? `<h2 class="q-text">${rich(q.question)}</h2>` : ''}${qImage(q.image, 'صورة السؤال')}
          <div class="options">${q.options.map((o) => `<label class="option radio"><input type="radio" name="q${q.question_id}" value="${o.key}" ${saved[q.question_id] === o.key ? 'checked' : ''}><span class="opt-body">${o.text ? `<span>${rich(o.text)}</span>` : ''}${optImage(o.image, 'اختيار')}</span></label>`).join('')}</div>
        </div>${q.passage && entry.questions[i + 1]?.passage?.id !== q.passage.id ? '</div></div>' : ''}`).join('')}
        <button class="btn primary block" type="submit">تسليم الإجابات</button></form>`;

      const form = $('#cf', el);
      const answers = () => entry.questions.map((q) => ({ question_id: q.question_id, choice: form[`q${q.question_id}`].value || null }));
      const unanswered = () => entry.questions.filter((q) => !form[`q${q.question_id}`].value);
      const updateCount = () => {
        $('#answered', el).textContent = `${entry.questions.length - unanswered().length}/${entry.questions.length} مُجاب`;
        for (const q of entry.questions) {
          const done = Boolean(form[`q${q.question_id}`].value);
          $(`[data-goto="${q.question_id}"]`, el).classList.toggle('done', done);
          $(`#cq-${q.question_id}`, el).classList.toggle('answered', done);
        }
      };
      const goTo = (qid) => {
        const card = $(`#cq-${qid}`, el);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 1200);
      };
      // Autosave to the server shortly after each change, so nothing is lost if the tab closes or the connection drops.
      let syncTimer = null;
      const sync = $('#sync', el);
      const pushDraft = async () => {
        try {
          await API.req('PUT', `/competitions/${id}/answers`, { answers: answers() });
          sync.textContent = '✓ تم الحفظ';
          sync.className = 'sync ok';
        } catch {
          sync.textContent = '⚠ لم يُحفظ — تأكد من الاتصال بالإنترنت';
          sync.className = 'sync bad';
        }
      };
      form.addEventListener('change', (e) => {
        saved[e.target.name.slice(1)] = e.target.value;
        sessionStorage.setItem(key, JSON.stringify(saved));
        updateCount();
        sync.textContent = '…';
        sync.className = 'sync';
        clearTimeout(syncTimer);
        syncTimer = setTimeout(pushDraft, 1200);
      });
      Cleanup.push(() => clearTimeout(syncTimer));
      $('.qnav', el).addEventListener('click', (e) => {
        const a = e.target.closest('[data-goto]');
        if (!a) return;
        e.preventDefault();
        goTo(a.dataset.goto);
      });
      updateCount();

      let submitting = false;
      const submit = async () => {
        if (submitting) return;
        submitting = true;
        clearInterval(compTimer);
        closeModal();
        try {
          const r = await API.post(`/competitions/${id}/submit`, { answers: answers() });
          sessionStorage.removeItem(key);
          c.my_submitted_at = r.submitted_at;
          if (r.results_hidden) {
            toast('تم التسليم بنجاح ✅');
            await showBoard();
            return;
          }
          toast(`تم التسليم — درجتك ${r.score}/${r.total_questions}`);
          await showBoard();
          el.insertAdjacentHTML('afterbegin', `<div class="card center"><h2>درجتك</h2><div class="big ${percentTone(r.percent)}">${r.score}/${r.total_questions}</div>
            <div class="score-split"><span class="good">✅ صحيحة: ${r.correct}</span><span class="bad">❌ خاطئة: ${r.wrong}</span><span class="mid">⏭ متروك: ${r.skipped}</span></div>
            ${r.skipped ? '<p class="muted">الأسئلة المتروكة لا تُحتسب خطأً وليست في بنك الأخطاء.</p>' : ''}</div>`);
        } catch (err) {
          submitting = false;
          toast(errorText(err), 'err');
        }
      };
      // Before submitting: warn about unanswered questions, list them and let the student jump back.
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const left = unanswered();
        if (!left.length) { submit(); return; }
        form.classList.add('show-missing');
        const m = modal(`<h2>⚠️ يوجد ${left.length} سؤال لم تُجب عنها</h2>
          <p class="muted">اضغط على رقم السؤال للعودة إليه:</p>
          <div class="qnav big-nav">${left.map((q) => `<a href="#" data-jump="${q.question_id}">${q.number}</a>`).join('')}</div>
          <p class="notice mid">إذا سلّمت الآن، فهذه الأسئلة <b>لن تُحتسب خطأً</b> ولن تُضاف إلى بنك الأخطاء — لكنك لن تحصل على درجتها.</p>
          <div class="row wrap"><button class="btn primary" data-back>ارجع وأكمل</button><button class="btn ghost" data-force>سلّم كما هي</button></div>`);
        $('[data-back]', m).addEventListener('click', () => { closeModal(); goTo(left[0].question_id); });
        $('[data-force]', m).addEventListener('click', submit);
        $('.qnav', m).addEventListener('click', (ev) => {
          const a = ev.target.closest('[data-jump]');
          if (!a) return;
          ev.preventDefault();
          closeModal();
          goTo(a.dataset.jump);
        });
      });

      let warnedLastMinute = false;
      const deadline = new Date(entry.deadline_at).getTime();
      const tick = () => {
        const s = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        const t = $('#timer', el);
        if (!t) return clearInterval(compTimer);
        t.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        t.classList.toggle('bad', s < 60);
        if (s <= 60 && !warnedLastMinute) {
          warnedLastMinute = true;
          const left = unanswered().length;
          if (left) {
            toast(`⏰ بقيت دقيقة — ويوجد ${left} سؤال بلا إجابة`, 'warn');
            form.classList.add('show-missing');
          }
        }
        if (s === 0) submit();
        return undefined;
      };
      tick();
      compTimer = setInterval(tick, 1000);
      return undefined;
    }),
  });
};

const letterAr = (L) => `(${'أبجد'['ABCD'.indexOf(L)]})`;
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
  const received = invites.length ? `<section class="card"><h2>دعوات وصلتك</h2><ul class="list">${invites.map((i) => `<li>
      <span><b>${esc(i.team)}</b> <small class="muted">من ${esc(i.invited_by)} (${esc(i.invited_by_code)}) · ${i.team_size}/4</small></span>
      <span class="row"><button class="btn primary tiny" data-action="accept" data-id="${i.id}">قبول</button>
      <button class="btn ghost tiny" data-action="decline" data-id="${i.id}">رفض</button></span></li>`).join('')}</ul></section>` : '';

  if (!team) {
    el.innerHTML = `<h1 class="page-head">الفريق</h1>${received}
      <section class="card"><h2>أنشئ فريقًا جديدًا</h2>
        <form id="cf" class="form inline"><input name="name" required minlength="2" placeholder="اسم الفريق"><button class="btn primary" type="submit">إنشاء</button></form>
        <p class="muted">يتكون الفريق من 4 طلاب. بعد إنشائه ادعُ أصدقاءك بكود الطالب الخاص بهم.<br>
        إذا لم تكن في فريق يوم الخميس، فسيضمّك النظام تلقائيًا إلى فريق قبل مسابقة الجمعة.</p></section>`;
  } else {
    el.innerHTML = `<div class="page-head"><h1>${esc(team.name)}</h1>${badge(`${team.size}/${team.max_size}`, team.size === 4 ? 'good' : 'mid')}${team.is_auto_generated ? badge('توزيع تلقائي') : ''}</div>
      ${received}
      <section class="card"><h2>الأعضاء</h2><ul class="list">${team.members.map((m) => `<li>
        <span>${m.is_captain ? '👑 ' : ''}<b>${esc(m.full_name)}</b> <small class="mono muted">${esc(m.student_code)}</small></span>
        ${isCaptain && m.id !== myId ? `<button class="btn ghost tiny" data-action="kick" data-id="${m.id}">إزالة</button>` : ''}</li>`).join('')}</ul>
      </section>
      ${isCaptain ? `<section class="card"><h2>دعوة عضو</h2>
        ${team.size < 4 ? `<form id="inv" class="form inline"><input name="student_code" required placeholder="STU-2026-0002" class="mono"><button class="btn primary" type="submit">إرسال دعوة</button></form>` : '<p class="good">الفريق مكتمل ✅</p>'}
        ${team.pending_invites.length ? `<h3>دعوات في الانتظار</h3><ul class="list">${team.pending_invites.map((p) => `<li><span>${esc(p.full_name)} <small class="mono muted">${esc(p.student_code)}</small></span>
          <button class="btn ghost tiny" data-action="cancel" data-id="${p.id}">إلغاء</button></li>`).join('')}</ul>` : ''}
        <label class="check"><input type="checkbox" id="autofill" ${team.allow_auto_fill ? 'checked' : ''}> اسمح للنظام بإكمال الفريق بطلاب عشوائيين قبل مسابقة الجمعة</label>
      </section>` : ''}
      <button class="btn danger" data-action="leave">الخروج من الفريق</button>`;
  }
  const reload = () => Views.team(el);
  if ($('#cf', el)) onSubmit($('#cf', el), async (v) => { await API.post('/teams', v); toast('تم إنشاء الفريق'); reload(); });
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
    leave: (b) => run(b, async () => { if (confirm('هل أنت متأكد أنك تريد الخروج من الفريق؟')) { await API.post('/teams/leave'); toast('خرجت من الفريق'); reload(); } }),
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
        <button class="btn ghost tiny" data-action="del" data-id="${t.id}" aria-label="حذف">🗑</button></span></li>`).join('')}</ul>` : empty('لا توجد مهام لهذا اليوم.')}
    </section>
    <section class="card"><h2>إضافة مهمة</h2>
      <form id="tf" class="form grid3">
        <label class="span3">المهمة<input name="title" required maxlength="200" placeholder="مثلًا: حل 20 سؤالًا على قوانين نيوتن"></label>
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
Views.subscribe = async (el, params = {}, query = {}) => {
  const [{ plans, gateways = {}, manual_payment: mp }, mine] = await Promise.all([API.get('/payments/plans'), API.get('/payments/me')]);
  const cur = mine.current;
  // Back from the card payment page (?paid=<reference>): show how that payment ended.
  const back = query.paid ? mine.payments.find((p) => p.reference === query.paid) : null;
  const backNotice = !query.paid ? ''
    : back?.status === 'paid' ? '<div class="notice good">✅ تم الدفع بنجاح وتفعيل اشتراكك.</div>'
    : back && ['failed', 'rejected'].includes(back.status) ? '<div class="notice bad">❌ لم تكتمل عملية الدفع. يمكنك المحاولة مرة أخرى.</div>'
    : '<div class="notice mid" id="pay-wait">⏳ جارٍ تأكيد الدفع من البنك… ستتحدث الصفحة تلقائيًا خلال ثوانٍ.</div>';
  el.innerHTML = `<h1 class="page-head">الاشتراك</h1>${backNotice}
    ${cur ? `<div class="notice good">اشتراكك الحالي: <b>${esc(cur.name_ar)}</b> — ساري حتى ${fmtDay(cur.ends_at)}. يُضاف التجديد إلى المدة.</div>` : ''}
    <div class="grid-cards plans">${plans.map((p) => `<div class="card plan ${p.code === 'premium' ? 'featured' : ''}">
      ${p.code === 'premium' ? '<span class="ribbon">الأكثر قيمة</span>' : ''}
      <h2>${esc(p.name_ar)}</h2>
      <div class="price">${Number(p.price_egp)} <small>جنيه / ${p.duration_days} يوم</small></div>
      <ul class="features">${Object.entries(LABELS.feature).map(([k, label]) => `<li class="${p.features[k] ? '' : 'off'}">${p.features[k] ? '✓' : '✕'} ${esc(label)}</li>`).join('')}</ul>
      <div class="col">
        ${gateways.paymob ? `<button class="btn primary" data-action="pay" data-plan="${p.code}" data-provider="paymob">ادفع بالكارت / المحفظة</button>` : ''}
        ${gateways.fawry ? `<button class="btn ghost" data-action="pay" data-plan="${p.code}" data-provider="fawry">ادفع بفوري</button>` : ''}
        ${!gateways.paymob && !gateways.fawry ? `<button class="btn primary" data-action="toManual" data-plan="${p.code}">ادفع بمحفظة إلكترونية / إنستاباي ↓</button>` : ''}
      </div>
    </div>`).join('')}</div>

    <section class="card manual-pay"><h2>الدفع بمحفظة إلكترونية أو إنستاباي</h2>
      <form id="mf" class="form">
        <div class="pay-step"><span class="step-no">1</span><div class="step-body"><b>اختر الباقة</b>
          <select name="plan_code">${plans.map((p) => `<option value="${p.code}" data-price="${Number(p.price_egp)}">باقة ${esc(p.name_ar)}\u200F — ${Number(p.price_egp)} جنيه</option>`).join('')}</select>
          <div class="pay-amount">المبلغ المطلوب: <b id="pay-amount"></b></div></div></div>

        <div class="pay-step"><span class="step-no">2</span><div class="step-body"><b>حوّل المبلغ إلى إحدى هذه الوسائل</b> <small class="muted">(اضغط على الوسيلة التي ستحوّل إليها)</small>
          <div class="pay-methods">
            ${mp.vodafone_cash ? `<label class="pay-method vodafone"><input type="radio" name="provider" value="vodafone_cash" checked>
              <span class="pm-title">محفظة إلكترونية</span>
              <span class="pm-logos" aria-label="فودافون كاش، اتصالات كاش، أورانج كاش">${PAY_LOGOS.vodafone}${PAY_LOGOS.etisalat}${PAY_LOGOS.orange}</span>
              <span class="pm-value mono">${esc(mp.vodafone_cash)}</span>
              <button class="btn ghost tiny" type="button" data-action="copy" data-copy="${esc(mp.vodafone_cash)}">نسخ الرقم</button></label>` : ''}
            ${mp.instapay ? `<label class="pay-method instapay"><input type="radio" name="provider" value="instapay" ${mp.vodafone_cash ? '' : 'checked'}>
              <span class="pm-title">${PAY_LOGOS.instapay} إنستاباي</span>
              <span class="pm-value mono">${esc(mp.instapay)}</span>
              <button class="btn ghost tiny" type="button" data-action="copy" data-copy="${esc(mp.instapay)}">نسخ العنوان</button></label>` : ''}
          </div>
          ${mp.instructions ? `<p class="muted small">${esc(mp.instructions)}</p>` : ''}</div></div>

        <div class="pay-step"><span class="step-no">3</span><div class="step-body"><b>ارفع صورة الإيصال</b>
          <div class="grid2">
            <label><span id="sender-label">الرقم الذي حوّلت منه</span><input name="sender_account" required minlength="5" dir="ltr"></label>
            <label>رقم العملية (من الإيصال)<input name="transfer_ref" dir="ltr"></label>
            <label class="span2">صورة الإيصال (سكرين شوت)<input type="file" name="receipt" accept="image/png,image/jpeg,image/webp,application/pdf" required></label>
          </div>
          <button class="btn primary" type="submit">رفع الإيصال للمراجعة</button>
          <p class="muted small">تراجع الإدارة الإيصال وتفعّل اشتراكك، وستجد الحالة بالأسفل في «مدفوعاتي».</p></div></div>
      </form></section>

    <section class="card"><h2>مدفوعاتي</h2>${mine.payments.length ? table(['التاريخ', 'الباقة', 'المبلغ', 'الطريقة', 'الحالة'],
      mine.payments.map((p) => [fmtDate(p.created_at), esc(p.plan_code), fmtMoney(p.amount_egp), esc(LABELS.provider[p.provider]),
        badge(LABELS.paymentStatus[p.status], LABELS.paymentTone[p.status]) + (p.admin_note && p.status === 'rejected' ? `<br><small>${esc(p.admin_note)}</small>` : '')])) : empty('لا توجد مدفوعات بعد')}</section>`;

  const reload = () => Views.subscribe(el);
  onAction(el, {
    toManual: (b) => {
      const sel = $('#mf [name=plan_code]', el);
      sel.value = b.dataset.plan; showAmount();
      $('#mf', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    copy: (b) => navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('تم النسخ ✓')),
    pay: (b) => run(b, async () => {
      const r = await API.post('/payments/checkout', { plan_code: b.dataset.plan, provider: b.dataset.provider });
      if (r.checkout_url) { location.href = r.checkout_url; return; }
      if (r.fawry_reference) {
        modal(`<h2>ادفع في أي فرع فوري</h2><p>الرقم المرجعي:</p><div class="big mono">${esc(r.fawry_reference)}</div>
          <p class="muted">المبلغ: ${fmtMoney(r.payment.amount_egp)} — سيُفعَّل الاشتراك تلقائيًا بعد الدفع.</p>`);
        return;
      }
      const m = modal(`<h2>وضع تجريبي</h2><p>مفاتيح ${esc(LABELS.provider[r.provider])} لم تُضف بعد، لذا هذا دفع تجريبي.</p>
        <p class="muted">في التشغيل الفعلي ستنتقل إلى صفحة الدفع، ويُفعَّل الاشتراك تلقائيًا عن طريق الـ Webhook.</p>
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
  const showAmount = () => {
    const opt = $('#mf [name=plan_code]', el).selectedOptions[0];
    $('#pay-amount', el).textContent = opt ? `${opt.dataset.price} جنيه` : '';
  };
  $('#mf [name=plan_code]', el).addEventListener('change', showAmount);
  showAmount();
  if (query.paid && (!back || back.status === 'pending')) {
    const tries = Number(sessionStorage.getItem('payWait') || 0);
    if (tries < 10) {
      sessionStorage.setItem('payWait', tries + 1);
      setTimeout(() => { if (location.hash.startsWith('#/subscribe')) Views.subscribe(el, params, query); }, 4000);
    } else {
      $('#pay-wait', el)?.replaceChildren('⏳ لم يصل تأكيد الدفع بعد. إذا خُصم المبلغ فسيُفعَّل اشتراكك تلقائيًا خلال دقائق، ويمكنك تحديث الصفحة لاحقًا.');
    }
  } else sessionStorage.removeItem('payWait');
  // "From" field follows the chosen method: a Vodafone Cash number, or an InstaPay account.
  const showSender = () => {
    const insta = $('#mf [name=provider]:checked', el)?.value === 'instapay';
    const input = $('#mf [name=sender_account]', el);
    $('#sender-label', el).textContent = insta ? 'حساب إنستاباي الذي حوّلت منه' : 'رقم المحفظة التي حوّلت منها';
    input.placeholder = insta ? 'name@instapay' : '01xxxxxxxxx';
    input.inputMode = insta ? 'email' : 'numeric';
    if (insta) input.removeAttribute('pattern');
    else { input.pattern = '0?1[0125][0-9]{8}'; input.title = 'رقم موبايل مصري، مثال: 01012345678'; }
  };
  $$('#mf [name=provider]', el).forEach((r) => r.addEventListener('change', showSender));
  showSender();
  onSubmit($('#mf', el), async (v, form) => {
    if (!v.provider) throw new Error('اختر هل حوّلت إلى المحفظة الإلكترونية أم إنستاباي');
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
    </div>`).join('')}</div>` : empty('لا توجد عروض حاليًا')}`;
};

// ---------------------------------------------------------------- Parent report
Views.report = async (el) => {
  const [{ text }, { reports }] = await Promise.all([API.get('/reports/parent/preview'), API.get('/reports/parent/history')]);
  el.innerHTML = `<h1 class="page-head">تقرير ولي الأمر</h1>
    <section class="card"><h2>التقرير الأسبوعي</h2>
      <pre class="report">${esc(text)}</pre>
      <p class="muted">هذا ما يراه ولي أمرك — والإدارة هي التي ترسله.</p></section>
    <section class="card"><h2>التقارير المرسلة</h2>${reports.length ? table(['التاريخ', 'الفترة', 'الطريقة', 'الحالة'],
      reports.map((r) => [fmtDate(r.sent_at), `${esc(r.period_start.slice(0, 10))} ← ${esc(r.period_end.slice(0, 10))}`, esc({ email: 'إيميل', sms: 'رسالة', log: 'تجريبي' }[r.channel]), badge(r.status === 'sent' ? 'تم' : 'فشل', r.status === 'sent' ? 'good' : 'bad')])) : empty('لم تُرسل تقارير بعد')}</section>`;
};
