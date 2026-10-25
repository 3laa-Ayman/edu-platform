/* Admin views. */
const Admin = {};

Admin.dashboard = async (el) => {
  const d = await API.get('/admin/dashboard');
  const tiles = [
    ['الطلاب', d.students, `${d.verified_students} مفعّل`],
    ['المشتركين حالياً', d.active_subscribers, ''],
    ['الإيرادات', fmtMoney(d.revenue_egp), 'مدفوعات مؤكدة'],
    ['إيصالات للمراجعة', d.receipts_pending_review, '', '#/admin/payments'],
    ['الأسئلة', d.questions, '', '#/admin/questions'],
    ['تكلفة الذكاء الاصطناعي', fmtMoney(d.ai_cost_egp), `${d.students_at_ai_limit} طالب عند الحد`],
    ['التيمات', d.teams, ''],
  ];
  el.innerHTML = `<h1 class="page-head">لوحة التحكم</h1>
    <section class="tiles">${tiles.map(([l, v, s, href]) => `<${href ? `a href="${href}"` : 'div'} class="tile"><span class="tile-label">${l}</span><b>${esc(v)}</b><small>${esc(s)}</small></${href ? 'a' : 'div'}>`).join('')}</section>
    <section class="card"><h2>إجراءات سريعة</h2><div class="row wrap">
      <a class="btn primary" href="#/admin/questions">رفع أسئلة Excel</a>
      <a class="btn ghost" href="#/admin/payments">مراجعة الإيصالات</a>
      <a class="btn ghost" href="#/admin/competitions">إنشاء مسابقة</a>
      <button class="btn ghost" data-action="reports">إرسال تقارير أولياء الأمور الآن</button></div></section>`;
  onAction(el, {
    reports: (b) => run(b, async () => {
      const r = await API.post('/admin/reports/send-weekly');
      toast(`تم: ${r.sent} تقرير، فشل ${r.failed}`);
    }),
  });
};

Admin.questions = async (el, params, query) => {
  const search = query.search || '';
  const missing = query.missing === '1';
  const page = Number(query.page || 1);
  const qs = new URLSearchParams({ page: String(page), limit: '20' });
  if (search) qs.set('search', search);
  if (missing) qs.set('missing_explanation', 'true');
  const list = await API.get(`/admin/questions?${qs}`);

  el.innerHTML = `<h1 class="page-head">بنك الأسئلة</h1>
    <section class="card"><div class="card-head"><h2>رفع شيت Excel</h2><button class="btn ghost tiny" data-action="template">⬇ تحميل النموذج</button></div>
      <p class="muted">الأعمدة: السؤال · أ · ب · ج · د · الإجابة الصحيحة · الشرح · القانون/الملحوظة · المادة · الدرس · نوع الدرس · التصنيف (درس / امتحان سابق) · سنة الامتحان</p>
      <form id="uf" class="form grid3">
        <label class="span2">ملف .xlsx<input type="file" name="file" accept=".xlsx" required></label>
        <label>مادة افتراضية (لو مفيش عمود مادة)<input name="default_subject"></label>
        <label class="check"><input type="checkbox" name="dry_run"> فحص فقط بدون حفظ</label>
        <button class="btn primary" type="submit">رفع</button>
      </form>
      <div id="result"></div>
    </section>
    <section class="card"><div class="card-head"><h2>الأسئلة ${badge(list.total)}</h2></div>
      <form id="sf" class="form inline">
        <input name="search" value="${esc(search)}" placeholder="بحث في نص السؤال">
        <label class="check"><input type="checkbox" name="missing" ${missing ? 'checked' : ''}> بدون شرح فقط</label>
        <button class="btn ghost" type="submit">بحث</button>
      </form>
      ${list.items.length ? table(['#', 'السؤال', 'المادة / الدرس', 'التصنيف', 'الإجابة', 'الشرح', ''],
        list.items.map((q) => [q.id, esc(q.question_text.length > 70 ? `${q.question_text.slice(0, 70)}…` : q.question_text),
          `${esc(q.subject)}<br><small class="muted">${esc(q.lesson || '')}</small>`, esc(LABELS.category[q.category]),
          `<b>${'أبجد'['ABCD'.indexOf(q.correct_option)]}</b>`, q.explanation ? '✓' : badge('لا يوجد', 'mid'),
          `<button class="btn ghost tiny" data-action="edit" data-id="${q.id}">تعديل</button>`])) : empty('مفيش أسئلة')}
      <div class="row between">${page > 1 ? `<a class="btn ghost tiny" href="#/admin/questions?${pageQs(query, page - 1)}">السابق</a>` : '<span></span>'}
        ${page * 20 < list.total ? `<a class="btn ghost tiny" href="#/admin/questions?${pageQs(query, page + 1)}">التالي</a>` : ''}</div>
    </section>`;

  onSubmit($('#uf', el), async (v, form) => {
    const fd = new FormData();
    fd.append('file', form.file.files[0]);
    if (v.default_subject) fd.append('default_subject', v.default_subject);
    const res = $('#result', el);
    try {
      const r = await API.upload(`/admin/questions/upload${v.dry_run ? '?dry_run=true' : ''}`, fd);
      const errs = r.errors || [];
      res.innerHTML = `<div class="notice ${errs.length ? 'mid' : 'good'}">${r.dry_run
        ? `فحص: ${r.valid_rows} صف سليم، ${r.failed} صف فيه أخطاء`
        : `تم إضافة <b>${r.inserted}</b> سؤال · مكرر (اتجاهل): ${r.duplicates} · فيه أخطاء: ${r.failed}`}</div>
        ${errs.length ? table(['الصف', 'الأخطاء'], errs.map((e) => [e.row, esc(e.errors.join('، '))])) : ''}`;
      if (!r.dry_run) toast(`تم رفع ${r.inserted} سؤال`);
    } catch (err) {
      const d = err.details;
      res.innerHTML = `<div class="notice bad">${esc(err.message)}${d?.missing_columns ? `: ${esc(d.missing_columns.join('، '))}` : ''}</div>
        ${d?.errors ? table(['الصف', 'الأخطاء'], d.errors.map((e) => [e.row, esc(e.errors.join('، '))])) : ''}`;
    }
  });
  onSubmit($('#sf', el), async (v) => {
    const p = new URLSearchParams();
    if (v.search) p.set('search', v.search);
    if (v.missing) p.set('missing', '1');
    location.hash = `#/admin/questions?${p}`;
  });
  onAction(el, {
    template: (b) => run(b, async () => {
      const blob = await API.blob('/admin/questions/template');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'questions-template.xlsx' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }),
    edit: (b) => {
      const q = list.items.find((x) => String(x.id) === b.dataset.id);
      const m = modal(`<h2>تعديل السؤال #${q.id}</h2><form class="form" id="ef">
        <label>السؤال<textarea name="question_text" rows="3" required>${esc(q.question_text)}</textarea></label>
        <div class="grid2">${['a', 'b', 'c', 'd'].map((k, i) => `<label>${'أبجد'[i]}<input name="option_${k}" required value="${esc(q[`option_${k}`])}"></label>`).join('')}</div>
        <label>الإجابة الصحيحة<select name="correct_option">${['A', 'B', 'C', 'D'].map((k, i) => `<option value="${k}" ${q.correct_option === k ? 'selected' : ''}>${'أبجد'[i]}</option>`).join('')}</select></label>
        <label>الشرح (لو موجود بيظهر للطالب مجاناً بدل الذكاء الاصطناعي)<textarea name="explanation" rows="4">${esc(q.explanation || '')}</textarea></label>
        <label>القانون / الملحوظة<input name="law_note" value="${esc(q.law_note || '')}"></label>
        <label class="check"><input type="checkbox" name="is_active" ${q.is_active ? 'checked' : ''}> السؤال فعّال</label>
        <button class="btn primary" type="submit">حفظ</button></form>`);
      onSubmit($('#ef', m), async (v) => {
        await API.patch(`/admin/questions/${q.id}`, { ...v, explanation: v.explanation ?? null, law_note: v.law_note ?? null });
        closeModal();
        toast('تم الحفظ');
        Admin.questions(el, params, query);
      });
    },
  });
};
const pageQs = (query, page) => new URLSearchParams({ ...query, page: String(page) }).toString();

Admin.payments = async (el, params, query) => {
  const status = query.status || 'under_review';
  const { items } = await API.get(`/admin/payments?status=${status}`);
  const tabs = ['under_review', 'paid', 'rejected', 'pending', 'failed'];
  el.innerHTML = `<h1 class="page-head">المدفوعات</h1>
    <nav class="tabs">${tabs.map((t) => `<a href="#/admin/payments?status=${t}" class="${t === status ? 'active' : ''}">${LABELS.paymentStatus[t]}</a>`).join('')}</nav>
    <section class="card">${items.length ? table(['التاريخ', 'الطالب', 'الباقة', 'المبلغ', 'الطريقة', 'من / رقم العملية', ''],
      items.map((p) => [fmtDate(p.created_at), `${esc(p.full_name)}<br><small class="mono muted">${esc(p.student_code)} · ${esc(p.phone)}</small>`,
        esc(p.plan_code), fmtMoney(p.amount_egp), esc(LABELS.provider[p.provider]),
        `${esc(p.sender_account || '—')}<br><small class="mono">${esc(p.transfer_ref || '')}</small>`,
        `<div class="row">${p.has_receipt ? `<button class="btn ghost tiny" data-action="receipt" data-id="${p.id}">الإيصال</button>` : ''}
        ${p.status === 'under_review' ? `<button class="btn primary tiny" data-action="approve" data-id="${p.id}">قبول</button>
          <button class="btn danger tiny" data-action="reject" data-id="${p.id}">رفض</button>` : esc(p.admin_note || '')}</div>`]))
      : empty('مفيش عمليات هنا')}</section>`;
  const reload = () => Admin.payments(el, params, query);
  onAction(el, {
    receipt: (b) => run(b, async () => {
      const blob = await API.blob(`/admin/payments/${b.dataset.id}/receipt`);
      const url = URL.createObjectURL(blob);
      modal(blob.type === 'application/pdf'
        ? `<h2>الإيصال</h2><a class="btn primary" href="${url}" target="_blank" rel="noopener">فتح ملف PDF</a>`
        : `<h2>الإيصال</h2><img class="receipt" src="${url}" alt="صورة الإيصال">`);
    }),
    approve: (b) => run(b, async () => {
      if (!confirm('تأكيد قبول الإيصال وتفعيل الاشتراك؟')) return;
      await API.post(`/admin/payments/${b.dataset.id}/approve`, {});
      toast('تم تفعيل الاشتراك');
      reload();
    }),
    reject: (b) => {
      const m = modal(`<h2>رفض الإيصال</h2><form class="form" id="rf"><label>السبب (هيظهر للطالب)<input name="note" required minlength="3" value="الإيصال غير واضح أو المبلغ غير مطابق"></label>
        <button class="btn danger" type="submit">رفض</button></form>`);
      onSubmit($('#rf', m), async (v) => {
        await API.post(`/admin/payments/${b.dataset.id}/reject`, v);
        closeModal();
        toast('تم الرفض');
        reload();
      });
    },
  });
};

Admin.competitions = async (el) => {
  const [{ competitions }, { subjects }] = await Promise.all([API.get('/competitions'), API.get('/catalog/subjects')]);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const now = new Date();
  el.innerHTML = `<h1 class="page-head">المسابقات والتيمات</h1>
    <section class="card"><h2>مسابقة جديدة</h2>
      <form id="cf" class="form grid3">
        <label class="span2">العنوان<input name="title" required value="مسابقة الجمعة"></label>
        <label>النوع<select name="type"><option value="team_weekly">تيمات (أسبوعية)</option><option value="individual_monthly">فردية (شهرية)</option></select></label>
        <label>تبدأ<input type="datetime-local" name="starts_at" required value="${local(now)}"></label>
        <label>تنتهي<input type="datetime-local" name="ends_at" required value="${local(new Date(now.getTime() + 2 * 3600000))}"></label>
        <label>مدة الحل (دقيقة)<input type="number" name="duration_minutes" min="1" max="600" value="30"></label>
        <label>عدد الأسئلة (عشوائي)<input type="number" name="count" min="1" max="200" value="10"></label>
        <label>المادة<select name="subject_id"><option value="">كل المواد</option>${subjects.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.questions})</option>`).join('')}</select></label>
        <label>التصنيف<select name="category"><option value="">الكل</option><option value="lesson">دروس</option><option value="past_exam">امتحانات سابقة</option></select></label>
        <button class="btn primary span3" type="submit">إنشاء المسابقة</button>
      </form></section>
    <section class="card"><h2>توزيع الطلاب بدون تيم</h2>
      <p class="muted">بيشتغل تلقائياً كل خميس 9 مساءً. بيكمّل التيمات الناقصة الأول، وبعدين يقسم الباقي لتيمات متوازنة (4 أو 3).</p>
      <div class="row wrap"><label class="check"><input type="checkbox" id="reqsub" checked> المشتركين فقط</label>
      <button class="btn primary" data-action="assign">وزّع الآن</button></div><div id="assign-result"></div></section>
    <section class="card"><h2>كل المسابقات</h2>${competitions.length ? table(['المسابقة', 'النوع', 'الوقت', 'الحالة', ''],
      competitions.map((c) => [esc(c.title), esc(LABELS.compType[c.type]), `${fmtDate(c.starts_at)}<br><small class="muted">${fmtDate(c.ends_at)}</small>`,
        badge(LABELS.compStatus[c.status], LABELS.compTone[c.status]), `<a class="btn ghost tiny" href="#/competition/${c.id}">الترتيب</a>`])) : empty('مفيش مسابقات')}</section>`;

  onSubmit($('#cf', el), async (v) => {
    const r = await API.post('/admin/competitions', {
      title: v.title, type: v.type,
      starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(),
      duration_minutes: Number(v.duration_minutes),
      random: { count: Number(v.count), subject_id: v.subject_id ? Number(v.subject_id) : undefined, category: v.category },
    });
    toast(`تم إنشاء المسابقة بـ ${r.competition.question_count} سؤال`);
    Admin.competitions(el);
  });
  onAction(el, {
    assign: (b) => run(b, async () => {
      const r = await API.post('/admin/teams/auto-assign', { require_subscription: $('#reqsub', el).checked });
      $('#assign-result', el).innerHTML = `<div class="notice good">طلاب بدون تيم: ${r.eligible} · اتضافوا لتيمات ناقصة: ${r.added_to_existing} · تيمات جديدة: ${r.new_teams.length}
        ${r.new_teams.length ? `<br>${r.new_teams.map((t) => `${esc(t.name)} (${t.size})`).join(' · ')}` : ''}</div>`;
    }),
  });
};

Admin.students = async (el, params, query) => {
  const search = query.search || '';
  const { items } = await API.get(`/admin/students?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  el.innerHTML = `<h1 class="page-head">الطلاب</h1>
    <section class="card"><form id="sf" class="form inline"><input name="search" value="${esc(search)}" placeholder="كود الطالب، الإيميل أو الاسم"><button class="btn ghost" type="submit">بحث</button></form>
    ${items.length ? table(['الكود', 'الاسم', 'التواصل', 'استهلاك AI', 'الحالة', ''],
      items.map((s) => [`<span class="mono">${esc(s.student_code)}</span>`, esc(s.full_name),
        `${esc(s.email)}<br><small class="muted">طالب ${esc(s.phone)} · ولي أمر ${esc(s.parent_phone)}</small>`,
        `${fmtMoney(s.ai_spent_egp)} / ${fmtMoney(s.ai_limit_egp)}${bar((s.ai_spent_egp / (s.ai_limit_egp || 1)) * 100, s.ai_spent_egp >= s.ai_limit_egp * 0.8 ? 'bad' : 'good')}`,
        `${s.is_verified ? badge('مفعّل', 'good') : badge('غير مفعّل', 'mid')} ${s.is_active ? '' : badge('موقوف', 'bad')}`,
        `<div class="row"><button class="btn ghost tiny" data-action="ai" data-id="${s.id}" data-limit="${s.ai_limit_egp}">حد AI</button>
          <button class="btn ${s.is_active ? 'danger' : 'primary'} tiny" data-action="toggle" data-id="${s.id}" data-active="${s.is_active}">${s.is_active ? 'إيقاف' : 'تفعيل'}</button></div>`])) : empty('مفيش طلاب')}
    </section>`;
  const reload = () => Admin.students(el, params, query);
  onSubmit($('#sf', el), async (v) => { location.hash = `#/admin/students${v.search ? `?search=${encodeURIComponent(v.search)}` : ''}`; });
  onAction(el, {
    ai: (b) => {
      const m = modal(`<h2>حد استهلاك الذكاء الاصطناعي</h2><form class="form" id="af">
        <label>الحد الأقصى (جنيه)<input type="number" name="ai_limit_egp" min="0" max="10000" step="0.5" value="${esc(b.dataset.limit)}"></label>
        <label class="check"><input type="checkbox" name="reset_ai_spent"> تصفير الاستهلاك الحالي</label>
        <button class="btn primary" type="submit">حفظ</button></form>`);
      onSubmit($('#af', m), async (v) => {
        await API.patch(`/admin/students/${b.dataset.id}`, { ai_limit_egp: Number(v.ai_limit_egp), reset_ai_spent: v.reset_ai_spent });
        closeModal();
        toast('تم الحفظ');
        reload();
      });
    },
    toggle: (b) => run(b, async () => {
      const active = b.dataset.active === 'true';
      if (active && !confirm('إيقاف الحساب هيسجّل خروجه من كل الأجهزة. متأكد؟')) return;
      await API.patch(`/admin/students/${b.dataset.id}`, { is_active: !active });
      reload();
    }),
  });
};

Admin.products = async (el) => {
  const { products } = await API.get('/products');
  el.innerHTML = `<h1 class="page-head">المنتجات والخصومات</h1>
    <section class="card"><h2>منتج جديد</h2><form id="pf" class="form grid3">
      <label class="span2">الاسم<input name="title" required></label>
      <label>التصنيف<input name="category" placeholder="كتب، أدوات…"></label>
      <label class="span3">الوصف<input name="description"></label>
      <label>السعر الأصلي<input type="number" name="original_price" min="0" step="0.01" required></label>
      <label>نسبة الخصم %<input type="number" name="discount_percent" min="0" max="100" value="10"></label>
      <label>كود الخصم<input name="coupon_code"></label>
      <label class="span3">رابط الشراء<input type="url" name="external_url" placeholder="https://"></label>
      <button class="btn primary span3" type="submit">إضافة</button></form></section>
    <section class="card">${products.length ? table(['المنتج', 'السعر', 'الخصم', 'بعد الخصم', 'الكود', ''],
      products.map((p) => [esc(p.title), fmtMoney(p.original_price), `${p.discount_percent}%`, `<b>${fmtMoney(p.final_price)}</b>`, esc(p.coupon_code || '—'),
        `<button class="btn danger tiny" data-action="del" data-id="${p.id}">حذف</button>`])) : empty('مفيش منتجات')}</section>`;
  onSubmit($('#pf', el), async (v) => {
    await API.post('/admin/products', {
      ...v, original_price: Number(v.original_price), discount_percent: Number(v.discount_percent || 0),
    });
    toast('تمت الإضافة');
    Admin.products(el);
  });
  onAction(el, {
    del: (b) => run(b, async () => { if (confirm('حذف المنتج؟')) { await API.del(`/admin/products/${b.dataset.id}`); Admin.products(el); } }),
  });
};
