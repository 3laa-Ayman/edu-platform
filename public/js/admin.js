/* Admin views — full management of the platform from the dashboard. */
const Admin = {};

const opt = (value, label, selected) => `<option value="${esc(value)}" ${String(selected ?? '') === String(value) ? 'selected' : ''}>${esc(label)}</option>`;
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
const letter = (L) => 'أبجد'['ABCD'.indexOf(L)] || L;
const pageQs = (query, page) => new URLSearchParams({ ...query, page: String(page) }).toString();
const toLocalInput = (d) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

// ---------------------------------------------------------------- Dashboard
Admin.dashboard = async (el) => {
  const d = await API.get('/admin/dashboard');
  const tiles = [
    ['الطلاب', d.students, d.pending_registrations ? `${d.pending_registrations} لم يكملوا التسجيل` : '', '#/admin/students'],
    ['المشتركين حالياً', d.active_subscribers, '', '#/admin/students'],
    ['الإيرادات', fmtMoney(d.revenue_egp), 'مدفوعات مؤكدة', '#/admin/payments?status=paid'],
    ['إيصالات للمراجعة', d.receipts_pending_review, '', '#/admin/payments'],
    ['الأسئلة', d.questions, '', '#/admin/questions'],
    ['تكلفة الذكاء الاصطناعي', fmtMoney(d.ai_cost_egp, 3), `${d.students_at_ai_limit} طالب عند الحد`, '#/admin/settings'],
    ['التيمات', d.teams, '', '#/admin/teams'],
  ];
  el.innerHTML = `<h1 class="page-head">لوحة التحكم</h1>
    <section class="tiles">${tiles.map(([l, v, s, href]) => `<a href="${href}" class="tile"><span class="tile-label">${l}</span><b>${esc(v)}</b><small>${esc(s)}</small></a>`).join('')}</section>
    <section class="card"><h2>إجراءات سريعة</h2><div class="row wrap">
      <a class="btn primary" href="#/admin/questions">إضافة أسئلة</a>
      <a class="btn ghost" href="#/admin/subjects">المواد والدروس</a>
      <a class="btn ghost" href="#/admin/payments">مراجعة الإيصالات</a>
      <a class="btn ghost" href="#/admin/competitions">إنشاء مسابقة</a>
      <a class="btn ghost" href="#/admin/plans">الباقات والأسعار</a>
      <a class="btn ghost" href="#/admin/settings">الإعدادات</a>
      <button class="btn ghost" data-action="reports">إرسال تقارير أولياء الأمور الآن</button></div></section>`;
  onAction(el, {
    reports: (b) => run(b, async () => {
      const r = await API.post('/admin/reports/send-weekly');
      toast(`تم: ${r.sent} تقرير، فشل ${r.failed}`);
    }),
  });
};

// ---------------------------------------------------------------- Subjects & lessons
Admin.subjects = async (el) => {
  const { subjects } = await API.get('/admin/subjects');
  el.innerHTML = `<h1 class="page-head">المواد والدروس</h1>
    <section class="card"><h2>مادة جديدة</h2>
      <form id="sf" class="form inline"><input name="name" required maxlength="120" placeholder="اسم المادة، مثلاً: الأحياء"><button class="btn primary" type="submit">إضافة</button></form>
    </section>
    ${subjects.length ? subjects.map((s) => `<section class="card">
      <div class="card-head"><h2>${esc(s.name)} ${badge(`${s.questions} سؤال`)}</h2>
        <div class="row"><button class="btn ghost tiny" data-action="renameSubject" data-id="${s.id}" data-name="${esc(s.name)}">تعديل الاسم</button>
        <a class="btn ghost tiny" href="#/admin/questions?subject_id=${s.id}">الأسئلة</a>
        <button class="btn danger tiny" data-action="deleteSubject" data-id="${s.id}" data-name="${esc(s.name)}">حذف</button></div></div>
      ${s.lessons.length ? `<ul class="list">${s.lessons.map((l) => `<li>
        <span><b>${esc(l.name)}</b><small class="muted">${esc(l.lesson_type || '')} · ${l.questions} سؤال</small></span>
        <span class="row"><button class="btn ghost tiny" data-action="editLesson" data-id="${l.id}" data-name="${esc(l.name)}" data-type="${esc(l.lesson_type || '')}">تعديل</button>
        <button class="btn danger tiny" data-action="deleteLesson" data-id="${l.id}" data-name="${esc(l.name)}">حذف</button></span></li>`).join('')}</ul>` : '<p class="muted">مفيش دروس لسه.</p>'}
      <form class="form inline" data-add-lesson="${s.id}"><input name="name" required placeholder="درس جديد"><input name="lesson_type" placeholder="نوع الدرس (اختياري)"><button class="btn ghost" type="submit">إضافة درس</button></form>
    </section>`).join('') : empty('مفيش مواد لسه. ضيف مادة أو ارفع شيت أسئلة.')}`;

  const reload = () => Admin.subjects(el);
  onSubmit($('#sf', el), async (v) => { await API.post('/admin/subjects', v); toast('تمت إضافة المادة'); reload(); });
  listen(el, 'submit', (e) => {
    const f = e.target;
    if (!f.dataset.addLesson) return;
    e.preventDefault();
    run(f.querySelector('button'), async () => {
      const v = formValues(f);
      await API.post(`/admin/subjects/${f.dataset.addLesson}/lessons`, { name: v.name, lesson_type: v.lesson_type || null });
      toast('تمت إضافة الدرس');
      reload();
    });
  });
  onAction(el, {
    renameSubject: (b) => {
      const m = modal(`<h2>تعديل اسم المادة</h2><form class="form" id="mf"><label>الاسم<input name="name" required value="${esc(b.dataset.name)}"></label><button class="btn primary" type="submit">حفظ</button></form>`);
      onSubmit($('#mf', m), async (v) => { await API.patch(`/admin/subjects/${b.dataset.id}`, v); closeModal(); reload(); });
    },
    deleteSubject: (b) => run(b, async () => {
      if (!confirm(`حذف مادة "${b.dataset.name}" ودروسها؟`)) return;
      await API.del(`/admin/subjects/${b.dataset.id}`);
      toast('تم الحذف');
      reload();
    }),
    editLesson: (b) => {
      const m = modal(`<h2>تعديل الدرس</h2><form class="form" id="mf">
        <label>الاسم<input name="name" required value="${esc(b.dataset.name)}"></label>
        <label>نوع الدرس<input name="lesson_type" value="${esc(b.dataset.type)}"></label>
        <button class="btn primary" type="submit">حفظ</button></form>`);
      onSubmit($('#mf', m), async (v) => { await API.patch(`/admin/lessons/${b.dataset.id}`, { name: v.name, lesson_type: v.lesson_type || null }); closeModal(); reload(); });
    },
    deleteLesson: (b) => run(b, async () => {
      if (!confirm(`حذف درس "${b.dataset.name}"؟ أسئلته هتفضل في المادة من غير درس.`)) return;
      await API.del(`/admin/lessons/${b.dataset.id}`);
      reload();
    }),
  });
};

// ---------------------------------------------------------------- Questions
const MEDIA_SLOTS = [['question', 'صورة السؤال'], ['option_a', 'صورة أ'], ['option_b', 'صورة ب'], ['option_c', 'صورة ج'], ['option_d', 'صورة د'], ['explanation', 'صورة الشرح']];

function questionForm(q, subjects) {
  const subj = subjects.find((s) => s.id === q?.subject_id) || subjects[0];
  const media = q?.media || {};
  return `<form class="form" id="qf">
    <div class="grid2">
      <label>المادة<select name="subject_id" required>${subjects.map((s) => opt(s.id, s.name, subj?.id)).join('')}</select></label>
      <label>الدرس<select name="lesson_id"><option value="">بدون درس</option>${(subj?.lessons || []).map((l) => opt(l.id, l.name, q?.lesson_id)).join('')}</select></label>
    </div>
    <label>نص السؤال<textarea name="question_text" rows="3">${esc(q?.question_text || '')}</textarea></label>
    <p class="muted hint">✏️ الأس: اكتب <code>10^8</code> أو <code>10^{-19}</code> ← 10<sup>8</sup> · الرقم الصغير تحت: <code>H_2O</code> ← H<sub>2</sub>O</p>
    <div class="math-preview" aria-live="polite"></div>
    <div class="grid2">${['a', 'b', 'c', 'd'].map((k, i) => `<label>${'أبجد'[i]}<input name="option_${k}" value="${esc(q?.[`option_${k}`] || '')}"></label>`).join('')}</div>
    <fieldset class="features-box"><legend>الصور (اختياري — ممكن السؤال أو الاختيار يبقى صورة بس)</legend>
      <div class="media-grid">${MEDIA_SLOTS.map(([slot, label]) => `<div class="media-slot" data-slot="${slot}">
        <b>${label}</b>
        ${media[slot] ? `<img src="${esc(media[slot])}" alt="${label}"><label class="check"><input type="checkbox" name="rm_${slot}"> حذف الصورة</label>` : ''}
        <input type="file" name="img_${slot}" accept="image/png,image/jpeg,image/webp,image/gif">
      </div>`).join('')}</div>
    </fieldset>
    <div class="grid2">
      <label>الإجابة الصحيحة<select name="correct_option">${['A', 'B', 'C', 'D'].map((k) => opt(k, letter(k), q?.correct_option || 'A')).join('')}</select></label>
      <label>التصنيف<select name="category">${opt('lesson', 'درس', q?.category || 'lesson')}${opt('past_exam', 'امتحان سابق', q?.category)}</select></label>
      <label>سنة الامتحان (للامتحانات السابقة)<input type="number" name="exam_year" min="1990" max="2100" value="${esc(q?.exam_year || '')}"></label>
      <label>نوع الدرس<input name="lesson_type" value="${esc(q?.lesson_type || '')}"></label>
    </div>
    <label>الشرح (بيظهر للطالب مجاناً بدل الذكاء الاصطناعي)<textarea name="explanation" rows="4">${esc(q?.explanation || '')}</textarea></label>
    <label>القانون / الملحوظة<input name="law_note" value="${esc(q?.law_note || '')}"></label>
    <label class="check"><input type="checkbox" name="is_active" ${q?.is_active === false ? '' : 'checked'}> السؤال ظاهر للطلاب</label>
    <button class="btn primary" type="submit">${q ? 'حفظ التعديلات' : 'إضافة السؤال'}</button></form>`;
}

/** Shrinks large photos in the browser before upload (max 1600px; small PNG diagrams are kept as-is for sharpness). */
async function prepareImage(file) {
  if (file.type === 'image/gif' || (file.size <= 600 * 1024 && file.type !== 'image/jpeg')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= 600 * 1024) return file;
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.88));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function openQuestionModal(q, subjects, onSaved) {
  if (!subjects.length) { toast('ضيف مادة الأول من صفحة المواد', 'err'); return; }
  const m = modal(`<h2>${q ? `تعديل السؤال #${q.id}` : 'سؤال جديد'}</h2>${questionForm(q, subjects)}`);
  const f = $('#qf', m);
  f.subject_id.addEventListener('change', () => {
    const s = subjects.find((x) => String(x.id) === f.subject_id.value);
    f.lesson_id.innerHTML = '<option value="">بدون درس</option>' + (s?.lessons || []).map((l) => opt(l.id, l.name)).join('');
  });
  // Live preview of formulas (superscript/subscript) while typing
  const preview = $('.math-preview', m);
  const renderPreview = () => {
    const parts = [f.question_text.value, ...['a', 'b', 'c', 'd'].map((k) => f[`option_${k}`].value)];
    preview.innerHTML = parts.some((t) => /[\^_]/.test(t))
      ? `${rich(parts[0])}${parts.slice(1).some(Boolean) ? ` — ${parts.slice(1).map((t, i) => `${'أبجد'[i]}) ${rich(t)}`).join('  ')}` : ''}`
      : '';
  };
  f.addEventListener('input', renderPreview);
  renderPreview();
  // Live preview of a newly chosen image
  f.addEventListener('change', (e) => {
    if (e.target.type !== 'file' || !e.target.files[0]) return;
    const box = e.target.closest('.media-slot');
    let img = box.querySelector('img');
    if (!img) { img = document.createElement('img'); box.insertBefore(img, e.target); }
    img.src = URL.createObjectURL(e.target.files[0]);
  });
  onSubmit(f, async (v) => {
    const files = Object.fromEntries(MEDIA_SLOTS.map(([slot]) => [slot, f[`img_${slot}`].files[0]]));
    const keeps = (slot) => Boolean(files[slot] || (q?.media?.[slot] && !v[`rm_${slot}`]));
    if (!v.question_text && !keeps('question')) throw new Error('اكتب نص السؤال أو ضيف صورة له');
    for (const [k, L] of [['option_a', 'أ'], ['option_b', 'ب'], ['option_c', 'ج'], ['option_d', 'د']]) {
      if (!v[k] && !keeps(k)) throw new Error(`الاختيار ${L} محتاج نص أو صورة`);
    }
    const body = {
      subject_id: Number(v.subject_id),
      lesson_id: v.lesson_id ? Number(v.lesson_id) : null,
      question_text: v.question_text ?? '',
      option_a: v.option_a ?? '', option_b: v.option_b ?? '', option_c: v.option_c ?? '', option_d: v.option_d ?? '',
      correct_option: v.correct_option,
      category: v.category,
      exam_year: v.exam_year ? Number(v.exam_year) : null,
      explanation: v.explanation ?? null,
      law_note: v.law_note ?? null,
      lesson_type: v.lesson_type ?? null,
      is_active: v.is_active,
    };
    const saved = q ? await API.patch(`/admin/questions/${q.id}`, body) : await API.post('/admin/questions', body);
    const id = saved.question.id;
    for (const [slot] of MEDIA_SLOTS) {
      if (files[slot]) {
        const fd = new FormData();
        fd.append('image', await prepareImage(files[slot]), files[slot].name);
        await API.req('PUT', `/admin/questions/${id}/media/${slot}`, undefined, { form: fd });
      } else if (v[`rm_${slot}`] && q?.media?.[slot]) {
        await API.del(`/admin/questions/${id}/media/${slot}`);
      }
    }
    closeModal();
    toast(q ? 'تم الحفظ' : 'تمت إضافة السؤال');
    onSaved();
  });
}

Admin.questions = async (el, params, query) => {
  const page = Number(query.page || 1);
  const qs = new URLSearchParams({ page: String(page), limit: '20' });
  for (const k of ['search', 'subject_id', 'lesson_id', 'category']) if (query[k]) qs.set(k, query[k]);
  if (query.missing === '1') qs.set('missing_explanation', 'true');
  const [list, { subjects }] = await Promise.all([API.get(`/admin/questions?${qs}`), API.get('/admin/subjects')]);
  const curSubject = subjects.find((s) => String(s.id) === query.subject_id);

  el.innerHTML = `<div class="page-head"><h1>بنك الأسئلة</h1><button class="btn primary" data-action="new">+ سؤال جديد</button></div>
    <section class="card"><div class="card-head"><h2>رفع شيت Excel</h2><button class="btn ghost tiny" data-action="template">⬇ تحميل النموذج</button></div>
      <p class="muted">الأعمدة: السؤال · صورة السؤال · أ · ب · ج · د · الإجابة الصحيحة · الشرح · القانون/الملحوظة · المادة · الدرس · نوع الدرس · التصنيف (درس / امتحان سابق) · سنة الامتحان. المواد والدروس الجديدة بتتضاف لوحدها.</p>
      <p class="muted">🖼 <b>الصور:</b> الصق الصورة جوه صف السؤال (Insert ← Pictures ← <b>Place over Cells</b>). في عمود "صورة السؤال" = صورة السؤال، في عمود اختيار = صورة الاختيار، في عمود الشرح = صورة الشرح. الملف كله لحد 4MB والصورة الواحدة لحد 2MB — لو الصور كتير قسّم الأسئلة على كذا ملف.</p>
      <form id="uf" class="form grid3">
        <label class="span2">ملف .xlsx (حتى 4MB)<input type="file" name="file" accept=".xlsx" required></label>
        <label>مادة افتراضية (لو مفيش عمود مادة)<input name="default_subject"></label>
        <label class="check"><input type="checkbox" name="dry_run"> فحص فقط بدون حفظ</label>
        <button class="btn primary" type="submit">رفع</button>
      </form>
      <div id="result"></div>
    </section>
    <section class="card"><div class="card-head"><h2>الأسئلة ${badge(list.total)}</h2></div>
      <form id="ff" class="form grid3">
        <label>بحث<input name="search" value="${esc(query.search || '')}" placeholder="جزء من نص السؤال"></label>
        <label>المادة<select name="subject_id"><option value="">الكل</option>${subjects.map((s) => opt(s.id, s.name, query.subject_id)).join('')}</select></label>
        <label>الدرس<select name="lesson_id"><option value="">الكل</option>${(curSubject?.lessons || []).map((l) => opt(l.id, l.name, query.lesson_id)).join('')}</select></label>
        <label>التصنيف<select name="category"><option value="">الكل</option>${opt('lesson', 'دروس', query.category)}${opt('past_exam', 'امتحانات سابقة', query.category)}</select></label>
        <label class="check"><input type="checkbox" name="missing" ${query.missing === '1' ? 'checked' : ''}> بدون شرح فقط</label>
        <button class="btn ghost" type="submit">تصفية</button>
      </form>
      ${list.items.length ? table(['#', 'السؤال', 'المادة / الدرس', 'التصنيف', 'الإجابة', 'الشرح', ''],
        list.items.map((q) => [q.id,
          (q.media?.question ? `<img class="thumb" src="${esc(q.media.question)}" alt=""> ` : '')
            + rich(q.question_text.length > 70 ? `${q.question_text.slice(0, 70)}…` : q.question_text)
            + (Object.keys(q.media || {}).length ? ` ${badge(`🖼 ${Object.keys(q.media).length}`)}` : '')
            + (q.is_active ? '' : ` ${badge('مخفي', 'bad')}`),
          `${esc(q.subject)}<br><small class="muted">${esc(q.lesson || '')}</small>`,
          esc(LABELS.category[q.category]) + (q.exam_year ? `<br><small class="muted">${q.exam_year}</small>` : ''),
          `<b>${letter(q.correct_option)}</b>`, q.explanation ? '✓' : badge('لا يوجد', 'mid'),
          `<div class="row"><button class="btn ghost tiny" data-action="edit" data-id="${q.id}">تعديل</button>
            <button class="btn danger tiny" data-action="del" data-id="${q.id}">حذف</button></div>`])) : empty('مفيش أسئلة بالتصفية دي')}
      <div class="row between">${page > 1 ? `<a class="btn ghost tiny" href="#/admin/questions?${pageQs(query, page - 1)}">السابق</a>` : '<span></span>'}
        ${page * 20 < list.total ? `<a class="btn ghost tiny" href="#/admin/questions?${pageQs(query, page + 1)}">التالي</a>` : ''}</div>
    </section>`;

  const reload = () => Admin.questions(el, params, query);
  const ff = $('#ff', el);
  ff.subject_id.addEventListener('change', () => {
    const s = subjects.find((x) => String(x.id) === ff.subject_id.value);
    ff.lesson_id.innerHTML = '<option value="">الكل</option>' + (s?.lessons || []).map((l) => opt(l.id, l.name)).join('');
  });
  onSubmit(ff, async (v) => {
    const p = new URLSearchParams();
    for (const k of ['search', 'subject_id', 'lesson_id', 'category']) if (v[k]) p.set(k, v[k]);
    if (v.missing) p.set('missing', '1');
    location.hash = `#/admin/questions?${p}`;
  });
  onSubmit($('#uf', el), async (v, form) => {
    const fd = new FormData();
    fd.append('file', form.file.files[0]);
    if (v.default_subject) fd.append('default_subject', v.default_subject);
    const res = $('#result', el);
    try {
      const r = await API.upload(`/admin/questions/upload${v.dry_run ? '?dry_run=true' : ''}`, fd);
      const errs = r.errors || [];
      res.innerHTML = `<div class="notice ${errs.length ? 'mid' : 'good'}">${r.dry_run
        ? `فحص: ${r.valid_rows} صف سليم (فيهم ${r.images} صورة)، ${r.failed} صف فيه أخطاء`
        : `تم إضافة <b>${r.inserted}</b> سؤال و${r.images} صورة · مكرر (اتجاهل): ${r.duplicates} · فيه أخطاء: ${r.failed}`}</div>
        ${errs.length ? table(['الصف', 'الأخطاء'], errs.map((e) => [e.row, esc(e.errors.join('، '))])) : ''}`;
      if (!r.dry_run) { toast(`تم رفع ${r.inserted} سؤال`); setTimeout(reload, 1500); }
    } catch (err) {
      const d = err.details;
      res.innerHTML = `<div class="notice bad">${esc(err.message)}${d?.missing_columns ? `: ${esc(d.missing_columns.join('، '))}` : ''}</div>
        ${d?.errors ? table(['الصف', 'الأخطاء'], d.errors.map((e) => [e.row, esc(e.errors.join('، '))])) : ''}`;
    }
  });
  onAction(el, {
    new: () => openQuestionModal(null, subjects, reload),
    edit: (b) => openQuestionModal(list.items.find((x) => String(x.id) === b.dataset.id), subjects, reload),
    del: (b) => run(b, async () => {
      if (!confirm('حذف السؤال؟')) return;
      const r = await API.del(`/admin/questions/${b.dataset.id}`);
      toast(r.message);
      reload();
    }),
    template: (b) => run(b, async () => {
      const blob = await API.blob('/admin/questions/template');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'questions-template.xlsx' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }),
  });
};

// ---------------------------------------------------------------- Payments review
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

// ---------------------------------------------------------------- Plans
function planFields(p, features) {
  return `<div class="grid2">
      <label>اسم الباقة<input name="name_ar" required value="${esc(p?.name_ar || '')}"></label>
      <label>السعر (جنيه)<input type="number" name="price_egp" min="0" step="0.01" required value="${esc(p?.price_egp ?? '')}"></label>
      <label>المدة (يوم)<input type="number" name="duration_days" min="1" required value="${esc(p?.duration_days ?? 30)}"></label>
      <label title="الباقة الأعلى في الترتيب بتعتبر الأفضل وبتظهر في الآخر">ترتيب العرض<input type="number" name="rank" min="0" max="100" required value="${esc(p?.rank ?? 1)}"></label>
    </div>
    <fieldset class="features-box"><legend>المميزات المتاحة في الباقة</legend>
      ${features.map((f) => `<label class="check"><input type="checkbox" name="f_${f}" ${p?.features?.[f] ? 'checked' : ''}> ${esc(LABELS.feature[f] || f)}</label>`).join('')}
    </fieldset>
    <label class="check"><input type="checkbox" name="is_active" ${p ? (p.is_active ? 'checked' : '') : 'checked'}> الباقة ظاهرة للطلاب</label>`;
}
const planPayload = (v, features) => ({
  name_ar: v.name_ar, price_egp: Number(v.price_egp), duration_days: Number(v.duration_days), rank: Number(v.rank),
  is_active: v.is_active, features: Object.fromEntries(features.map((f) => [f, Boolean(v[`f_${f}`])])),
});

Admin.plans = async (el) => {
  const { plans, features } = await API.get('/admin/plans');
  el.innerHTML = `<h1 class="page-head">الباقات والأسعار</h1>
    <p class="muted">تغيير السعر أو المدة بيطبّق على الاشتراكات الجديدة. إلغاء ميزة من باقة بيقفلها فوراً على المشتركين فيها.</p>
    <div class="grid-cards plans-admin">${plans.map((p) => `<form class="card form" data-plan="${esc(p.code)}">
      <div class="card-head"><h2>${esc(p.name_ar)}</h2><span class="row">${badge(p.code)} ${p.is_active ? '' : badge('مخفية', 'bad')}</span></div>
      <p class="muted">${p.active_subscribers} مشترك حالياً</p>
      ${planFields(p, features)}
      <button class="btn primary" type="submit">حفظ</button></form>`).join('')}</div>
    <section class="card"><h2>باقة جديدة</h2><form id="nf" class="form">
      <label>كود الباقة (إنجليزي، مثلاً: monthly_exams)<input name="code" required pattern="[a-z][a-z0-9_]{1,19}" class="mono"></label>
      ${planFields(null, features)}
      <button class="btn primary" type="submit">إنشاء الباقة</button></form></section>`;
  const reload = () => Admin.plans(el);
  listen(el, 'submit', (e) => {
    const f = e.target;
    if (!f.dataset.plan) return;
    e.preventDefault();
    run(f.querySelector('[type=submit]'), async () => {
      await API.patch(`/admin/plans/${f.dataset.plan}`, planPayload(formValues(f), features));
      toast('تم حفظ الباقة');
      reload();
    });
  });
  onSubmit($('#nf', el), async (v) => {
    await API.post('/admin/plans', { code: v.code, ...planPayload(v, features) });
    toast('تم إنشاء الباقة');
    reload();
  });
};

// ---------------------------------------------------------------- Competitions
Admin.competitions = async (el) => {
  const [{ competitions }, { subjects }] = await Promise.all([API.get('/competitions'), API.get('/admin/subjects')]);
  const now = new Date();
  el.innerHTML = `<h1 class="page-head">المسابقات</h1>
    <section class="card"><h2>مسابقة جديدة</h2>
      <form id="cf" class="form grid3">
        <label class="span2">العنوان<input name="title" required value="مسابقة الجمعة"></label>
        <label>النوع<select name="type"><option value="team_weekly">تيمات (أسبوعية)</option><option value="individual_monthly">فردية (شهرية)</option></select></label>
        <label>تبدأ<input type="datetime-local" name="starts_at" required value="${toLocalInput(now)}"></label>
        <label>تنتهي<input type="datetime-local" name="ends_at" required value="${toLocalInput(new Date(now.getTime() + 2 * 3600000))}"></label>
        <label>مدة الحل (دقيقة)<input type="number" name="duration_minutes" min="1" max="600" value="30"></label>
        <label>عدد الأسئلة (عشوائي)<input type="number" name="count" min="1" max="200" value="10"></label>
        <label>المادة<select name="subject_id"><option value="">كل المواد</option>${subjects.map((s) => opt(s.id, `${s.name} (${s.questions})`)).join('')}</select></label>
        <label>التصنيف<select name="category"><option value="">الكل</option><option value="lesson">دروس</option><option value="past_exam">امتحانات سابقة</option></select></label>
        <button class="btn primary span3" type="submit">إنشاء المسابقة</button>
      </form></section>
    <section class="card"><h2>كل المسابقات</h2>${competitions.length ? table(['المسابقة', 'النوع', 'الوقت', 'الحالة', ''],
      competitions.map((c) => [`${esc(c.title)}<br><small class="muted">${c.question_count} سؤال · ${c.duration_minutes} د</small>`, esc(LABELS.compType[c.type]),
        `${fmtDate(c.starts_at)}<br><small class="muted">${fmtDate(c.ends_at)}</small>`,
        badge(LABELS.compStatus[c.status], LABELS.compTone[c.status]),
        `<div class="row"><a class="btn ghost tiny" href="#/competition/${c.id}">الترتيب</a>
          <button class="btn ghost tiny" data-action="edit" data-id="${c.id}">تعديل</button>
          <button class="btn danger tiny" data-action="del" data-id="${c.id}">حذف</button></div>`])) : empty('مفيش مسابقات')}</section>`;
  const reload = () => Admin.competitions(el);
  onSubmit($('#cf', el), async (v) => {
    const r = await API.post('/admin/competitions', {
      title: v.title, type: v.type,
      starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(),
      duration_minutes: Number(v.duration_minutes),
      random: { count: Number(v.count), subject_id: num(v.subject_id), category: v.category },
    });
    toast(`تم إنشاء المسابقة بـ ${r.competition.question_count} سؤال`);
    reload();
  });
  onAction(el, {
    edit: (b) => {
      const c = competitions.find((x) => String(x.id) === b.dataset.id);
      const m = modal(`<h2>تعديل المسابقة</h2><form class="form" id="ef">
        <label>العنوان<input name="title" required value="${esc(c.title)}"></label>
        <div class="grid2"><label>تبدأ<input type="datetime-local" name="starts_at" required value="${toLocalInput(c.starts_at)}"></label>
        <label>تنتهي<input type="datetime-local" name="ends_at" required value="${toLocalInput(c.ends_at)}"></label></div>
        <label>مدة الحل (دقيقة)<input type="number" name="duration_minutes" min="1" max="600" value="${c.duration_minutes}"></label>
        <button class="btn primary" type="submit">حفظ</button></form>`);
      onSubmit($('#ef', m), async (v) => {
        await API.patch(`/admin/competitions/${c.id}`, {
          title: v.title, starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(), duration_minutes: Number(v.duration_minutes),
        });
        closeModal();
        toast('تم الحفظ');
        reload();
      });
    },
    del: (b) => run(b, async () => {
      if (!confirm('حذف المسابقة ونتائجها؟')) return;
      await API.del(`/admin/competitions/${b.dataset.id}`);
      toast('تم حذف المسابقة');
      reload();
    }),
  });
};

// ---------------------------------------------------------------- Teams
Admin.teams = async (el, params, query) => {
  const search = query.search || '';
  const { teams, max_size: max } = await API.get(`/admin/teams${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  el.innerHTML = `<h1 class="page-head">التيمات</h1>
    <section class="card"><h2>توزيع الطلاب بدون تيم</h2>
      <p class="muted">بيشتغل تلقائياً كل خميس. بيكمّل التيمات الناقصة الأول، وبعدين يقسم الباقي لتيمات متوازنة.</p>
      <div class="row wrap"><label class="check"><input type="checkbox" id="reqsub" checked> المشتركين فقط</label>
      <button class="btn primary" data-action="assign">وزّع الآن</button></div><div id="assign-result"></div></section>
    <form id="sf" class="form inline"><input name="search" value="${esc(search)}" placeholder="اسم التيم أو كود/اسم طالب"><button class="btn ghost" type="submit">بحث</button></form>
    ${teams.length ? `<div class="grid-cards">${teams.map((t) => `<section class="card">
      <div class="card-head"><h2>${esc(t.name)}</h2><span class="row">${badge(`${t.members.length}/${max}`, t.members.length === max ? 'good' : 'mid')}${t.is_auto_generated ? badge('تلقائي') : ''}</span></div>
      <ul class="list">${t.members.map((m) => `<li><span>${m.id === t.captain_id ? '👑 ' : ''}${esc(m.full_name)} <small class="mono muted">${esc(m.student_code)}</small></span>
        <button class="btn ghost tiny" data-action="remove" data-team="${t.id}" data-user="${m.id}">إزالة</button></li>`).join('')}</ul>
      ${t.members.length < max ? `<form class="form inline" data-add-member="${t.id}"><input name="student_code" required placeholder="كود الطالب" class="mono"><button class="btn ghost tiny" type="submit">إضافة</button></form>` : ''}
      <div class="row"><button class="btn ghost tiny" data-action="edit" data-id="${t.id}">تعديل</button>
        <button class="btn danger tiny" data-action="del" data-id="${t.id}">حذف التيم</button></div>
    </section>`).join('')}</div>` : empty('مفيش تيمات')}`;
  const reload = () => Admin.teams(el, params, query);
  onSubmit($('#sf', el), async (v) => { location.hash = `#/admin/teams${v.search ? `?search=${encodeURIComponent(v.search)}` : ''}`; });
  listen(el, 'submit', (e) => {
    const f = e.target;
    if (!f.dataset.addMember) return;
    e.preventDefault();
    run(f.querySelector('button'), async () => {
      await API.post(`/admin/teams/${f.dataset.addMember}/members`, formValues(f));
      toast('تمت الإضافة');
      reload();
    });
  });
  onAction(el, {
    assign: (b) => run(b, async () => {
      const r = await API.post('/admin/teams/auto-assign', { require_subscription: $('#reqsub', el).checked });
      toast(`اتوزع ${r.eligible} طالب: ${r.added_to_existing} في تيمات ناقصة و${r.new_teams.length} تيم جديد`);
      reload();
    }),
    remove: (b) => run(b, async () => {
      if (!confirm('إزالة الطالب من التيم؟')) return;
      await API.del(`/admin/teams/${b.dataset.team}/members/${b.dataset.user}`);
      reload();
    }),
    del: (b) => run(b, async () => {
      if (!confirm('حذف التيم؟ أعضاؤه هيبقوا من غير تيم.')) return;
      await API.del(`/admin/teams/${b.dataset.id}`);
      reload();
    }),
    edit: (b) => {
      const t = teams.find((x) => String(x.id) === b.dataset.id);
      const m = modal(`<h2>تعديل التيم</h2><form class="form" id="tf">
        <label>الاسم<input name="name" required value="${esc(t.name)}"></label>
        <label>القائد<select name="captain_id">${t.members.map((x) => opt(x.id, `${x.full_name} (${x.student_code})`, t.captain_id)).join('')}</select></label>
        <label class="check"><input type="checkbox" name="allow_auto_fill" ${t.allow_auto_fill ? 'checked' : ''}> يسمح بإكماله تلقائياً</label>
        <button class="btn primary" type="submit">حفظ</button></form>`);
      onSubmit($('#tf', m), async (v) => {
        await API.patch(`/admin/teams/${t.id}`, { name: v.name, allow_auto_fill: v.allow_auto_fill, captain_id: num(v.captain_id) });
        closeModal();
        reload();
      });
    },
  });
};

// ---------------------------------------------------------------- Students
const studentFields = (s = {}) => `
  <label class="span2">الاسم بالكامل<input name="full_name" required minlength="3" value="${esc(s.full_name || '')}"></label>
  <label>البريد الإلكتروني<input name="email" type="email" required value="${esc(s.email || '')}"></label>
  <label>رقم الطالب<input name="phone" required inputmode="numeric" value="${esc(s.phone || '')}"></label>
  <label>رقم ولي الأمر<input name="parent_phone" required inputmode="numeric" value="${esc(s.parent_phone || '')}"></label>
  <label>إيميل ولي الأمر<input name="parent_email" type="email" value="${esc(s.parent_email || '')}"></label>`;

Admin.students = async (el, params, query) => {
  const search = query.search || '';
  const { items } = await API.get(`/admin/students?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  el.innerHTML = `<div class="page-head"><h1>الطلاب</h1><button class="btn primary" data-action="new">+ طالب جديد</button></div>
    <section class="card"><form id="sf" class="form inline"><input name="search" value="${esc(search)}" placeholder="كود الطالب، الإيميل أو الاسم"><button class="btn ghost" type="submit">بحث</button></form>
    ${items.length ? table(['الكود', 'الاسم', 'التواصل', 'الاشتراك', 'الحالة', ''],
      items.map((s) => [s.student_code ? `<span class="mono">${esc(s.student_code)}</span>` : badge('لم يكمل التسجيل', 'mid'), esc(s.full_name),
        `${esc(s.email)}<br><small class="muted">طالب ${esc(s.phone)} · ولي أمر ${esc(s.parent_phone)}</small>`,
        s.current_plan ? badge(s.current_plan, 'good') : badge('بدون', ''),
        `${s.is_verified ? '' : badge('غير مفعّل', 'mid')} ${s.is_active ? badge('نشط', 'good') : badge('موقوف', 'bad')}`,
        `<a class="btn primary tiny" href="#/admin/student/${s.id}">إدارة</a>`])) : empty('مفيش طلاب')}
    </section>`;
  onSubmit($('#sf', el), async (v) => { location.hash = `#/admin/students${v.search ? `?search=${encodeURIComponent(v.search)}` : ''}`; });
  onAction(el, {
    new: () => {
      const m = modal(`<h2>إضافة طالب</h2><p class="muted">الحساب بيتفعّل على طول من غير رمز تحقق.</p>
        <form class="form grid2" id="nf">${studentFields()}
        <label class="span2">كلمة المرور<input name="password" required minlength="8" placeholder="8 أحرف على الأقل، حروف وأرقام"></label>
        <button class="btn primary span2" type="submit">إضافة</button></form>`);
      onSubmit($('#nf', m), async (v) => {
        const r = await API.post('/admin/students', v);
        closeModal();
        toast(`تمت إضافة الطالب — الكود ${r.student.student_code}`);
        location.hash = `#/admin/student/${r.student.id}`;
      });
    },
  });
};

Admin.student = async (el, { id }) => {
  const [d, { plans }] = await Promise.all([API.get(`/admin/students/${id}`), API.get('/admin/plans')]);
  const s = d.student;
  const aiPct = s.ai_limit_egp ? (s.ai_spent_egp / s.ai_limit_egp) * 100 : 0;
  el.innerHTML = `<div class="page-head"><a class="btn ghost tiny" href="#/admin/students">→ الطلاب</a><h1>${esc(s.full_name)}</h1>
      ${s.student_code ? `<span class="mono muted">${esc(s.student_code)}</span>` : badge('لم يكمل التسجيل — عيّن له كلمة مرور لإكماله', 'mid')}${s.is_active ? badge('نشط', 'good') : badge('موقوف', 'bad')}</div>

    <section class="tiles">
      <div class="tile"><span class="tile-label">الأداء العام</span><b class="${percentTone(d.performance.overall.percent)}">${d.performance.overall.percent ?? '—'}%</b><small>${esc(d.performance.overall.rating)}</small></div>
      <div class="tile"><span class="tile-label">بنك الأخطاء</span><b>${d.open_mistakes}</b><small>سؤال مفتوح</small></div>
      <div class="tile"><span class="tile-label">التيم</span><b class="small-b">${d.team ? esc(d.team.name) : '—'}</b><small>${d.team ? `<a href="#/admin/teams?search=${encodeURIComponent(d.team.name)}">إدارة التيم</a>` : ''}</small></div>
      <div class="tile"><span class="tile-label">نقاط AI المستهلكة</span><b>${fmtPoints(egpToPoints(s.ai_spent_egp))}</b><small>من ${fmtPoints(egpToPoints(s.ai_limit_egp))} · تكلفة فعلية ${fmtMoney(s.ai_spent_egp, 3)}</small>${bar(aiPct, aiPct > 80 ? 'bad' : 'good')}</div>
    </section>

    <section class="card"><h2>بيانات الطالب</h2>
      <form id="pf" class="form grid2">${studentFields(s)}
        <label class="check"><input type="checkbox" name="is_verified" ${s.is_verified ? 'checked' : ''}> الحساب مفعّل (تم تأكيد الإيميل)</label>
        <label class="check"><input type="checkbox" name="is_active" ${s.is_active ? 'checked' : ''}> الحساب نشط (إلغاؤه بيمنع الدخول)</label>
        <button class="btn primary span2" type="submit">حفظ البيانات</button></form></section>

    <section class="card"><h2>الاشتراكات</h2>
      ${d.subscriptions.length ? table(['الباقة', 'من', 'إلى', 'الحالة', ''], d.subscriptions.map((x) => [esc(x.name_ar), fmtDay(x.starts_at), fmtDay(x.ends_at),
        x.status === 'cancelled' ? badge('ملغي', 'bad') : x.is_current ? badge('ساري', 'good') : badge(new Date(x.starts_at) > new Date() ? 'قادم' : 'منتهي'),
        x.status === 'active' && new Date(x.ends_at) > new Date() ? `<button class="btn danger tiny" data-action="cancelSub" data-id="${x.id}">إلغاء</button>` : ''])) : empty('مفيش اشتراكات')}
      <h3>منح اشتراك يدوي</h3>
      <form id="gf" class="form inline">
        <select name="plan_code">${[...plans].sort((a, b) => b.is_active - a.is_active || b.rank - a.rank)
          .map((p) => opt(p.code, `${p.name_ar} — ${p.duration_days} يوم${p.is_active ? '' : ' (مخفية)'}`)).join('')}</select>
        <input type="number" name="days" min="1" max="3650" placeholder="عدد الأيام (اختياري)">
        <button class="btn primary" type="submit">منح الاشتراك</button></form></section>

    <div class="grid-cards">
      <section class="card"><h2>الذكاء الاصطناعي</h2><form id="af" class="form">
        <label>رصيد النقاط (الحد الأقصى)<input type="number" name="ai_limit_points" min="0" step="1" value="${Math.round(s.ai_limit_egp * pointsRate())}"></label>
        <p class="muted">= ${fmtMoney(s.ai_limit_egp)} من تكلفة الموديل (${pointsRate()} نقطة = 1 جنيه)</p>
        <label class="check"><input type="checkbox" name="reset_ai_spent"> تصفير الاستهلاك الحالي (${fmtPoints(egpToPoints(s.ai_spent_egp))})</label>
        <button class="btn primary" type="submit">حفظ</button></form></section>
      <section class="card"><h2>كلمة المرور</h2><form id="wf" class="form">
        <label>كلمة مرور جديدة للطالب<input name="new_password" required minlength="8" autocomplete="new-password"></label>
        <p class="muted">هيتعمل له تسجيل خروج من كل الأجهزة.</p>
        <button class="btn primary" type="submit">تغيير كلمة المرور</button></form></section>
    </div>

    <section class="card"><h2>الأداء في المواد</h2>${d.performance.subjects.length ? d.performance.subjects.map((x) => `<div class="perf-row">
      <span>${esc(x.subject)}</span>${bar(x.percent, percentTone(x.percent))}<b class="${percentTone(x.percent)}">${x.percent}%</b><small class="muted">${x.correct}/${x.attempts}</small></div>`).join('') : empty('لسه محلش أسئلة')}</section>

    <section class="card"><h2>المدفوعات</h2>${d.payments.length ? table(['التاريخ', 'الباقة', 'المبلغ', 'الطريقة', 'الحالة'],
      d.payments.map((p) => [fmtDate(p.created_at), esc(p.plan_code), fmtMoney(p.amount_egp), esc(LABELS.provider[p.provider]), badge(LABELS.paymentStatus[p.status], LABELS.paymentTone[p.status])])) : empty('مفيش مدفوعات')}</section>`;

  const reload = () => Admin.student(el, { id });
  onSubmit($('#pf', el), async (v) => {
    await API.patch(`/admin/students/${id}`, {
      full_name: v.full_name, email: v.email, phone: v.phone, parent_phone: v.parent_phone,
      parent_email: v.parent_email || null, is_verified: v.is_verified, is_active: v.is_active,
    });
    toast('تم حفظ البيانات');
    reload();
  });
  onSubmit($('#af', el), async (v) => {
    await API.patch(`/admin/students/${id}`, { ai_limit_egp: Number(v.ai_limit_points) / pointsRate(), reset_ai_spent: v.reset_ai_spent });
    toast('تم الحفظ');
    reload();
  });
  onSubmit($('#wf', el), async (v, form) => {
    const r = await API.post(`/admin/students/${id}/password`, v);
    form.reset();
    toast(r.message);
  });
  onSubmit($('#gf', el), async (v) => {
    await API.post(`/admin/students/${id}/subscriptions`, { plan_code: v.plan_code, days: num(v.days) });
    toast('تم منح الاشتراك');
    reload();
  });
  onAction(el, {
    cancelSub: (b) => run(b, async () => {
      if (!confirm('إلغاء الاشتراك ده؟')) return;
      await API.post(`/admin/subscriptions/${b.dataset.id}/cancel`);
      reload();
    }),
  });
};

// ---------------------------------------------------------------- Products
const productFields = (p = {}) => `
  <label class="span2">الاسم<input name="title" required value="${esc(p.title || '')}"></label>
  <label>التصنيف<input name="category" value="${esc(p.category || '')}" placeholder="كتب، أدوات…"></label>
  <label class="span3">الوصف<input name="description" value="${esc(p.description || '')}"></label>
  <label>السعر الأصلي<input type="number" name="original_price" min="0" step="0.01" required value="${esc(p.original_price ?? '')}"></label>
  <label>نسبة الخصم %<input type="number" name="discount_percent" min="0" max="100" value="${esc(p.discount_percent ?? 10)}"></label>
  <label>كود الخصم<input name="coupon_code" value="${esc(p.coupon_code || '')}"></label>
  <label class="span2">رابط الشراء<input type="url" name="external_url" value="${esc(p.external_url || '')}" placeholder="https://"></label>
  <label>رابط الصورة<input type="url" name="image_url" value="${esc(p.image_url || '')}" placeholder="https://"></label>
  <label class="check span3"><input type="checkbox" name="is_active" ${p.is_active === false ? '' : 'checked'}> ظاهر للطلاب</label>`;
const productPayload = (v) => ({
  title: v.title, category: v.category ?? null, description: v.description ?? null, original_price: Number(v.original_price),
  discount_percent: Number(v.discount_percent || 0), coupon_code: v.coupon_code ?? null, external_url: v.external_url ?? null,
  image_url: v.image_url ?? null, is_active: v.is_active,
});

Admin.products = async (el) => {
  const { products } = await API.get('/admin/products');
  el.innerHTML = `<h1 class="page-head">المنتجات والخصومات</h1>
    <section class="card"><h2>منتج جديد</h2><form id="pf" class="form grid3">${productFields()}
      <button class="btn primary span3" type="submit">إضافة</button></form></section>
    <section class="card">${products.length ? table(['المنتج', 'السعر', 'الخصم', 'بعد الخصم', 'الكود', ''],
      products.map((p) => [esc(p.title) + (p.is_active ? '' : ` ${badge('مخفي', 'bad')}`), fmtMoney(p.original_price), `${p.discount_percent}%`, `<b>${fmtMoney(p.final_price)}</b>`, esc(p.coupon_code || '—'),
        `<div class="row"><button class="btn ghost tiny" data-action="edit" data-id="${p.id}">تعديل</button>
          <button class="btn danger tiny" data-action="del" data-id="${p.id}">حذف</button></div>`])) : empty('مفيش منتجات')}</section>`;
  const reload = () => Admin.products(el);
  onSubmit($('#pf', el), async (v) => { await API.post('/admin/products', productPayload(v)); toast('تمت الإضافة'); reload(); });
  onAction(el, {
    edit: (b) => {
      const p = products.find((x) => String(x.id) === b.dataset.id);
      const m = modal(`<h2>تعديل المنتج</h2><form class="form grid3" id="ef">${productFields(p)}<button class="btn primary span3" type="submit">حفظ</button></form>`);
      onSubmit($('#ef', m), async (v) => { await API.put(`/admin/products/${p.id}`, productPayload(v)); closeModal(); toast('تم الحفظ'); reload(); });
    },
    del: (b) => run(b, async () => { if (confirm('حذف المنتج؟')) { await API.del(`/admin/products/${b.dataset.id}`); reload(); } }),
  });
};

// ---------------------------------------------------------------- Settings & admin accounts
Admin.settings = async (el) => {
  const [{ settings: s }, { admins, me }] = await Promise.all([API.get('/admin/settings'), API.get('/admin/admins')]);
  el.innerHTML = `<h1 class="page-head">الإعدادات</h1>
    <section class="card"><h2>إعدادات المنصة</h2><form id="sf" class="form grid2">
      <label>اسم المنصة<input name="site_name" required value="${esc(s.site_name)}"></label>
      <label>رقم الدعم الفني<input name="support_phone" value="${esc(s.support_phone)}"></label>
      <label>رقم فودافون كاش (للتحويل)<input name="vodafone_cash_number" value="${esc(s.vodafone_cash_number)}"></label>
      <label>عنوان انستاباي<input name="instapay_address" value="${esc(s.instapay_address)}"></label>
      <label class="span2">تعليمات الدفع اليدوي<textarea name="manual_payment_instructions" rows="2">${esc(s.manual_payment_instructions)}</textarea></label>
      <label>رصيد نقاط الذكاء الاصطناعي للطالب الجديد<input type="number" name="default_ai_limit_points" min="0" step="1" value="${Math.round(s.default_ai_limit_egp * s.ai_points_per_egp)}"></label>
      <label>كام نقطة = 1 جنيه من تكلفة الموديل<input type="number" name="ai_points_per_egp" min="1" step="1" value="${s.ai_points_per_egp}"></label>
      <p class="muted span2" id="ai-equiv"></p>
      <label>سعر الدولار بالجنيه (لحساب تكلفة Gemini)<input type="number" name="usd_to_egp" min="1" step="0.01" value="${s.usd_to_egp}"></label>
      <button class="btn primary span2" type="submit">حفظ الإعدادات</button></form>
      <p class="muted">حد الذكاء الاصطناعي بيتطبق على الطلاب الجدد. <button class="btn ghost tiny" data-action="applyAi">طبّقه على كل الطلاب الحاليين</button></p>
    </section>

    <section class="card"><h2>حسابات الأدمن</h2>
      ${table(['الاسم', 'الإيميل', 'الحالة', ''], admins.map((a) => [esc(a.full_name), esc(a.email), a.is_active ? badge('نشط', 'good') : badge('موقوف', 'bad'),
        a.id === me ? '<small class="muted">(أنت)</small>' : `<button class="btn ${a.is_active ? 'danger' : 'primary'} tiny" data-action="toggleAdmin" data-id="${a.id}" data-active="${a.is_active}">${a.is_active ? 'إيقاف' : 'تفعيل'}</button>`]))}
      <h3>إضافة أدمن</h3>
      <form id="af" class="form grid3">
        <label>الاسم<input name="full_name" required minlength="3"></label>
        <label>الإيميل<input name="email" type="email" required></label>
        <label>كلمة المرور<input name="password" required minlength="8" autocomplete="new-password"></label>
        <button class="btn primary span3" type="submit">إضافة أدمن</button></form>
    </section>

    <section class="card"><h2>تغيير كلمة المرور بتاعتي</h2><form id="mf" class="form grid2">
      <label>كلمة المرور الحالية<input type="password" name="current_password" required autocomplete="current-password"></label>
      <label>كلمة المرور الجديدة<input type="password" name="new_password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn primary span2" type="submit">تغيير</button></form></section>`;

  const reload = () => Admin.settings(el);
  const sf = $('#sf', el);
  const showEquiv = () => {
    const pts = Number(sf.default_ai_limit_points.value || 0);
    const rate = Number(sf.ai_points_per_egp.value || 1);
    $('#ai-equiv', el).textContent = `${fmtPoints(pts)} = ${fmtMoney(pts / rate)} من تكلفة الموديل لكل طالب (النقطة = ${fmtMoney(1 / rate, 3)})`;
  };
  sf.addEventListener('input', showEquiv);
  showEquiv();
  onSubmit($('#sf', el), async (v) => {
    const { default_ai_limit_points: _p, ...rest } = v;
    await API.patch('/admin/settings', { ...rest, support_phone: v.support_phone ?? '', vodafone_cash_number: v.vodafone_cash_number ?? '',
      instapay_address: v.instapay_address ?? '', manual_payment_instructions: v.manual_payment_instructions ?? '',
      default_ai_limit_egp: Number(v.default_ai_limit_points) / Number(v.ai_points_per_egp),
      ai_points_per_egp: Number(v.ai_points_per_egp), usd_to_egp: Number(v.usd_to_egp) });
    await loadSiteSettings();
    renderTopbar(location.hash.slice(1).split('?')[0]);
    toast('تم حفظ الإعدادات');
  });
  onSubmit($('#af', el), async (v) => { await API.post('/admin/admins', v); toast('تمت إضافة الأدمن'); reload(); });
  onSubmit($('#mf', el), async (v) => {
    const r = await API.post('/admin/me/password', v);
    toast(r.message);
    API.setToken(null);
    State.user = null;
    location.hash = '#/login';
  });
  onAction(el, {
    applyAi: (b) => run(b, async () => {
      if (!confirm('تطبيق الحد الافتراضي على كل الطلاب؟')) return;
      const r = await API.post('/admin/settings/apply-ai-limit');
      toast(`تم تحديث ${r.updated} طالب إلى ${fmtPoints(egpToPoints(r.limit_egp))}`);
    }),
    toggleAdmin: (b) => run(b, async () => {
      await API.patch(`/admin/admins/${b.dataset.id}`, { is_active: b.dataset.active !== 'true' });
      reload();
    }),
  });
};
