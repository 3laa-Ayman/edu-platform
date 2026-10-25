/**
 * Narrated live demo against a running server (development mode, OTP_DEV_ECHO=true).
 *   node scripts/demo.js
 */
const path = require('path');
const { paymobHmac } = require('../src/services/payment.service');

const API = process.env.API_URL || 'http://localhost:4000';
const step = (t) => console.log(`\n━━━ ${t} ━━━`);
const show = (label, data) => console.log(`  ${label}:`, typeof data === 'string' ? data : JSON.stringify(data));

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function student(name, email, phone, parentPhone, parentEmail) {
  const r = await call('POST', '/api/auth/register', { body: { full_name: name, email, password: 'Passw0rd123', phone, parent_phone: parentPhone, parent_email: parentEmail } });
  show(`تسجيل ${name}`, `${r.status} → ${r.data.message} | الكود: ${r.data.student_code} | OTP (تجريبي): ${r.data.dev_otp}`);
  const v = await call('POST', '/api/auth/verify-otp', { body: { email, code: r.data.dev_otp } });
  show('تأكيد OTP', `${v.status} → ${v.data.message}`);
  return { name, email, code: r.data.student_code, token: v.data.token, id: v.data.user.id };
}

(async () => {
  step('1) التسجيل و OTP');
  const ahmed = await student('أحمد محمد علي', 'ahmed@demo.com', '01011112222', '01233334444', 'father.ahmed@demo.com');
  const sara = await student('سارة حسن', 'sara@demo.com', '01155556666', '01077778888');
  const wrongOtp = await call('POST', '/api/auth/register', { body: { full_name: 'حساب اختبار', email: 'x@demo.com', password: 'Passw0rd123', phone: '01099990000', parent_phone: '01099990001' } });
  const bad = await call('POST', '/api/auth/verify-otp', { body: { email: 'x@demo.com', code: wrongOtp.data.dev_otp === '123456' ? '654321' : '123456' } });
  show('OTP غلط', `${bad.status} → ${bad.data.error.message}`);
  const login = await call('POST', '/api/auth/login', { body: { identifier: ahmed.code, password: 'Passw0rd123' } });
  show('دخول أحمد بالكود', `${login.status} → توكن JWT (${login.data.token.slice(0, 20)}...)`);

  step('2) الأدمن يرفع شيت الأسئلة (Excel)');
  const admin = (await call('POST', '/api/auth/login', { body: { identifier: 'admin@example.com', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' } })).data.token;
  const fs = require('fs');
  const f = new FormData();
  f.append('file', new Blob([fs.readFileSync(path.join(__dirname, '../templates/questions-template.xlsx'))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'questions.xlsx');
  const up = await call('POST', '/api/admin/questions/upload', { token: admin, form: f });
  show('نتيجة الرفع', { inserted: up.data.inserted, duplicates: up.data.duplicates, failed: up.data.failed });
  const subj = await call('GET', '/api/catalog/subjects', { token: ahmed.token });
  for (const s of subj.data.subjects) show(`  المادة ${s.name}`, `${s.questions} أسئلة — الدروس: ${s.lessons.map((l) => l.name).join('، ')}`);

  step('3) الاشتراكات والدفع');
  const noSub = await call('GET', '/api/catalog/questions', { token: ahmed.token });
  show('أحمد يحاول يحل بدون اشتراك', `${noSub.status} → ${noSub.data.error.message}`);
  const co = await call('POST', '/api/payments/checkout', { token: ahmed.token, body: { plan_code: 'premium', provider: 'paymob' } });
  show('أحمد يدفع بريميم عبر Paymob', `${co.data.payment.amount_egp} جنيه — الحالة: ${co.data.payment.status}`);
  const obj = {
    id: 7001, amount_cents: 29900, created_at: new Date().toISOString(), currency: 'EGP', error_occured: false, has_parent_transaction: false,
    integration_id: 1, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
    owner: 1, pending: false, success: true, order: { id: 1, merchant_order_id: co.data.payment.reference }, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
  };
  const fake = await call('POST', '/api/webhooks/paymob?hmac=fake', { body: { type: 'TRANSACTION', obj } });
  show('Webhook مزوّر (توقيع غلط)', `${fake.status} → مرفوض`);
  const wh = await call('POST', `/api/webhooks/paymob?hmac=${paymobHmac(obj)}`, { body: { type: 'TRANSACTION', obj } });
  show('Webhook حقيقي من Paymob', wh.data.result);
  const me = await call('GET', '/api/auth/me', { token: ahmed.token });
  show('اشتراك أحمد', `${me.data.subscription.name_ar} حتى ${me.data.subscription.ends_at.slice(0, 10)}`);

  const r = new FormData();
  r.append('plan_code', 'standard'); r.append('provider', 'vodafone_cash'); r.append('sender_account', '01155556666'); r.append('transfer_ref', 'VF-889912');
  r.append('receipt', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'receipt.png');
  const man = await call('POST', '/api/payments/manual', { token: sara.token, form: r });
  show('سارة ترفع إيصال فودافون كاش', man.data.message);
  const pending = await call('GET', '/api/admin/payments?status=under_review', { token: admin });
  show('الأدمن يشوف الإيصالات المعلقة', pending.data.items.map((p) => `${p.full_name} — ${p.amount_egp} ج — ${p.provider} — ${p.transfer_ref}`));
  const ap = await call('POST', `/api/admin/payments/${pending.data.items[0].id}/approve`, { token: admin, body: {} });
  show('الأدمن يوافق', ap.data.message);

  step('4) الحل وبنك الأخطاء');
  const all = (await call('GET', '/api/admin/questions?limit=100', { token: admin })).data.items;
  const q1 = all.find((q) => q.question_text.includes('كتلته'));
  const q2 = all.find((q) => q.question_text.includes('سرعة الضوء'));
  const wrong = (q) => ['A', 'B', 'C', 'D'].find((l) => l !== q.correct_option);
  const qs = await call('GET', '/api/catalog/questions?limit=1', { token: ahmed.token });
  show('سؤال كما يظهر للطالب (بدون الإجابة)', qs.data.questions[0]);
  const a1 = await call('POST', '/api/catalog/answer', { token: ahmed.token, body: { question_id: q1.id, choice: wrong(q1) } });
  show(`أحمد يجاوب غلط على "${q1.question_text.slice(0, 30)}..."`, a1.data);
  await call('POST', '/api/catalog/answer', { token: ahmed.token, body: { question_id: q2.id, choice: wrong(q2) } });
  const sum = await call('GET', '/api/mistakes/summary', { token: ahmed.token });
  show('بنك أخطاء أحمد', sum.data.subjects.map((s) => `${s.subject}: ${s.lessons.map((l) => `${l.lesson} (${l.mistakes})`).join('، ')}`));
  const re = await call('POST', `/api/mistakes/${q1.id}/retry`, { token: ahmed.token, body: { choice: 'ب' } });
  show('أحمد يعيد الحل ويختار "ب"', re.data.message);
  show('عدد الأخطاء الآن', (await call('GET', '/api/mistakes/summary', { token: ahmed.token })).data.total);

  step('5) الشرح والذكاء الاصطناعي');
  const e1 = await call('GET', `/api/catalog/questions/${q1.id}/explanation`, { token: ahmed.token });
  show('شرح محفوظ في البنك', `مصدر: ${e1.data.source} | تكلفة: ${e1.data.cost_egp} | ${e1.data.explanation}`);
  const e2 = await call('GET', `/api/catalog/questions/${q2.id}/explanation`, { token: ahmed.token });
  show('سؤال بدون شرح', e2.data.message);
  const ai = await call('POST', `/api/ai/explain/${q2.id}`, { token: ahmed.token });
  show('أحمد يطلب Gemini', `مصدر: ${ai.data.source} | توكنز: ${ai.data.usage.input_tokens}+${ai.data.usage.output_tokens} | تكلفة: ${ai.data.usage.cost_egp} ج | المتبقي: ${ai.data.usage.remaining_egp} من ${ai.data.usage.limit_egp}`);
  await call('POST', '/api/catalog/answer', { token: sara.token, body: { question_id: q2.id, choice: 'A' } });
  const ai2 = await call('POST', `/api/ai/explain/${q2.id}`, { token: sara.token });
  show('سارة تطلب نفس الشرح', `مصدر: ${ai2.data.source} | تكلفة: ${ai2.data.usage.cost_egp} ج (مجاني لأنه اتولد قبل كده)`);
  await call('PATCH', `/api/admin/students/${ahmed.id}`, { token: admin, body: { ai_limit_egp: 0.003 } });
  const q3 = all.find((q) => q.question_text.includes('غاز نبيل'));
  await call('POST', '/api/catalog/answer', { token: ahmed.token, body: { question_id: q3.id, choice: 'A' } });
  const blk = await call('POST', `/api/ai/explain/${q3.id}`, { token: ahmed.token });
  show('(محاكاة) أحمد وصل للحد الأقصى', `${blk.status} → ${blk.data.error.message}`);
  await call('PATCH', `/api/admin/students/${ahmed.id}`, { token: admin, body: { ai_limit_egp: 100 } });

  step('6) التيمات والمسابقة');
  await call('POST', '/api/teams', { token: ahmed.token, body: { name: 'فريق العباقرة' } });
  const inv = await call('POST', '/api/teams/invites', { token: ahmed.token, body: { student_code: sara.code } });
  show(`أحمد يدعو سارة بالكود ${sara.code}`, inv.data.message);
  const invites = await call('GET', '/api/teams/invites', { token: sara.token });
  const acc = await call('POST', `/api/teams/invites/${invites.data.invites[0].id}/accept`, { token: sara.token });
  show('سارة تقبل', `${acc.data.message} — الأعضاء: ${acc.data.team.members.map((m) => m.full_name).join('، ')}`);

  const now = Date.now();
  const comp = await call('POST', '/api/admin/competitions', { token: admin, body: {
    title: 'مسابقة الجمعة', type: 'team_weekly', starts_at: new Date(now - 60000).toISOString(), ends_at: new Date(now + 3600000).toISOString(), duration_minutes: 15, random: { count: 4 } } });
  const cid = comp.data.competition.id;
  const eA = await call('POST', `/api/competitions/${cid}/start`, { token: ahmed.token });
  const eS = await call('POST', `/api/competitions/${cid}/start`, { token: sara.token });
  show('أول سؤال عند أحمد', `${eA.data.questions[0].question.slice(0, 40)} | ${eA.data.questions[0].options.map((o) => `${o.key}) ${o.text}`).join('  ')}`);
  show('أول سؤال عند سارة', `${eS.data.questions[0].question.slice(0, 40)} | ${eS.data.questions[0].options.map((o) => `${o.key}) ${o.text}`).join('  ')}`);
  const right = (qid) => { const q = all.find((x) => x.id === qid); return q[`option_${q.correct_option.toLowerCase()}`]; };
  const sA = await call('POST', `/api/competitions/${cid}/submit`, { token: ahmed.token, body: { answers: eA.data.questions.map((q) => ({ question_id: q.question_id, choice: q.options.find((o) => o.text === right(q.question_id)).key })) } });
  const sS = await call('POST', `/api/competitions/${cid}/submit`, { token: sara.token, body: { answers: eS.data.questions.slice(0, 2).map((q) => ({ question_id: q.question_id, choice: q.options.find((o) => o.text === right(q.question_id)).key })) } });
  show('درجة أحمد', `${sA.data.score}/${sA.data.total_questions} (${sA.data.percent}%)`);
  show('درجة سارة', `${sS.data.score}/${sS.data.total_questions} (${sS.data.percent}%)`);
  const lb = await call('GET', `/api/competitions/${cid}/leaderboard`, { token: sara.token });
  show('الترتيب (أفراد)', lb.data.individuals.map((i) => `#${i.rank} ${i.student} — ${i.score}`));
  show('الترتيب (تيمات)', lb.data.teams.map((t) => `#${t.rank} ${t.team} — ${t.total_score} نقطة`));

  step('7) المذاكرة والتقارير والخصومات');
  const today = new Date().toISOString().slice(0, 10);
  const t = await call('POST', '/api/planner/tasks', { token: ahmed.token, body: { title: 'حل 20 سؤال فيزياء', task_date: today, start_time: '18:00', duration_minutes: 60, priority: 'high' } });
  await call('POST', '/api/planner/tasks', { token: ahmed.token, body: { title: 'مراجعة الجدول الدوري', task_date: today, duration_minutes: 30 } });
  await call('PATCH', `/api/planner/tasks/${t.data.task.id}`, { token: ahmed.token, body: { is_done: true } });
  show('مهام أحمد النهارده', (await call('GET', '/api/planner/tasks', { token: ahmed.token })).data.summary);
  const perf = await call('GET', '/api/reports/performance', { token: ahmed.token });
  show('تقييم أحمد لكل مادة', perf.data.subjects.map((s) => `${s.subject}: ${s.percent}% (${s.rating})`));
  const rep = await call('GET', '/api/reports/parent/preview', { token: ahmed.token });
  console.log('\n  📩 التقرير اللي هيوصل لولي الأمر:\n' + rep.data.text.split('\n').map((l) => '     ' + l).join('\n'));
  const prods = await call('GET', '/api/products');
  show('\n  الخصومات', prods.data.products.map((p) => `${p.title}: ${p.original_price} ← ${p.final_price} ج (-${p.discount_percent}%)`));

  step('8) لوحة الأدمن');
  show('Dashboard', (await call('GET', '/api/admin/dashboard', { token: admin })).data);
})().catch((e) => { console.error(e); process.exit(1); });
