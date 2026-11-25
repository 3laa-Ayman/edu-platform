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
    ['المشتركون حاليًا', d.active_subscribers, '', '#/admin/students'],
    ['الإيرادات', fmtMoney(d.revenue_egp), 'مدفوعات مؤكدة', '#/admin/payments?status=paid'],
    ['إيصالات للمراجعة', d.receipts_pending_review, '', '#/admin/payments'],
    ['الأسئلة', d.questions, '', '#/admin/questions'],
    ['تكلفة الذكاء الاصطناعي', fmtMoney(d.ai_cost_egp, 3), `${d.students_at_ai_limit} طالب عند الحد`, '#/admin/settings'],
    ['الفرق', d.teams, '', '#/admin/teams'],
    ['اشتراكات تنتهي خلال 7 أيام', d.expiring_soon, d.expiring_soon ? 'تواصل معهم للتجديد' : '', '#/admin/students?expiring=7'],
  ];
  el.innerHTML = `<h1 class="page-head">لوحة التحكم</h1>
    <section class="tiles">${tiles.map(([l, v, s, href]) => `<a href="${href}" class="tile"><span class="tile-label">${l}</span><b>${esc(v)}</b><small>${esc(s)}</small></a>`).join('')}</section>
    <section class="card"><h2>إجراءات سريعة</h2><div class="row wrap">
      <a class="btn primary" href="#/admin/questions">إضافة أسئلة</a>
      <a class="btn ghost" href="#/admin/subjects">المواد والدروس</a>
      <a class="btn ghost" href="#/admin/payments">مراجعة الإيصالات</a>
      <a class="btn ghost" href="#/admin/announcements">إعلان للطلاب</a>
      <a class="btn ghost" href="#/admin/competitions">إنشاء مسابقة</a>
      <a class="btn ghost" href="#/admin/plans">الباقات والأسعار</a>
      <a class="btn ghost" href="#/admin/settings">الإعدادات</a>
      <a class="btn ghost" href="#/admin/students">تقارير أولياء الأمور</a></div></section>`;
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
        ${s.lessons.length > 1 ? `<button class="btn ghost tiny" data-action="mergeLesson" data-id="${l.id}" data-subject="${s.id}">🔀 دمج في درس آخر</button>` : ''}
        <button class="btn danger tiny" data-action="deleteLesson" data-id="${l.id}" data-name="${esc(l.name)}">حذف</button></span></li>`).join('')}</ul>` : '<p class="muted">لا توجد دروس بعد.</p>'}
      <form class="form inline" data-add-lesson="${s.id}"><input name="name" required placeholder="درس جديد"><input name="lesson_type" placeholder="نوع الدرس (اختياري)"><button class="btn ghost" type="submit">إضافة درس</button></form>
    </section>`).join('') : empty('لا توجد مواد بعد. أضف مادة أو ارفع شيت أسئلة.')}`;

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
    mergeLesson: (b) => {
      const s = subjects.find((x) => String(x.id) === b.dataset.subject);
      const l = s.lessons.find((x) => String(x.id) === b.dataset.id);
      const m = modal(`<h2>🔀 دمج «${esc(l.name)}»</h2>
        <p class="muted">تنتقل كل أسئلة هذا الدرس (${l.questions} سؤال) إلى الدرس الذي تختاره، ثم يُحذف هذا الدرس. لا تُحذف أي أسئلة ولا إجابات.</p>
        <form class="form" id="mf"><label>انقل الأسئلة إلى درس<select name="into" required>
          ${s.lessons.filter((x) => x.id !== l.id).map((x) => opt(x.id, `${x.name} (${x.questions} سؤال)`)).join('')}</select></label>
          <button class="btn primary" type="submit">دمج</button></form>`);
      onSubmit($('#mf', m), async (v) => {
        const r = await API.post(`/admin/lessons/${l.id}/merge`, { into_lesson_id: Number(v.into) });
        closeModal();
        toast(`تم نقل ${r.moved} سؤال وحذف «${l.name}»`);
        reload();
      });
    },
    deleteLesson: (b) => run(b, async () => {
      if (!confirm(`حذف درس "${b.dataset.name}"؟ ستبقى أسئلته في المادة بدون درس.`)) return;
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
    ${q?.passage ? `<fieldset class="features-box admin-passage"><legend>📖 القطعة / الرسمة المشتركة (#${q.passage.id})</legend>
      <p class="muted hint">⚠️ هذه القطعة مشتركة بين كل أسئلتها — أي تعديل هنا يُطبَّق عليها جميعًا.</p>
      <label>نص القطعة<textarea name="passage_text" rows="6">${esc(q.passage.text || '')}</textarea></label>
      <div class="media-slot">
        <b>صورة القطعة / الرسمة</b>
        ${q.passage.image ? `<img src="${esc(q.passage.image)}" alt="صورة القطعة"><label class="check"><input type="checkbox" name="rm_passage_image"> حذف الصورة</label>` : ''}
        <input type="file" name="img_passage" accept="image/png,image/jpeg,image/webp,image/gif">
      </div>
      <label class="check"><input type="checkbox" name="unlink_passage"> فصل هذا السؤال فقط عن القطعة</label>
    </fieldset>` : ''}
    <label>نص السؤال<textarea name="question_text" rows="3">${esc(q?.question_text || '')}</textarea></label>
    <p class="muted hint">✏️ الأس: اكتب <code>10^8</code> أو <code>10^{-19}</code> ← 10<sup>8</sup> · الرقم الصغير تحت: <code>H_2O</code> ← H<sub>2</sub>O</p>
    <div class="math-preview" aria-live="polite"></div>
    <div class="grid2">${['a', 'b', 'c', 'd'].map((k, i) => `<label>${'أبجد'[i]}<input name="option_${k}" value="${esc(q?.[`option_${k}`] || '')}"></label>`).join('')}</div>
    <fieldset class="features-box"><legend>الصور (اختياري — يمكن أن يكون السؤال أو الاختيار صورة فقط)</legend>
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
    <label>الشرح (يظهر للطالب مجانًا بدلًا من الذكاء الاصطناعي)<textarea name="explanation" rows="4">${esc(q?.explanation || '')}</textarea></label>
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
  if (!subjects.length) { toast('أضف مادة أولًا من صفحة المواد', 'err'); return; }
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
    preview.innerHTML = parts.some((t) => rich(t) !== esc(t))
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
    if (!v.question_text && !keeps('question')) throw new Error('اكتب نص السؤال أو أضف صورة له');
    // C and D both empty = two-option question (e.g. true / false); otherwise all four are needed.
    const two = !v.option_c && !keeps('option_c') && !v.option_d && !keeps('option_d');
    for (const [k, L] of [['option_a', 'أ'], ['option_b', 'ب'], ['option_c', 'ج'], ['option_d', 'د']]) {
      if (two && (k === 'option_c' || k === 'option_d')) continue;
      if (!v[k] && !keeps(k)) throw new Error(`الاختيار ${L} يحتاج إلى نص أو صورة (أو اترك ج و د فارغين معًا لسؤال باختيارين)`);
    }
    if (two && !['A', 'B'].includes(v.correct_option)) throw new Error('السؤال له اختياران فقط — الإجابة الصحيحة لازم تكون أ أو ب');
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
    const p = q?.passage;
    if (p && !v.unlink_passage) {
      // Shared passage: saved before the question so the question's duplicate check uses the new passage.
      const newText = (v.passage_text ?? '').trim();
      const passageImage = f.img_passage.files[0];
      if (!newText && (v.rm_passage_image || !p.image) && !passageImage) throw new Error('يجب أن تحتوي القطعة على نص أو صورة');
      if (passageImage) {
        const fd = new FormData();
        fd.append('image', await prepareImage(passageImage), passageImage.name);
        await API.req('PUT', `/admin/passages/${p.id}/image`, undefined, { form: fd });
      }
      if (newText !== (p.text || '')) await API.patch(`/admin/passages/${p.id}`, { passage_text: newText });
      if (v.rm_passage_image && p.image && !passageImage) await API.del(`/admin/passages/${p.id}/image`);
    }
    if (p && v.unlink_passage) await API.del(`/admin/questions/${q.id}/passage`);
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
  for (const k of ['search', 'subject_id', 'lesson_id', 'category', 'upload_id']) if (query[k]) qs.set(k, query[k]);
  if (query.missing === '1') qs.set('missing_explanation', 'true');
  const [list, { subjects }, { uploads }] = await Promise.all([API.get(`/admin/questions?${qs}`), API.get('/admin/subjects'), API.get('/admin/questions/uploads')]);
  const fromSheet = query.upload_id ? uploads.find((u) => String(u.id) === query.upload_id) : null;
  const kb = (n) => (n ? `${Math.max(1, Math.round(n / 1024)).toLocaleString('en')} KB` : '');
  const curSubject = subjects.find((s) => String(s.id) === query.subject_id);

  el.innerHTML = `<div class="page-head"><h1>بنك الأسئلة</h1><button class="btn primary" data-action="new">+ سؤال جديد</button></div>
    <section class="card"><div class="card-head"><h2>رفع شيت Excel</h2><button class="btn ghost tiny" data-action="template">⬇ تحميل النموذج</button></div>
      <p class="muted">الأعمدة: السؤال · صورة السؤال · أ · ب · ج · د · الإجابة الصحيحة · الشرح · القانون/الملحوظة · المادة · الدرس · نوع الدرس · التصنيف (درس / امتحان سابق) · سنة الامتحان. تُضاف المواد والدروس الجديدة تلقائيًا.</p>
      <p class="muted">🖼 <b>الصور:</b> الصق الصورة داخل صف السؤال (Insert ← Pictures ← <b>Place over Cells</b>). في عمود "صورة السؤال" = صورة السؤال، في عمود اختيار = صورة الاختيار، في عمود الشرح = صورة الشرح. الحد الأقصى للملف 4MB وللصورة الواحدة 2MB — إذا كانت الصور كثيرة فقسّم الأسئلة على عدة ملفات.</p>
      <p class="muted">📖 <b>القطع والرسومات المشتركة (اختياري):</b> أعمدة <b>رقم القطعة</b> · <b>القطعة</b> · <b>صورة القطعة</b>. الأسئلة التي لها نفس "رقم القطعة" تُربط بقطعة واحدة تبقى ثابتة فوق أسئلتها ويتنقل الطالب بينها. اكتب نص القطعة (أو الصق الرسمة في عمود "صورة القطعة") مرة واحدة في أي صف من صفوفها — أو في صف مستقل يحتوي على رقم القطعة فقط بدون سؤال.</p>
      <form id="uf" class="form grid3">
        <label class="span2">ملف .xlsx (حتى 4MB)<input type="file" name="file" accept=".xlsx" required></label>
        <label>مادة افتراضية (إذا لم يوجد عمود مادة)<input name="default_subject"></label>
        <label class="check"><input type="checkbox" name="dry_run"> فحص فقط بدون حفظ</label>
        <button class="btn primary" type="submit">رفع</button>
      </form>
      <div id="result"></div>
    </section>
    <section class="card" id="sheets"><details class="sheets-box" ${uploads.length <= 5 ? 'open' : ''}><summary><h2>📚 الشيتات المرفوعة ${badge(uploads.length)}</h2></summary>
      <p class="muted small">كل شيت رفعته وأسئلته. «حذف الشيت» يحذف كل الأسئلة التي أُضيفت منه مرة واحدة (الأسئلة المكررة التي تجاهلها الرفع تتبع شيتها الأصلي).</p>
      ${uploads.length ? table(['الشيت', 'الأسئلة', 'المواد', 'إجابات الطلاب', ''], uploads.map((u) => [
        `<b>${esc(u.filename || `شيت #${u.id}`)}</b><br><small class="muted">${fmtDate(u.created_at)}${u.admin_name ? ` · ${esc(u.admin_name)}` : ''}${u.file_size ? ` · ${kb(u.file_size)}` : ''}</small>`,
        `<b>${u.questions}</b>${u.hidden ? ` ${badge(`${u.hidden} مخفي`, 'bad')}` : ''}${u.duplicates ? `<br><small class="muted">${u.duplicates} مكرر تم تجاهله</small>` : ''}`,
        esc(u.subjects.join('، ')),
        u.answered ? `${u.answered} سؤال` : '<span class="muted">لا يوجد</span>',
        `<div class="row wrap"><a class="btn ghost tiny" href="#/admin/questions?upload_id=${u.id}">عرض الأسئلة</a>
          ${u.has_file ? `<button class="btn ghost tiny" data-action="sheetFile" data-id="${u.id}">⬇ تحميل</button>` : ''}
          <button class="btn danger tiny" data-action="sheetDel" data-id="${u.id}">🗑️ حذف الشيت</button></div>`])) : empty('لم تُرفع شيتات بعد')}
    </details></section>
    <section class="card"><div class="card-head"><h2>الأسئلة ${badge(list.total)}</h2></div>
      ${query.upload_id ? `<p class="notice mid">📚 أسئلة الشيت «${esc(fromSheet?.filename || `#${query.upload_id}`)}» فقط. <a href="#/admin/questions">عرض كل الأسئلة</a></p>` : ''}
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
            + (q.passage ? ` <span class="q-passage-tag" title="${esc((q.passage.text || 'رسمة').slice(0, 120))}">${q.passage.text ? '📖' : '🖼️'} قطعة #${q.passage.id}</span>` : '')
            + (q.is_active ? '' : ` ${badge('مخفي', 'bad')}`),
          `${esc(q.subject)}<br><small class="muted">${esc(q.lesson || '')}</small>`,
          esc(LABELS.category[q.category]) + (q.exam_year ? `<br><small class="muted">${q.exam_year}</small>` : ''),
          `<b>${letter(q.correct_option)}</b>`, q.explanation ? '✓' : badge('لا يوجد', 'mid'),
          `<div class="row"><button class="btn ghost tiny" data-action="edit" data-id="${q.id}">تعديل</button>
            <button class="btn danger tiny" data-action="del" data-id="${q.id}">حذف</button></div>`])) : empty('لا توجد أسئلة بهذه التصفية')}
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
        ? `فحص: ${r.valid_rows} صف سليم (بها ${r.images} صورة${r.passages ? ` و${r.passages} قطعة/رسمة مشتركة` : ''})، ${r.failed} صف به أخطاء`
        : `تمت إضافة <b>${r.inserted}</b> سؤال و${r.images} صورة${r.passages ? ` و${r.passages} قطعة/رسمة مشتركة` : ''} · مكرر (تم تجاهله): ${r.duplicates} · به أخطاء: ${r.failed}`}</div>
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
    sheetFile: (b) => run(b, async () => {
      const u = uploads.find((x) => String(x.id) === b.dataset.id);
      const blob = await API.blob(`/admin/questions/uploads/${u.id}/file`);
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: u.filename || `sheet-${u.id}.xlsx` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }),
    sheetDel: (b) => run(b, async () => {
      const u = uploads.find((x) => String(x.id) === b.dataset.id);
      if (!confirm(`حذف الشيت «${u.filename || `#${u.id}`}» وكل أسئلته (${u.questions} سؤال)؟`)) return;
      let force = false;
      if (u.answered) {
        force = confirm(`${u.answered} سؤال من هذا الشيت أجاب عنه طلاب.\n\n• «موافق» = حذفها نهائيًا مع إجابات الطلاب عليها (تُمسح من إحصائياتهم وبنك الأخطاء).\n• «إلغاء» = إخفاؤها عن الطلاب فقط مع الاحتفاظ بإحصائياتهم، وحذف باقي الأسئلة.`);
      }
      const r = await API.del(`/admin/questions/uploads/${u.id}${force ? '?force=true' : ''}`);
      toast(`تم حذف ${r.deleted} سؤال${r.hidden ? ` وإخفاء ${r.hidden}` : ''} من «${r.filename || 'الشيت'}»`);
      if (query.upload_id) location.hash = '#/admin/questions'; else reload();
    }),
    edit: (b) => openQuestionModal(list.items.find((x) => String(x.id) === b.dataset.id), subjects, reload),
    del: (b) => run(b, async () => {
      if (!confirm('حذف السؤال؟')) return;
      const id = b.dataset.id;
      let r = await API.del(`/admin/questions/${id}`);
      // Already answered: it was hidden; offer to delete it for good.
      if (r.hidden && confirm(`تمت الإجابة عن هذا السؤال من قبل (${r.answers} إجابة)، لذلك أُخفي عن الطلاب.\n\nهل تريد حذفه نهائيًا؟ سيؤدي ذلك إلى مسح إجاباته من إحصائيات الطلاب وبنك الأخطاء، ولا يمكن استرجاعه.`)) {
        r = await API.del(`/admin/questions/${id}?force=true`);
      }
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
          <button class="btn danger tiny" data-action="reject" data-id="${p.id}">رفض</button>` : esc(p.admin_note || '')}
        <button class="btn ghost tiny" data-action="del" data-id="${p.id}" data-status="${p.status}" title="حذف العملية">🗑️</button></div>`]))
      : empty('لا توجد عمليات هنا')}</section>`;
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
    del: (b) => {
      const p = items.find((x) => String(x.id) === b.dataset.id);
      const paid = p.status === 'paid';
      const m = modal(`<h2>🗑️ حذف العملية؟</h2>
        <p>${esc(p.full_name)} — ${esc(p.plan_code)} — <b>${fmtMoney(p.amount_egp)}</b> (${esc(LABELS.paymentStatus[p.status])})</p>
        <p class="notice bad">ستُحذف العملية وصورة الإيصال نهائيًا${paid ? '، وستقل الإيرادات بهذا المبلغ' : ''}.</p>
        <form class="form" id="pdf">
          ${paid ? `<label class="check"><input type="checkbox" name="cancel_subscription"> إلغاء الاشتراك الذي حصل عليه الطالب بهذا الدفع أيضًا</label>
            <p class="muted small">إذا لم تحدده، يظل اشتراك الطالب ساريًا كالمعتاد.</p>` : ''}
          <button class="btn danger" type="submit">حذف</button></form>`);
      onSubmit($('#pdf', m), async (v) => {
        const r = await API.req('DELETE', `/admin/payments/${p.id}`, { cancel_subscription: Boolean(v.cancel_subscription) });
        closeModal();
        toast(r.subscription_cancelled ? 'تم حذف العملية وإلغاء الاشتراك' : 'تم حذف العملية');
        reload();
      });
    },
    reject: (b) => {
      const m = modal(`<h2>رفض الإيصال</h2><form class="form" id="rf"><label>السبب (سيظهر للطالب)<input name="note" required minlength="3" value="الإيصال غير واضح أو المبلغ غير مطابق"></label>
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
      <label title="الباقة الأعلى في الترتيب تُعتبر الأفضل وتظهر في النهاية">ترتيب العرض<input type="number" name="rank" min="0" max="100" required value="${esc(p?.rank ?? 1)}"></label>
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
    <p class="muted">تغيير السعر أو المدة يُطبَّق على الاشتراكات الجديدة. إلغاء ميزة من باقة يغلقها فورًا على المشتركين فيها.</p>
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
/**
 * Question picker for competitions: filter by subject / lesson / category / text, tick questions (kept across
 * filters and pages). `selected` is a Set of question ids, updated in place; onDone runs on the main button.
 */
function pickQuestions({ subjects, selected, title = 'اختر أسئلة المسابقة', saveLabel = 'تم', onDone }) {
  const m = modal(`<h2>${esc(title)}</h2>
    <form class="form grid3" id="pkf">
      <label>المادة<select name="subject_id"><option value="">كل المواد</option>${subjects.map((s) => opt(s.id, s.name)).join('')}</select></label>
      <label>الدرس<select name="lesson_id"><option value="">كل الدروس</option></select></label>
      <label>التصنيف<select name="category"><option value="">الكل</option><option value="lesson">دروس</option><option value="past_exam">امتحانات سابقة</option></select></label>
      <label class="span3">بحث في نص السؤال<input name="search" placeholder="كلمة من السؤال"></label>
    </form>
    <div class="row wrap pick-bar"><span class="badge good" id="pk-count"></span>
      <button class="btn ghost tiny" type="button" id="pk-page">اختر كل الظاهر</button>
      <button class="btn ghost tiny" type="button" id="pk-clear">إلغاء الاختيار</button></div>
    <div id="pk-list" class="pick-list"></div>
    <button class="btn ghost tiny" type="button" id="pk-more" hidden>عرض المزيد</button>
    <button class="btn primary big-btn" type="button" id="pk-done"></button>`);
  const f = $('#pkf', m);
  let page = 1;
  let items = [];
  const count = () => {
    $('#pk-count', m).textContent = `${selected.size} سؤال مختار`;
    $('#pk-done', m).textContent = `${saveLabel} (${selected.size} سؤال)`;
  };
  const row = (q) => `<label class="pick-q"><input type="checkbox" value="${q.id}" ${selected.has(q.id) ? 'checked' : ''}>
    <span class="pick-body"><span class="pick-text">${rich(q.question_text || '(سؤال صورة)')}</span>
      <small class="muted"><span class="mono">#${q.id}</span> · ${esc(q.subject)}${q.lesson ? ` · ${esc(q.lesson)}` : ''}${q.category === 'past_exam' ? ' · امتحان سابق' : ''}${q.passage ? ' · 📄 قطعة' : ''}</small></span></label>`;
  async function load(reset) {
    if (reset) { page = 1; items = []; }
    const v = formValues(f);
    const qs = new URLSearchParams({ limit: 50, page });
    for (const k of ['subject_id', 'lesson_id', 'category', 'search']) if (v[k]) qs.set(k, v[k]);
    const r = await API.get(`/admin/questions?${qs}`);
    items = items.concat(r.items.filter((q) => q.is_active)); // hidden questions can't be in a competition
    $('#pk-list', m).innerHTML = items.length ? items.map(row).join('') : empty('لا توجد أسئلة بهذا الفلتر');
    $('#pk-more', m).hidden = page * 50 >= r.total;
  }
  f.subject_id.addEventListener('change', () => {
    const s = subjects.find((x) => String(x.id) === f.subject_id.value);
    f.lesson_id.innerHTML = `<option value="">كل الدروس</option>${(s?.lessons || []).map((l) => opt(l.id, l.name)).join('')}`;
  });
  f.addEventListener('change', (e) => { if (e.target.name !== 'search') load(true); });
  let t;
  f.search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load(true), 400); });
  f.addEventListener('submit', (e) => e.preventDefault());
  $('#pk-list', m).addEventListener('change', (e) => {
    const id = Number(e.target.value);
    if (e.target.checked) selected.add(id); else selected.delete(id);
    count();
  });
  $('#pk-page', m).addEventListener('click', () => {
    items.forEach((q) => selected.add(q.id));
    $$('#pk-list input', m).forEach((c) => { c.checked = true; });
    count();
  });
  $('#pk-clear', m).addEventListener('click', () => {
    selected.clear();
    $$('#pk-list input', m).forEach((c) => { c.checked = false; });
    count();
  });
  $('#pk-more', m).addEventListener('click', (e) => run(e.target, () => { page++; return load(false); }));
  $('#pk-done', m).addEventListener('click', (e) => run(e.target, async () => {
    if (!selected.size) throw new Error('اختر سؤالًا واحدًا على الأقل');
    await onDone?.();
    closeModal();
  }));
  count();
  load(true);
}

Admin.competitions = async (el) => {
  const [{ competitions }, { subjects }] = await Promise.all([API.get('/competitions'), API.get('/admin/subjects')]);
  const now = new Date();
  el.innerHTML = `<h1 class="page-head">المسابقات</h1>
    <section class="card"><h2>مسابقة جديدة</h2>
      <form id="cf" class="form grid3">
        <label class="span2">العنوان<input name="title" required value="مسابقة الجمعة"></label>
        <label>النوع<select name="type"><option value="team_weekly">فرق (أسبوعية)</option><option value="individual_monthly">فردية (شهرية)</option></select></label>
        <label>تبدأ<input type="datetime-local" name="starts_at" required value="${toLocalInput(now)}"></label>
        <label>تنتهي<input type="datetime-local" name="ends_at" required value="${toLocalInput(new Date(now.getTime() + 2 * 3600000))}"></label>
        <label>مدة الحل (دقيقة)<input type="number" name="duration_minutes" min="1" max="600" value="30"></label>
        <div class="span3 q-mode"><b>الأسئلة:</b>
          <label class="check"><input type="radio" name="q_mode" value="random" checked> 🎲 عشوائي من البنك</label>
          <label class="check"><input type="radio" name="q_mode" value="manual"> ✋ أختارها بنفسي</label>
          <label class="check"><input type="radio" name="q_mode" value="own"> ✍️ أسئلة خاصة فقط</label></div>
        <div class="span3 grid3" id="q-random">
          <label>عدد الأسئلة<input type="number" name="count" min="1" max="200" value="10"></label>
          <label>المادة<select name="subject_id"><option value="">كل المواد</option>${subjects.map((s) => opt(s.id, `${s.name} (${s.questions})`)).join('')}</select></label>
          <label>الدرس<select name="lesson_id"><option value="">كل الدروس</option></select></label>
          <label>التصنيف<select name="category"><option value="">الكل</option><option value="lesson">دروس</option><option value="past_exam">امتحانات سابقة</option></select></label>
        </div>
        <div class="span3" id="q-manual" hidden>
          <button class="btn ghost" type="button" data-action="pick">✋ اختر الأسئلة <span class="badge" id="picked-count">0 مختار</span></button>
        </div>
        <div class="span3 own-qs">
          <h3>✍️ أسئلة خاصة بالمسابقة <small class="muted">(اختياري — تظهر في هذه المسابقة فقط ولا تُضاف إلى بنك الأسئلة)</small></h3>
          <div class="row wrap own-tools">
            <label>مادة الأسئلة<select name="own_subject">${subjects.map((s) => opt(s.id, s.name)).join('')}</select></label>
            <button class="btn ghost" type="button" data-action="ownAdd">➕ إضافة سؤال</button>
            <label class="btn ghost file-btn">📄 رفع شيت Excel<input type="file" id="own-file" accept=".xlsx" hidden></label>
          </div>
          <div id="own-list"></div>
        </div>
        <button class="btn primary span3" type="submit">إنشاء المسابقة</button>
      </form></section>
    <section class="card"><h2>كل المسابقات</h2>${competitions.length ? table(['المسابقة', 'النوع', 'الوقت', 'الحالة', ''],
      competitions.map((c) => [`${esc(c.title)}<br><small class="muted">${c.question_count} سؤال · ${c.duration_minutes} د</small>`, esc(LABELS.compType[c.type]),
        `${fmtDate(c.starts_at)}<br><small class="muted">${fmtDate(c.ends_at)}</small>`,
        `${badge(LABELS.compStatus[c.status], LABELS.compTone[c.status])}<br>${c.results_published ? badge('📢 النتيجة معلنة', 'good') : badge('🔒 النتيجة مخفية', 'mid')}`,
        `<div class="row">${c.results_published
          ? `<button class="btn ghost tiny" data-action="unpublish" data-id="${c.id}">🔒 إخفاء النتيجة</button>`
          : `<button class="btn primary tiny" data-action="publish" data-id="${c.id}">📢 إعلان النتيجة</button>`}
          <a class="btn ghost tiny" href="#/competition/${c.id}">الترتيب</a>
          <button class="btn ghost tiny" data-action="questions" data-id="${c.id}">الأسئلة</button>
          <button class="btn ghost tiny" data-action="edit" data-id="${c.id}">تعديل</button>
          <button class="btn danger tiny" data-action="del" data-id="${c.id}">حذف</button></div>`])) : empty('لا توجد مسابقات')}</section>`;
  const reload = () => Admin.competitions(el);
  // Questions: random from the bank (subject / lesson / category) or picked one by one.
  const picked = new Set();
  const cf = $('#cf', el);
  const showMode = () => {
    const mode = cf.q_mode.value;
    $('#q-random', el).hidden = mode !== 'random';
    $('#q-manual', el).hidden = mode !== 'manual';
  };
  // The competition's own questions (typed here or from an Excel sheet): saved right away, attached on "create".
  const own = [];
  const LETTER = { A: 'أ', B: 'ب', C: 'ج', D: 'د' };
  const showOwn = () => {
    $('#own-list', el).innerHTML = own.length
      ? `<p class="muted small">${own.length} سؤال خاص</p>${table(['#', 'السؤال', 'الإجابة', ''], own.map((q, i) => [i + 1,
        `${q.question_text ? rich(q.question_text) : '<i class="muted">(سؤال بصورة)</i>'}${q.image ? ' 🖼️' : ''}`,
        `<b>${LETTER[q.correct_option]}</b>`, `<button class="btn ghost tiny" type="button" data-action="ownRemove" data-i="${i}">إزالة</button>`]))}`
      : '';
  };
  $('#own-file', el).addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    run(e.target.closest('label'), async () => {
      const fd = new FormData();
      fd.append('file', file);
      const s = subjects.find((x) => String(x.id) === cf.own_subject.value);
      if (s) fd.append('default_subject', s.name);
      const r = await API.upload('/admin/competition-questions/upload', fd);
      own.push(...r.questions);
      showOwn();
      toast(`أُضيف ${r.questions.length} سؤال من الشيت${r.failed ? ` — ${r.failed} صف به أخطاء` : ''}`, r.failed ? 'err' : 'ok');
    });
  });
  cf.querySelectorAll('[name=q_mode]').forEach((r) => r.addEventListener('change', showMode));
  cf.subject_id.addEventListener('change', () => {
    const s = subjects.find((x) => String(x.id) === cf.subject_id.value);
    cf.lesson_id.innerHTML = `<option value="">كل الدروس</option>${(s?.lessons || []).map((l) => opt(l.id, `${l.name} (${l.questions})`)).join('')}`;
  });
  const showPicked = () => { $('#picked-count', el).textContent = `${picked.size} مختار`; };
  onSubmit(cf, async (v) => {
    const mode = v.q_mode;
    if (mode === 'manual' && !picked.size) throw new Error('اختر الأسئلة أولًا (زر «اختر الأسئلة»)');
    if (mode === 'own' && !own.length) throw new Error('أضف أسئلة خاصة أولًا (زر «إضافة سؤال» أو «رفع شيت Excel»)');
    const r = await API.post('/admin/competitions', {
      title: v.title, type: v.type,
      starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(),
      duration_minutes: Number(v.duration_minutes),
      ...(mode === 'manual' ? { question_ids: [...picked] } : {}),
      ...(mode === 'random' ? { random: { count: Number(v.count), subject_id: num(v.subject_id), lesson_id: num(v.lesson_id), category: v.category } } : {}),
      ...(own.length ? { extra_question_ids: own.map((q) => q.id) } : {}),
    });
    toast(`تم إنشاء المسابقة بـ ${r.competition.question_count} سؤال${r.competition.extra_questions ? ` (منها ${r.competition.extra_questions} خاص)` : ''}`);
    reload();
  });
  onAction(el, {
    pick: () => pickQuestions({ subjects, selected: picked, onDone: showPicked }),
    ownRemove: (b) => { own.splice(Number(b.dataset.i), 1); showOwn(); },
    ownAdd: () => {
      const m = modal(`<h2>➕ سؤال خاص بالمسابقة</h2>
        <p class="muted small">المادة: ${esc(subjects.find((x) => String(x.id) === cf.own_subject.value)?.name || '')} — يظهر في هذه المسابقة فقط.</p>
        <form class="form" id="oqf">
          <label>نص السؤال<textarea name="question_text" rows="3" placeholder="اكتب السؤال (أو ارفع صورة له فقط)"></textarea></label>
          <label>صورة السؤال (اختياري)<input type="file" name="image" accept="image/png,image/jpeg,image/gif,image/webp"></label>
          <div class="grid2">
            <label>أ<input name="option_a" required></label><label>ب<input name="option_b" required></label>
            <label>ج<input name="option_c" placeholder="اتركه فارغًا لسؤال باختيارين"></label><label>د<input name="option_d" placeholder="اتركه فارغًا لسؤال باختيارين"></label>
          </div>
          <label>الإجابة الصحيحة<select name="correct_option" required><option value="">اختر</option>
            <option value="A">أ</option><option value="B">ب</option><option value="C">ج</option><option value="D">د</option></select></label>
          <label>الشرح (اختياري — يظهر للطالب بعد إعلان النتيجة)<textarea name="explanation" rows="2"></textarea></label>
          <button class="btn primary" type="submit">إضافة السؤال</button>
        </form>`);
      onSubmit($('#oqf', m), async (v, form) => {
        const img = form.image.files[0];
        if (!v.question_text && !img) throw new Error('اكتب نص السؤال أو ارفع صورة له');
        const fd = new FormData();
        fd.append('subject_id', cf.own_subject.value);
        for (const k of ['question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'explanation']) if (v[k]) fd.append(k, v[k]);
        if (img) fd.append('image', img);
        const r = await API.upload('/admin/competition-questions', fd);
        own.push(r.question);
        showOwn();
        closeModal();
        toast('تمت إضافة السؤال');
      });
    },
    publish: (b) => run(b, async () => {
      const c = competitions.find((x) => String(x.id) === b.dataset.id);
      if (!confirm(`إعلان نتيجة «${c.title}»؟\nسيرى الطلاب درجاتهم والترتيب والإجابات الصحيحة${c.status === 'finished' ? '' : ' (تظهر الإجابات الصحيحة بعد انتهاء المسابقة)'}، وستُضاف إجاباتهم إلى بنك الأخطاء.`)) return;
      await API.post(`/admin/competitions/${c.id}/publish`);
      toast('📢 تم إعلان النتيجة للطلاب');
      reload();
    }),
    unpublish: (b) => run(b, async () => {
      if (!confirm('إخفاء النتيجة عن الطلاب مرة أخرى؟')) return;
      await API.post(`/admin/competitions/${b.dataset.id}/unpublish`);
      toast('🔒 تم إخفاء النتيجة');
      reload();
    }),
    questions: (b) => run(b, async () => {
      const c = competitions.find((x) => String(x.id) === b.dataset.id);
      const { questions } = await API.get(`/admin/competitions/${c.id}/questions`);
      const sel = new Set(questions.filter((q) => !q.competition_only).map((q) => q.id));
      const ownCount = questions.filter((q) => q.competition_only).length;
      if (ownCount) toast(`هذه المسابقة فيها ${ownCount} سؤال خاص — تبقى كما هي، والاختيار هنا لأسئلة البنك فقط`);
      pickQuestions({
        subjects, selected: sel, title: `أسئلة «${c.title}»`,
        saveLabel: 'حفظ الأسئلة',
        onDone: async () => {
          const r = await API.put(`/admin/competitions/${c.id}/questions`, { question_ids: [...sel] });
          toast(`تم حفظ ${r.question_count} سؤال`);
          reload();
        },
      });
    }),
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
  el.innerHTML = `<h1 class="page-head">الفرق</h1>
    <section class="card"><h2>توزيع الطلاب بدون فريق</h2>
      <p class="muted">يعمل تلقائيًا كل خميس. يُكمل الفرق الناقصة أولًا، ثم يقسم الباقين إلى فرق متوازنة.</p>
      <div class="row wrap"><label class="check"><input type="checkbox" id="reqsub" checked> المشتركون فقط</label>
      <button class="btn primary" data-action="assign">وزّع الآن</button></div><div id="assign-result"></div></section>
    <form id="sf" class="form inline"><input name="search" value="${esc(search)}" placeholder="اسم الفريق أو كود/اسم طالب"><button class="btn ghost" type="submit">بحث</button></form>
    ${teams.length ? `<div class="grid-cards">${teams.map((t) => `<section class="card">
      <div class="card-head"><h2>${esc(t.name)}</h2><span class="row">${badge(`${t.members.length}/${max}`, t.members.length === max ? 'good' : 'mid')}${t.is_auto_generated ? badge('تلقائي') : ''}</span></div>
      <ul class="list">${t.members.map((m) => `<li><span>${m.id === t.captain_id ? '👑 ' : ''}${esc(m.full_name)} <small class="mono muted">${esc(m.student_code)}</small></span>
        <button class="btn ghost tiny" data-action="remove" data-team="${t.id}" data-user="${m.id}">إزالة</button></li>`).join('')}</ul>
      ${t.members.length < max ? `<form class="form inline" data-add-member="${t.id}"><input name="student_code" required placeholder="كود الطالب" class="mono"><button class="btn ghost tiny" type="submit">إضافة</button></form>` : ''}
      <div class="row"><button class="btn ghost tiny" data-action="edit" data-id="${t.id}">تعديل</button>
        <button class="btn danger tiny" data-action="del" data-id="${t.id}">حذف الفريق</button></div>
    </section>`).join('')}</div>` : empty('لا توجد فرق')}`;
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
      toast(`تم توزيع ${r.eligible} طالب: ${r.added_to_existing} في فرق ناقصة و${r.new_teams.length} فريق جديد`);
      reload();
    }),
    remove: (b) => run(b, async () => {
      if (!confirm('إزالة الطالب من الفريق؟')) return;
      await API.del(`/admin/teams/${b.dataset.team}/members/${b.dataset.user}`);
      reload();
    }),
    del: (b) => run(b, async () => {
      if (!confirm('حذف الفريق؟ سيصبح أعضاؤه بدون فريق.')) return;
      await API.del(`/admin/teams/${b.dataset.id}`);
      reload();
    }),
    edit: (b) => {
      const t = teams.find((x) => String(x.id) === b.dataset.id);
      const m = modal(`<h2>تعديل الفريق</h2><form class="form" id="tf">
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
  const expiring = Number(query.expiring) || 0;
  const { items } = await API.get(`/admin/students?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}${expiring ? `&expiring=${expiring}` : ''}`);
  el.innerHTML = `<div class="page-head"><h1>الطلاب</h1><button class="btn primary" data-action="new">+ طالب جديد</button>
      <button class="btn parent" data-action="reportsAll">📨 إرسال تقارير أولياء الأمور على واتساب</button></div>
    ${expiring ? `<p class="notice mid">⏰ الطلاب الذين ينتهي اشتراكهم خلال ${expiring} أيام ولم يجددوا بعد — تواصل معهم على واتساب للتجديد. <a href="#/admin/students">عرض كل الطلاب</a></p>` : ''}
    <section class="card"><form id="sf" class="form inline"><input name="search" value="${esc(search)}" placeholder="كود الطالب، الإيميل، الاسم أو رقم الموبايل (الطالب أو ولي الأمر)"><button class="btn ghost" type="submit">بحث</button></form>
    ${items.length ? table(['الكود', 'الاسم', 'التواصل', 'الاشتراك', 'الحالة', ''],
      items.map((s) => [s.student_code ? `<span class="mono">${esc(s.student_code)}</span>` : badge('لم يكمل التسجيل', 'mid'), esc(s.full_name),
        `${esc(s.email)}<br><small class="muted">طالب ${esc(s.phone)} · ولي أمر ${esc(s.parent_phone)}</small>`,
        s.current_plan ? `${badge(s.current_plan, 'good')}<br><small class="muted">حتى ${fmtDay(s.plan_ends_at)}</small>` : badge('بدون', ''),
        `${s.is_verified ? '' : badge('غير مفعّل', 'mid')} ${s.is_active ? badge('نشط', 'good') : badge('موقوف', 'bad')}
          ${s.blocked_device_attempts ? `<span title="محاولات دخول من أجهزة زائدة في آخر 30 يومًا">${badge(`⚠️ أجهزة زائدة ×${s.blocked_device_attempts}`, 'bad')}</span>` : ''}
          <br><small class="muted">📱 ${s.devices}/2</small>`,
        `<div class="row"><a class="btn primary tiny" href="#/admin/student/${s.id}">إدارة</a>
          ${waLink(s.phone) ? `<a class="btn wa tiny" href="${waLink(s.phone)}" target="_blank" rel="noopener" title="فتح شات واتساب مع الطالب">💬 واتساب الطالب</a>` : ''}
          ${s.student_code ? `<button class="btn parent tiny" data-action="wa" data-id="${s.id}" title="إرسال تقرير الأسبوع لولي الأمر على واتساب">📨 تقرير ولي الأمر</button>` : ''}</div>`])) : empty('لا يوجد طلاب')}
    </section>`;
  onSubmit($('#sf', el), async (v) => { location.hash = `#/admin/students${v.search ? `?search=${encodeURIComponent(v.search)}` : ''}`; });
  onAction(el, {
    wa: (b) => openWhatsAppReport(b, b.dataset.id),
    reportsAll: (b) => run(b, () => whatsAppQueue()),
    new: () => {
      const m = modal(`<h2>إضافة طالب</h2><p class="muted">يُفعَّل الحساب فورًا بدون رمز تحقق.</p>
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

/**
 * Parent report on WhatsApp: opens the admin's WhatsApp on the parent's chat with the report already written
 * (wa.me link, free — the admin just presses send). The window opens first so the browser doesn't block it.
 */
/** WhatsApp chat link for an Egyptian mobile (01xxxxxxxxx → wa.me/201xxxxxxxxx), or null. */
const waLink = (phone) => (/^01[0125]\d{8}$/.test(phone || '') ? `https://wa.me/2${phone}` : null);

async function openWhatsAppReport(btn, studentId, after) {
  const win = window.open('', '_blank');
  await run(btn, async () => {
    try {
      const r = await API.get(`/admin/students/${studentId}/parent-report`);
      if (!r.whatsapp) throw new Error('رقم ولي الأمر ليس رقم موبايل مصريًا صحيحًا — عدّله من بيانات الطالب');
      const url = `https://wa.me/${r.whatsapp}?text=${encodeURIComponent(r.text)}`;
      if (win) win.location.href = url; else location.href = url;
      await API.post(`/admin/students/${studentId}/parent-report/whatsapp`);
      toast('تم فتح واتساب — اضغط إرسال هناك');
      after?.();
    } catch (err) { win?.close(); throw err; }
  });
}

/**
 * "Send to all parents on WhatsApp": a queue — one click per parent opens WhatsApp with that student's report
 * (free, from the admin's own WhatsApp). Parents who got a report in the last 7 days are skipped unless the admin
 * includes them.
 */
async function whatsAppQueue() {
  const { students, invalid_phone: invalid } = await API.get('/admin/reports/whatsapp-queue');
  const m = modal(`<h2>📱 تقارير أولياء الأمور على واتساب</h2><div id="waq"></div>`);
  let includeSent = false;
  const done = new Set(students.filter((s) => s.sent_recently).map((s) => s.id));
  const render = () => {
    const todo = students.filter((s) => includeSent || !done.has(s.id) || s.justSent);
    const pending = todo.filter((s) => !s.justSent);
    const next = pending[0];
    const sentNow = students.filter((s) => s.justSent).length;
    $('#waq', m).innerHTML = `
      <p class="muted">اضغط الزر الأخضر ← سيفتح واتساب على ولي الأمر والتقرير مكتوب ← اضغط إرسال وارجع هنا للتالي.</p>
      <div class="tiles"><div class="tile"><span class="tile-label">المتبقي</span><b>${pending.length}</b></div>
        <div class="tile"><span class="tile-label">أُرسل الآن</span><b class="good">${sentNow}</b></div>
        <div class="tile"><span class="tile-label">أُرسل إليهم آخر 7 أيام</span><b>${students.filter((s) => s.sent_recently).length}</b></div></div>
      ${invalid ? `<p class="notice mid small">${invalid} طالب رقم ولي أمرهم ليس رقم موبايل مصريًا صحيحًا، لذا ليسوا في القائمة.</p>` : ''}
      <label class="check"><input type="checkbox" id="waq-all" ${includeSent ? 'checked' : ''}> أرسل أيضًا لمن أُرسل إليهم خلال آخر 7 أيام</label>
      ${next ? `<button class="btn parent big-btn" data-wa-next="${next.id}">📱 التالي: ${esc(next.full_name)} (${sentNow + 1} من ${sentNow + pending.length})</button>`
        : `<p class="notice good">✓ اكتمل الإرسال — لم يتبقَّ أحد.</p>`}
      <details class="device-log"><summary>القائمة (${students.length})</summary><ul>${students.map((s) =>
        `<li>${s.justSent ? '✅' : done.has(s.id) ? '☑️' : '⬜'} ${esc(s.full_name)} <small class="mono muted">${esc(s.student_code)}</small></li>`).join('')}</ul></details>`;
    $('#waq-all', m).addEventListener('change', (e) => { includeSent = e.target.checked; render(); });
    const btn = $('[data-wa-next]', m);
    btn?.addEventListener('click', async () => {
      const s = students.find((x) => String(x.id) === btn.dataset.waNext);
      await openWhatsAppReport(btn, s.id);
      s.justSent = true;
      render();
    });
  };
  render();
}

Admin.student = async (el, { id }, query = {}) => {
  const [d, { plans }] = await Promise.all([API.get(`/admin/students/${id}`), API.get('/admin/plans')]);
  const s = d.student;
  const aiPct = s.ai_limit_egp ? (s.ai_spent_egp / s.ai_limit_egp) * 100 : 0;
  el.innerHTML = `<div class="page-head"><a class="btn ghost tiny" href="#/admin/students">→ الطلاب</a><h1>${esc(s.full_name)}</h1>
      ${s.student_code ? `<span class="mono muted">${esc(s.student_code)}</span>` : badge('لم يكمل التسجيل — عيّن له كلمة مرور لإكماله', 'mid')}${s.is_active ? badge('نشط', 'good') : badge('موقوف', 'bad')}</div>

    <section class="tiles">
      <div class="tile"><span class="tile-label">الأداء العام</span><b class="${percentTone(d.performance.overall.percent)}">${d.performance.overall.percent ?? '—'}%</b><small>${esc(d.performance.overall.rating)}</small></div>
      <div class="tile"><span class="tile-label">بنك الأخطاء</span><b>${d.open_mistakes}</b><small>سؤال مفتوح</small></div>
      <div class="tile"><span class="tile-label">الفريق</span><b class="small-b">${d.team ? esc(d.team.name) : '—'}</b><small>${d.team ? `<a href="#/admin/teams?search=${encodeURIComponent(d.team.name)}">إدارة الفريق</a>` : ''}</small></div>
      <div class="tile"><span class="tile-label">نقاط AI المستهلكة</span><b>${fmtPoints(egpToPoints(s.ai_spent_egp))}</b><small>من ${fmtPoints(egpToPoints(s.ai_limit_egp))} · تكلفة فعلية ${fmtMoney(s.ai_spent_egp, 3)}</small>${bar(aiPct, aiPct > 80 ? 'bad' : 'good')}</div>
    </section>

    <section class="card"><div class="card-head"><h2>بيانات الطالب</h2>
      ${waLink(d.student.phone) ? `<a class="btn wa tiny" href="${waLink(d.student.phone)}" target="_blank" rel="noopener">💬 واتساب الطالب</a>` : ''}</div>
      <form id="pf" class="form grid2">${studentFields(s)}
        <label class="check"><input type="checkbox" name="is_verified" ${s.is_verified ? 'checked' : ''}> الحساب مفعّل (تم تأكيد الإيميل)</label>
        <label class="check"><input type="checkbox" name="is_active" ${s.is_active ? 'checked' : ''}> الحساب نشط (إلغاؤه يمنع الدخول)</label>
        <button class="btn primary span2" type="submit">حفظ البيانات</button></form></section>

    <section class="card"><h2>الاشتراكات</h2>
      ${d.subscriptions.length ? table(['الباقة', 'من', 'إلى', 'الحالة', ''], d.subscriptions.map((x) => [esc(x.name_ar), fmtDay(x.starts_at), fmtDay(x.ends_at),
        x.status === 'cancelled' ? badge('ملغي', 'bad') : x.is_current ? badge('ساري', 'good') : badge(new Date(x.starts_at) > new Date() ? 'قادم' : 'منتهي'),
        x.status === 'active' && new Date(x.ends_at) > new Date() ? `<button class="btn danger tiny" data-action="cancelSub" data-id="${x.id}">إلغاء</button>` : ''])) : empty('لا توجد اشتراكات')}
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
        <p class="muted">سيتم تسجيل خروجه من كل الأجهزة.</p>
        <button class="btn primary" type="submit">تغيير كلمة المرور</button></form></section>
    </div>

    <section class="card" id="parent-report"><div class="card-head"><h2>📨 تقرير ولي الأمر</h2>
      ${d.student.student_code ? `<div class="row"><button class="btn parent tiny" data-action="waReport">📨 إرسال التقرير لولي الأمر (واتساب)</button>
        <button class="btn primary tiny" data-action="sendReport">✉️ إرسال بالإيميل</button></div>` : ''}</div>
      <div id="report-body"><div class="loading">جارٍ تجهيز التقرير…</div></div></section>

    ${deviceSection(d.devices)}

    <section class="card"><h2>الأداء في المواد</h2>${d.performance.subjects.length ? d.performance.subjects.map((x) => `<div class="perf-row">
      <span>${esc(x.subject)}</span>${bar(x.percent, percentTone(x.percent))}<b class="${percentTone(x.percent)}">${x.percent}%</b><small class="muted">${x.correct}/${x.attempts}</small></div>`).join('') : empty('لم يحل أي أسئلة بعد')}</section>

    <section class="card"><h2>المدفوعات</h2>${d.payments.length ? table(['التاريخ', 'الباقة', 'المبلغ', 'الطريقة', 'الحالة'],
      d.payments.map((p) => [fmtDate(p.created_at), esc(p.plan_code), fmtMoney(p.amount_egp), esc(LABELS.provider[p.provider]), badge(LABELS.paymentStatus[p.status], LABELS.paymentTone[p.status])])) : empty('لا توجد مدفوعات')}</section>

    <section class="card danger-zone"><h2>🗑️ حذف الحساب نهائياً</h2>
      <p class="muted">يحذف الطالب وكل بياناته: الإجابات، وبنك الأخطاء، والاشتراكات، والمسابقات، والفريق، والأجهزة، والتقارير. <b>لا يمكن التراجع.</b>
        تبقى المدفوعات محفوظة باسمه لأجل حسابات الإيرادات. إذا أردت إيقافه فقط بدون حذف، فاستخدم "الحساب نشط" بالأعلى.</p>
      <button class="btn danger" data-action="deleteStudent">حذف الطالب نهائياً</button></section>`;

  const reload = () => Admin.student(el, { id });
  // Parent report: preview of what the parent receives + what was sent before.
  const CHANNEL = { email: 'إيميل', sms: 'رسالة', log: 'مسجَّل فقط (لا يوجد إيميل)', whatsapp: 'واتساب' };
  async function loadReport() {
    const box = $('#report-body', el);
    if (!box) return;
    try {
      const r = await API.get(`/admin/students/${id}/parent-report`);
      box.innerHTML = `<p class="muted small">📱 واتساب: <b dir="ltr">${esc(r.whatsapp ? `+${r.whatsapp}` : 'رقم ولي الأمر غير صحيح')}</b> ·
          ✉️ إيميل: <b dir="ltr">${esc(r.channel === 'email' ? r.to : 'لا يوجد إيميل لولي الأمر')}</b></p>
        <pre class="report">${esc(r.text)}</pre>
        ${r.history.length ? `<details class="device-log"><summary>التقارير المرسلة (${r.history.length})</summary>${table(['التاريخ', 'الطريقة', 'الحالة'],
          r.history.map((h) => [fmtDate(h.sent_at), esc(CHANNEL[h.channel] || h.channel), h.status === 'sent' ? badge('تم', 'good') : `${badge('فشل', 'bad')} <small class="muted">${esc(h.error || '')}</small>`]))}</details>` : '<p class="muted small">لم تُرسل تقارير لهذا الطالب بعد.</p>'}`;
    } catch (err) { box.innerHTML = `<p class="notice bad">${esc(errorText(err))}</p>`; }
  }
  loadReport();
  if (query.tab === 'report') setTimeout(() => $('#parent-report', el)?.scrollIntoView({ behavior: 'smooth' }), 50);
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
      if (!confirm('إلغاء هذا الاشتراك؟')) return;
      await API.post(`/admin/subscriptions/${b.dataset.id}/cancel`);
      reload();
    }),
    deleteStudent: () => {
      const code = d.student.student_code || d.student.email;
      const m = modal(`<h2>🗑️ حذف ${esc(d.student.full_name)} نهائياً؟</h2>
        <p class="notice bad">ستُحذف كل بيانات الطالب ولا يمكن التراجع.</p>
        <form class="form" id="delf"><label>للتأكيد اكتب ${d.student.student_code ? 'كود الطالب' : 'إيميل الطالب'}: <b class="mono">${esc(code)}</b>
          <input name="confirm" required autocomplete="off" dir="ltr"></label>
          <button class="btn danger" type="submit">حذف نهائي</button></form>`);
      onSubmit($('#delf', m), async (v) => {
        await API.req('DELETE', `/admin/students/${id}`, { confirm: v.confirm });
        closeModal();
        toast(`تم حذف حساب ${d.student.full_name}`);
        location.hash = '#/admin/students';
      });
    },
    removeDevice: (b) => run(b, async () => {
      if (!confirm('إزالة هذا الجهاز من حساب الطالب؟ إذا كان مسجلًا الدخول منه فسيُغلق.')) return;
      await API.del(`/admin/students/${id}/devices/${b.dataset.id}`);
      toast('تمت إزالة الجهاز');
      reload();
    }),
    waReport: (b) => openWhatsAppReport(b, id, loadReport),
    sendReport: (b) => run(b, async () => {
      if (!confirm('إرسال هذا التقرير لولي الأمر الآن؟')) return;
      const r = await API.post(`/admin/students/${id}/parent-report`);
      toast(r.status === 'sent' ? (r.channel === 'log' ? 'تم تسجيل التقرير (لا يوجد إيميل لولي الأمر — رسائل SMS غير مفعّلة)' : 'تم إرسال التقرير لولي الأمر ✓') : 'فشل الإرسال — راجع السجل بالأسفل', r.status === 'sent' ? undefined : 'err');
      loadReport();
    }),
    resetDevices: (b) => run(b, async () => {
      if (!confirm('مسح كل أجهزة الطالب؟ سيُسجَّل خروجه من كل الأجهزة، وسيحتاج أول دخول بعد ذلك إلى رمز يُرسل إلى إيميله.')) return;
      await API.post(`/admin/students/${id}/devices/reset`);
      toast('تم مسح الأجهزة');
      reload();
    }),
  });
};

const DEVICE_EVENTS = {
  added: ['تمت إضافة جهاز جديد', ''],
  blocked_limit: ['⚠️ محاولة دخول من جهاز زائد', 'bad'],
  removed_by_student: ['أزال الطالب جهازًا', 'mid'],
  removed_by_admin: ['أزالت الإدارة جهازًا', 'mid'],
  reset_by_admin: ['مسحت الإدارة كل الأجهزة', 'mid'],
};
/** Student's devices (max 2, one session at a time) + history; repeated "extra device" attempts hint at a shared account. */
function deviceSection(dv) {
  const blocked = dv.events.filter((e) => e.type === 'blocked_limit' && Date.now() - new Date(e.created_at) < 30 * 86400000).length;
  return `<section class="card">
    <div class="card-head"><h2>الأجهزة (${dv.items.length}/${dv.max})</h2>
      ${dv.items.length ? '<button class="btn ghost tiny" data-action="resetDevices">مسح كل الأجهزة</button>' : ''}</div>
    ${blocked ? `<p class="notice bad">⚠️ ${blocked} محاولة دخول من أجهزة زائدة في آخر 30 يومًا — ربما يشارك حسابه مع آخرين.</p>` : ''}
    ${dv.items.length ? table(['الجهاز', 'أُضيف', 'آخر دخول', 'IP', ''], dv.items.map((x) => [
      `${esc(x.name)} ${x.active ? badge('متصل الآن', 'good') : ''}`, fmtDate(x.created_at), fmtDate(x.last_seen_at),
      `<span class="mono">${esc(x.last_ip || '—')}</span>`,
      `<button class="btn danger tiny" data-action="removeDevice" data-id="${x.id}">إزالة</button>`])) : empty('لا توجد أجهزة مسجلة — سيحتاج أول دخول إلى رمز على الإيميل')}
    ${dv.events.length ? `<details class="device-log"><summary>سجل الأجهزة (${dv.events.length})</summary>
      <ul>${dv.events.map((e) => `<li><span class="${DEVICE_EVENTS[e.type]?.[1] || ''}">${DEVICE_EVENTS[e.type]?.[0] || esc(e.type)}</span>
        ${e.device_name ? `— ${esc(e.device_name)}` : ''} <small class="muted">${fmtDate(e.created_at)}${e.ip ? ` · <span class="mono">${esc(e.ip)}</span>` : ''}</small></li>`).join('')}</ul></details>` : ''}
  </section>`;
}

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
          <button class="btn danger tiny" data-action="del" data-id="${p.id}">حذف</button></div>`])) : empty('لا توجد منتجات')}</section>`;
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

// ---------------------------------------------------------------- Announcements
const AUDIENCE = { all: 'كل الطلاب', subscribers: 'المشتركون فقط', free: 'غير المشتركين فقط' };
const TONES = { info: '📢 عادي', success: '🎉 خبر سار', warning: '⚠️ تنبيه مهم' };
const options = (map, sel) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');
const announcementFields = (a = {}) => `
  <label class="span3">العنوان<input name="title" required minlength="2" maxlength="200" value="${esc(a.title || '')}"></label>
  <label class="span3">التفاصيل<textarea name="body" rows="4" maxlength="5000">${esc(a.body || '')}</textarea></label>
  <label>النوع<select name="tone">${options(TONES, a.tone || 'info')}</select></label>
  <label>يظهر لـ<select name="audience">${options(AUDIENCE, a.audience || 'all')}</select></label>
  <label>رابط (اختياري)<input type="url" name="link_url" value="${esc(a.link_url || '')}" placeholder="https://"></label>
  <label>يبدأ الظهور<input type="datetime-local" name="starts_at" value="${a.starts_at ? toLocalInput(a.starts_at) : ''}"><small class="muted">فارغ = الآن</small></label>
  <label>يختفي في<input type="datetime-local" name="expires_at" value="${a.expires_at ? toLocalInput(a.expires_at) : ''}"><small class="muted">فارغ = لا يختفي</small></label>
  <div class="span3 row wrap">
    <label class="check"><input type="checkbox" name="pinned" ${a.pinned ? 'checked' : ''}> 📌 مثبت (يبقى ظاهرًا في الرئيسية)</label>
    <label class="check"><input type="checkbox" name="is_active" ${a.is_active === false ? '' : 'checked'}> ظاهر للطلاب</label>
  </div>`;
const announcementPayload = (v) => ({
  title: v.title, body: v.body ?? '', tone: v.tone, audience: v.audience, link_url: v.link_url ?? null,
  pinned: v.pinned, is_active: v.is_active,
  starts_at: v.starts_at ? new Date(v.starts_at).toISOString() : null,
  expires_at: v.expires_at ? new Date(v.expires_at).toISOString() : null,
});
const announcementStatus = (a) => {
  const now = Date.now();
  if (!a.is_active) return badge('مخفي', 'bad');
  if (new Date(a.starts_at) > now) return badge(`يبدأ ${fmtDate(a.starts_at)}`, 'mid');
  if (a.expires_at && new Date(a.expires_at) <= now) return badge('انتهى', '');
  return badge('ظاهر', 'good');
};

Admin.announcements = async (el) => {
  const { announcements } = await API.get('/admin/announcements');
  el.innerHTML = `<h1 class="page-head">الإعلانات</h1>
    <section class="card"><h2>إعلان جديد</h2>
      <p class="muted">يظهر للطلاب في الصفحة الرئيسية وعلى علامة 🔔 بالأعلى حتى يقرؤوه.</p>
      <form id="af" class="form grid3">${announcementFields()}
      <button class="btn primary span3" type="submit">نشر الإعلان</button></form></section>
    <section class="card">${announcements.length ? table(['الإعلان', 'يظهر لـ', 'الحالة', 'قُرئ', ''],
      announcements.map((a) => [`${a.pinned ? '📌 ' : ''}<b>${esc(a.title)}</b><br><small class="muted">${fmtDate(a.starts_at)}${a.expires_at ? ` ← ${fmtDate(a.expires_at)}` : ''}</small>`,
        AUDIENCE[a.audience], announcementStatus(a), `${a.reads} طالب`,
        `<div class="row"><button class="btn ghost tiny" data-action="edit" data-id="${a.id}">تعديل</button>
          <button class="btn ghost tiny" data-action="toggle" data-id="${a.id}">${a.is_active ? 'إخفاء' : 'إظهار'}</button>
          <button class="btn danger tiny" data-action="del" data-id="${a.id}">حذف</button></div>`])) : empty('لا توجد إعلانات بعد')}</section>`;
  const reload = () => Admin.announcements(el);
  const find = (b) => announcements.find((x) => String(x.id) === b.dataset.id);
  onSubmit($('#af', el), async (v) => { await API.post('/admin/announcements', announcementPayload(v)); toast('تم نشر الإعلان'); reload(); });
  onAction(el, {
    edit: (b) => {
      const a = find(b);
      const m = modal(`<h2>تعديل الإعلان</h2><form class="form grid3" id="ef">${announcementFields(a)}<button class="btn primary span3" type="submit">حفظ</button></form>`);
      onSubmit($('#ef', m), async (v) => { await API.put(`/admin/announcements/${a.id}`, announcementPayload(v)); closeModal(); toast('تم الحفظ'); reload(); });
    },
    toggle: (b) => run(b, async () => {
      const a = find(b);
      await API.put(`/admin/announcements/${a.id}`, { ...announcementPayload({ ...a, starts_at: a.starts_at, expires_at: a.expires_at }), is_active: !a.is_active });
      reload();
    }),
    del: (b) => run(b, async () => { if (confirm('حذف الإعلان؟')) { await API.del(`/admin/announcements/${b.dataset.id}`); reload(); } }),
  });
};

// ---------------------------------------------------------------- Settings & admin accounts
Admin.settings = async (el) => {
  const [{ settings: s, ai_key_configured: aiKey }, { admins, me }, { plans }] = await Promise.all([API.get('/admin/settings'), API.get('/admin/admins'), API.get('/admin/plans')]);
  const supportPlans = plans.filter((p) => p.features?.priority_support).map((p) => p.name_ar);
  el.innerHTML = `<h1 class="page-head">الإعدادات</h1>
    <section class="card"><h2>إعدادات المنصة</h2><form id="sf" class="form grid2">
      <label>اسم المنصة<input name="site_name" required value="${esc(s.site_name)}"></label>
      <label>رقم المحفظة الإلكترونية (فودافون/اتصالات/أورانج كاش)<input name="vodafone_cash_number" value="${esc(s.vodafone_cash_number)}"></label>
      <label>عنوان انستاباي<input name="instapay_address" value="${esc(s.instapay_address)}"></label>
      <label class="span2">تعليمات الدفع اليدوي<textarea name="manual_payment_instructions" rows="2">${esc(s.manual_payment_instructions)}</textarea></label>
      <label>رصيد نقاط الذكاء الاصطناعي للطالب الجديد<input type="number" name="default_ai_limit_points" min="0" step="1" value="${Math.round(s.default_ai_limit_egp * s.ai_points_per_egp)}"></label>
      <label>عدد النقاط مقابل 1 جنيه من تكلفة الموديل<input type="number" name="ai_points_per_egp" min="1" step="1" value="${s.ai_points_per_egp}"></label>
      <p class="muted span2" id="ai-equiv"></p>
      <label>سعر الدولار بالجنيه (لحساب تكلفة Gemini)<input type="number" name="usd_to_egp" min="1" step="0.01" value="${s.usd_to_egp}"></label>
      <button class="btn primary span2" type="submit">حفظ الإعدادات</button></form>
      <p class="muted">يُطبَّق حد الذكاء الاصطناعي على الطلاب الجدد. <button class="btn ghost tiny" data-action="applyAi">طبّقه على كل الطلاب الحاليين</button></p>
    </section>

    <section class="card"><h2>💬 خدمة العملاء (واتساب)</h2>
      <p class="muted">يظهر للطالب زر «خدمة العملاء» في كل الصفحات، وعند الضغط عليه يُفتح واتساب على رقم خدمة العملاء مع رسالة جاهزة فيها اسم الطالب وكوده.</p>
      <form id="csf" class="form grid2">
        <label class="check span2"><input type="checkbox" name="support_enabled" ${s.support_enabled ? 'checked' : ''}> تفعيل خدمة العملاء</label>
        <label>رقم واتساب خدمة العملاء<input name="support_phone" inputmode="numeric" dir="ltr" placeholder="01xxxxxxxxx" value="${esc(s.support_phone)}"></label>
        <label class="check"><input type="checkbox" name="support_for_unsubscribed" ${s.support_for_unsubscribed ? 'checked' : ''}> متاحة أيضًا للطلاب غير المشتركين (للاستفسار قبل الاشتراك)</label>
        <label class="span2">الرسالة الجاهزة<textarea name="support_message" rows="2" maxlength="300">${esc(s.support_message || '')}</textarea></label>
        <p class="span2 ${supportPlans.length ? 'muted' : 'notice mid'}">الباقات التي تشمل خدمة العملاء: <b>${supportPlans.length ? supportPlans.map(esc).join('، ') : 'لا توجد باقة'}</b>
          — للتعديل افتح <a href="#/admin/plans">الباقات</a> وفعّل أو ألغِ «خدمة العملاء عبر واتساب» في كل باقة.</p>
        <button class="btn primary span2" type="submit">حفظ</button></form>
    </section>

    <section class="card"><h2>الذكاء الاصطناعي (Gemini)</h2>
      <p class="${aiKey ? 'notice good' : 'notice bad'}">${aiKey ? '✓ مفتاح Gemini مضاف على السيرفر' : '⛔ مفتاح Gemini غير مضاف — أضف GEMINI_API_KEY في إعدادات Vercel'}</p>
      <form id="gf" class="form grid3">
        <label class="span3">اسم الموديل (كما هو مكتوب في Google AI Studio)<input name="ai_model" required list="ai-models" dir="ltr" value="${esc(s.ai_model)}">
          <datalist id="ai-models"><option value="gemini-3.5-flash-lite"><option value="gemini-3.1-flash-lite-preview"><option value="gemini-3.8-flash"></datalist></label>
        <label class="span3">موديل احتياطي (يعمل تلقائيًا إذا كان الأساسي مضغوطًا أو متوقفًا — فارغ = لا يوجد)<input name="ai_fallback_model" list="ai-models" dir="ltr" value="${esc(s.ai_fallback_model || '')}"></label>
        <label>سعر الإدخال (دولار لكل مليون توكن)<input type="number" name="ai_input_usd_per_m" min="0" step="0.01" required value="${s.ai_input_usd_per_m}"></label>
        <label>سعر الإخراج (دولار لكل مليون توكن)<input type="number" name="ai_output_usd_per_m" min="0" step="0.01" required value="${s.ai_output_usd_per_m}"></label>
        <div class="row" style="align-items:end"><button class="btn primary" type="submit">حفظ</button>
          <button class="btn ghost" type="button" data-action="testAi">🧪 جرّب الذكاء الاصطناعي</button></div>
      </form>
      <p class="muted small">تُستخدم الأسعار في حساب نقاط الطلاب. اكتبها كما في صفحة أسعار Gemini، وإذا لم تكن متأكدًا فاجعلها أعلى قليلًا (يُخصم من الطالب التكلفة الفعلية فقط).</p>
      <div id="ai-test"></div>
    </section>

    <section class="card"><h2>حسابات الأدمن</h2>
      ${table(['الاسم', 'الإيميل', 'الحالة', ''], admins.map((a) => [esc(a.full_name), esc(a.email), a.is_active ? badge('نشط', 'good') : badge('موقوف', 'bad'),
        a.id === me ? '<small class="muted">(أنت)</small>' : `<div class="row"><button class="btn ${a.is_active ? 'ghost' : 'primary'} tiny" data-action="toggleAdmin" data-id="${a.id}" data-active="${a.is_active}">${a.is_active ? 'إيقاف' : 'تفعيل'}</button>
          <button class="btn danger tiny" data-action="deleteAdmin" data-id="${a.id}" data-email="${esc(a.email)}">🗑️ حذف</button></div>`]))}
      <h3>إضافة أدمن</h3>
      <form id="af" class="form grid3">
        <label>الاسم<input name="full_name" required minlength="3"></label>
        <label>الإيميل<input name="email" type="email" required></label>
        <label>كلمة المرور<input name="password" required minlength="8" autocomplete="new-password"></label>
        <button class="btn primary span3" type="submit">إضافة أدمن</button></form>
    </section>

    <section class="card"><h2>تغيير كلمة المرور الخاصة بي</h2><form id="mf" class="form grid2">
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
    await API.patch('/admin/settings', { ...rest, vodafone_cash_number: v.vodafone_cash_number ?? '',
      instapay_address: v.instapay_address ?? '', manual_payment_instructions: v.manual_payment_instructions ?? '',
      default_ai_limit_egp: Number(v.default_ai_limit_points) / Number(v.ai_points_per_egp),
      ai_points_per_egp: Number(v.ai_points_per_egp), usd_to_egp: Number(v.usd_to_egp) });
    await loadSiteSettings();
    renderTopbar(location.hash.slice(1).split('?')[0]);
    toast('تم حفظ الإعدادات');
  });
  onSubmit($('#csf', el), async (v) => {
    const phone = (v.support_phone || '').replace(/\D/g, '');
    if (v.support_enabled && !/^(2?01[0125]\d{8})$/.test(phone)) throw new Error('اكتب رقم واتساب مصريًا صحيحًا (مثال: 01012345678)');
    await API.patch('/admin/settings', { support_enabled: v.support_enabled, support_phone: phone,
      support_for_unsubscribed: v.support_for_unsubscribed, support_message: v.support_message ?? '' });
    toast('تم حفظ إعدادات خدمة العملاء');
  });
  onSubmit($('#gf', el), async (v) => {
    await API.patch('/admin/settings', { ai_model: v.ai_model, ai_fallback_model: v.ai_fallback_model ?? '', ai_input_usd_per_m: Number(v.ai_input_usd_per_m), ai_output_usd_per_m: Number(v.ai_output_usd_per_m) });
    toast('تم حفظ إعدادات الذكاء الاصطناعي');
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
    testAi: (b) => run(b, async () => {
      const box = $('#ai-test', el);
      box.innerHTML = '<p class="muted">جاري التجربة…</p>';
      const r = await API.post('/admin/ai/test');
      box.innerHTML = r.ok
        ? `<div class="notice good">✓ يعمل — ${r.answered_by !== r.model ? `الأساسي (<b dir="ltr">${esc(r.model)}</b>) مضغوط فردّ الاحتياطي ` : 'الموديل '}<b dir="ltr">${esc(r.answered_by || r.model)}</b> رد في ${(r.ms / 1000).toFixed(1)} ثانية (تكلفة ${fmtMoney(r.cost_egp, 4)}):<br>«${esc(r.reply)}»</div>`
        : r.mock ? '<div class="notice mid">الوضع التجريبي: لا يوجد مفتاح Gemini، لذا الرد تجريبي.</div>'
          : `<div class="notice bad">⛔ لا يعمل مع الموديل <b dir="ltr">${esc(r.model)}</b>:<br><span dir="ltr" class="mono small">${esc(r.error)}</span><br>تأكد من المفتاح في Vercel ومن اسم الموديل.</div>`;
    }),

    applyAi: (b) => run(b, async () => {
      if (!confirm('تطبيق الحد الافتراضي على كل الطلاب؟')) return;
      const r = await API.post('/admin/settings/apply-ai-limit');
      toast(`تم تحديث ${r.updated} طالب إلى ${fmtPoints(egpToPoints(r.limit_egp))}`);
    }),
    deleteAdmin: (b) => run(b, async () => {
      if (!confirm(`حذف حساب الأدمن ${b.dataset.email} نهائياً؟`)) return;
      await API.del(`/admin/admins/${b.dataset.id}`);
      toast('تم حذف حساب الأدمن');
      reload();
    }),
    toggleAdmin: (b) => run(b, async () => {
      await API.patch(`/admin/admins/${b.dataset.id}`, { is_active: b.dataset.active !== 'true' });
      reload();
    }),
  });
};
