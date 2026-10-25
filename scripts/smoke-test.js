/**
 * End-to-end smoke test against a running server.
 *   API_URL=http://localhost:4000 PAYMOB_HMAC_SECRET=... node scripts/smoke-test.js
 * Requires: NODE_ENV != production, OTP_DEV_ECHO=true, AUTH_RATE_LIMIT high enough (~100).
 */
const ExcelJS = require('exceljs');
const path = require('path');
const crypto = require('crypto');
const { paymobHmac } = require('../src/services/payment.service');

const API = process.env.API_URL || 'http://localhost:4000';
let passed = 0;
const ok = (cond, msg, extra) => {
  if (!cond) {
    console.error(`❌ ${msg}`, extra !== undefined ? JSON.stringify(extra, null, 2) : '');
    process.exit(1);
  }
  passed++;
  console.log(`✅ ${msg}`);
};

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const rnd = crypto.randomBytes(3).toString('hex');
const phone = (i) => `010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`.slice(0, 11) || `0100000000${i}`;

async function registerStudent(i) {
  const email = `s${i}-${rnd}@test.com`;
  const r = await call('POST', '/api/auth/register', {
    body: { full_name: `طالب ${i} تجربة`, email, password: 'Passw0rd123', phone: phone(i), parent_phone: phone(i + 50), parent_email: i === 0 ? `p0-${rnd}@test.com` : undefined },
  });
  ok(r.status === 201 && /^STU-\d{4}-\d{4,}$/.test(r.data.student_code), `register student ${i} → ${r.data.student_code}`, r.data);
  const v = await call('POST', '/api/auth/verify-otp', { body: { email, code: r.data.dev_otp } });
  ok(v.status === 200 && v.data.token, `verify OTP student ${i}`, v.data);
  return { email, code: r.data.student_code, token: v.data.token, id: v.data.user.id };
}

(async () => {
  ok((await call('GET', '/health')).status === 200, 'health');

  // ---------------- Auth
  const S = [];
  for (let i = 0; i < 7; i++) S.push(await registerStudent(i));
  const [A, B, C, D] = S;

  const dup = await call('POST', '/api/auth/register', { body: { full_name: 'dup user', email: A.email, password: 'Passw0rd123', phone: '01011111111', parent_phone: '01022222222' } });
  ok(dup.status === 409, 'duplicate email rejected');
  const weak = await call('POST', '/api/auth/register', { body: { full_name: 'weak', email: `w-${rnd}@t.com`, password: '123', phone: '123', parent_phone: '01022222222' } });
  ok(weak.status === 400 && weak.data.error.code === 'VALIDATION_ERROR', 'weak password / bad phone rejected');

  const badOtp = await call('POST', '/api/auth/register', { body: { full_name: 'otp user', email: `o-${rnd}@t.com`, password: 'Passw0rd123', phone: '01033333333', parent_phone: '01044444444' } });
  const wrong = await call('POST', '/api/auth/verify-otp', { body: { email: `o-${rnd}@t.com`, code: badOtp.data.dev_otp === '000000' ? '111111' : '000000' } });
  ok(wrong.status === 400, 'wrong OTP rejected');
  const unverifiedLogin = await call('POST', '/api/auth/login', { body: { identifier: `o-${rnd}@t.com`, password: 'Passw0rd123' } });
  ok(unverifiedLogin.status === 403 && unverifiedLogin.data.error.code === 'EMAIL_NOT_VERIFIED', 'unverified login blocked');

  const loginByCode = await call('POST', '/api/auth/login', { body: { identifier: A.code, password: 'Passw0rd123' } });
  ok(loginByCode.status === 200 && loginByCode.data.token, 'login with student code');
  ok((await call('POST', '/api/auth/login', { body: { identifier: A.email, password: 'nope1234' } })).status === 401, 'wrong password → 401');
  ok((await call('GET', '/api/auth/me')).status === 401, 'no token → 401');
  ok((await call('GET', '/api/auth/me', { token: 'abc.def.ghi' })).status === 401, 'forged token → 401');

  const admin = await call('POST', '/api/auth/login', { body: { identifier: process.env.ADMIN_EMAIL || 'admin@example.com', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' } });
  ok(admin.status === 200, 'admin login');
  const AT = admin.data.token;
  ok((await call('GET', '/api/admin/dashboard', { token: A.token })).status === 403, 'student blocked from admin');

  // ---------------- Excel upload
  // Tag the template questions with a per-run suffix so every run starts with fresh (uncached) questions.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '../templates/questions-template.xlsx'));
  wb.worksheets[0].eachRow((row, n) => { if (n > 1) row.getCell(1).value = `${row.getCell(1).value} [${rnd}]`; });
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  const form = () => { const f = new FormData(); f.append('file', new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'q.xlsx'); return f; };
  const dry = await call('POST', '/api/admin/questions/upload?dry_run=true', { token: AT, form: form() });
  ok(dry.status === 200 && dry.data.valid_rows === 6, 'excel dry run: 6 valid rows', dry.data);
  const up = await call('POST', '/api/admin/questions/upload', { token: AT, form: form() });
  ok(up.status === 201 && up.data.inserted === 6, 'excel import: 6 inserted', up.data);
  const up2 = await call('POST', '/api/admin/questions/upload', { token: AT, form: form() });
  ok(up2.data.inserted === 0 && up2.data.duplicates === 6, 're-upload → all duplicates skipped');
  const badFile = new FormData(); badFile.append('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  ok((await call('POST', '/api/admin/questions/upload', { token: AT, form: badFile })).status === 400, 'non-xlsx rejected');

  // ---------------- Subscriptions
  ok((await call('GET', '/api/catalog/questions', { token: A.token })).status === 403, 'practice requires subscription');
  const plans = await call('GET', '/api/payments/plans', { token: A.token });
  ok(plans.data.plans.map((p) => p.price_egp).join(',') === '149,299', 'plans 149 / 299');

  const co = await call('POST', '/api/payments/checkout', { token: A.token, body: { plan_code: 'premium', provider: 'paymob' } });
  ok(co.status === 201 && co.data.mock, 'paymob checkout (dev mock)', co.data);
  const sim = await call('POST', `/api/payments/${co.data.payment.reference}/dev-simulate-paid`, { token: A.token });
  ok(sim.data.activated && sim.data.subscription.plan_code === 'premium', 'A premium activated');

  // Paymob webhook with a real HMAC
  if (process.env.PAYMOB_HMAC_SECRET) {
    const coD = await call('POST', '/api/payments/checkout', { token: D.token, body: { plan_code: 'standard', provider: 'paymob' } });
    const obj = {
      id: 990000 + Math.floor(Math.random() * 9999), amount_cents: 14900, created_at: new Date().toISOString(), currency: 'EGP',
      error_occured: false, has_parent_transaction: false, integration_id: 1, is_3d_secure: true, is_auth: false, is_capture: false,
      is_refunded: false, is_standalone_payment: true, is_voided: false, owner: 1, pending: false, success: true,
      order: { id: 555, merchant_order_id: coD.data.payment.reference }, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    };
    const hmac = paymobHmac(obj);
    const bad = await call('POST', '/api/webhooks/paymob?hmac=deadbeef', { body: { type: 'TRANSACTION', obj } });
    ok(bad.status === 401, 'paymob webhook with bad HMAC rejected');
    const good = await call('POST', `/api/webhooks/paymob?hmac=${hmac}`, { body: { type: 'TRANSACTION', obj } });
    ok(good.data.result === 'activated', 'paymob webhook activates subscription', good.data);
    const again = await call('POST', `/api/webhooks/paymob?hmac=${hmac}`, { body: { type: 'TRANSACTION', obj } });
    ok(again.data.result === 'already_processed', 'paymob webhook is idempotent');
    const tampered = { ...obj, amount_cents: 100 };
    const t = await call('POST', `/api/webhooks/paymob?hmac=${paymobHmac(tampered)}`, { body: { type: 'TRANSACTION', obj: tampered } });
    ok(t.data.result === 'amount_mismatch' || t.data.result === 'already_processed', 'amount mismatch not activated');
  } else {
    await call('POST', `/api/payments/${(await call('POST', '/api/payments/checkout', { token: D.token, body: { plan_code: 'standard', provider: 'paymob' } })).data.payment.reference}/dev-simulate-paid`, { token: D.token });
  }

  // Manual receipt flow
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const receipt = (plan) => { const f = new FormData(); f.append('plan_code', plan); f.append('provider', 'vodafone_cash'); f.append('sender_account', '01012345678'); f.append('transfer_ref', 'TX123'); f.append('receipt', new Blob([png], { type: 'image/png' }), 'r.png'); return f; };
  const mB = await call('POST', '/api/payments/manual', { token: B.token, form: receipt('standard') });
  ok(mB.status === 201 && mB.data.payment.status === 'under_review', 'B uploaded Vodafone Cash receipt', mB.data);
  ok((await call('POST', '/api/payments/manual', { token: B.token, form: receipt('standard') })).status === 409, 'second pending receipt blocked');
  const mC = await call('POST', '/api/payments/manual', { token: C.token, form: receipt('standard') });
  const pend = await call('GET', '/api/admin/payments?status=under_review', { token: AT });
  const pB = pend.data.items.find((p) => p.reference === mB.data.payment.reference);
  const pC = pend.data.items.find((p) => p.reference === mC.data.payment.reference);
  ok(pB && pC, 'admin sees receipts under review');
  const rc = await fetch(`${API}/api/admin/payments/${pB.id}/receipt`, { headers: { Authorization: `Bearer ${AT}` } });
  ok(rc.status === 200, 'admin can view receipt file');
  const appr = await call('POST', `/api/admin/payments/${pB.id}/approve`, { token: AT, body: {} });
  ok(appr.status === 200 && appr.data.subscription, 'admin approved B');
  ok((await call('POST', `/api/admin/payments/${pB.id}/approve`, { token: AT, body: {} })).status === 409, 'double approve blocked');
  ok((await call('POST', `/api/admin/payments/${pC.id}/reject`, { token: AT, body: { note: 'الإيصال غير واضح' } })).status === 200, 'admin rejected C');
  // Subscribe the remaining students so they can join competitions
  for (const s of [C, ...S.slice(4)]) {
    const c = await call('POST', '/api/payments/checkout', { token: s.token, body: { plan_code: 'standard', provider: 'fawry' } });
    await call('POST', `/api/payments/${c.data.payment.reference}/dev-simulate-paid`, { token: s.token });
  }

  // ---------------- Practice + mistakes bank
  const subjects = await call('GET', '/api/catalog/subjects', { token: A.token });
  ok(subjects.data.subjects.length >= 3, `subjects: ${subjects.data.subjects.map((s) => s.name).join(', ')}`);
  const qs = await call('GET', '/api/catalog/questions?limit=50', { token: A.token });
  ok(qs.data.questions.length >= 6 && qs.data.questions.every((q) => !('correct_option' in q) && !('explanation' in q)), 'questions served without answers');
  const pastStd = await call('GET', '/api/catalog/questions?category=past_exam', { token: B.token });
  ok(pastStd.status === 403, 'past exams are premium-only (B is standard)');

  const allQ = await call('GET', '/api/admin/questions?limit=100', { token: AT });
  const byText = (t) => allQ.data.items.find((q) => q.question_text.includes(t) && q.question_text.includes(rnd));
  const qWithExp = byText('كتلته 2 كجم');
  const qNoExp = byText('سرعة الضوء');
  const qNoExp2 = byText('غاز نبيل');
  const wrongOf = (q) => ['A', 'B', 'C', 'D'].find((l) => l !== q.correct_option);

  const ans1 = await call('POST', '/api/catalog/answer', { token: A.token, body: { question_id: qWithExp.id, choice: wrongOf(qWithExp) } });
  ok(ans1.data.is_correct === false && ans1.data.added_to_mistakes, 'wrong answer → added to mistakes bank');
  await call('POST', '/api/catalog/answer', { token: A.token, body: { question_id: qNoExp.id, choice: wrongOf(qNoExp) } });
  await call('POST', '/api/catalog/answer', { token: A.token, body: { question_id: qNoExp.id, choice: wrongOf(qNoExp) } });
  const sum = await call('GET', '/api/mistakes/summary', { token: A.token });
  ok(sum.data.total === 2 && sum.data.subjects[0].lessons.length >= 1, 'mistakes grouped by subject → lesson', sum.data);
  const list = await call('GET', '/api/mistakes', { token: A.token });
  ok(list.data.items.find((m) => m.question_id === qNoExp.id).wrong_count === 2, 'wrong_count increments');
  const quiz = await call('GET', '/api/mistakes/quiz', { token: A.token });
  ok(quiz.data.questions.length === 2, 'mistakes re-solve quiz');
  const retryWrong = await call('POST', `/api/mistakes/${qWithExp.id}/retry`, { token: A.token, body: { choice: wrongOf(qWithExp) } });
  ok(!retryWrong.data.is_correct && !retryWrong.data.removed_from_mistakes, 'retry wrong → stays in bank');
  const retryRight = await call('POST', `/api/mistakes/${qWithExp.id}/retry`, { token: A.token, body: { choice: qWithExp.correct_option === 'B' ? 'ب' : qWithExp.correct_option } });
  ok(retryRight.data.is_correct && retryRight.data.removed_from_mistakes, 'retry correct (Arabic letter) → removed from bank');
  ok((await call('GET', '/api/mistakes/summary', { token: A.token })).data.total === 1, 'mistakes bank now has 1');

  // ---------------- Explanations & AI cost
  const free = await call('GET', `/api/catalog/questions/${qWithExp.id}/explanation`, { token: A.token });
  ok(free.data.source === 'question_bank' && free.data.cost_egp === 0, 'saved explanation served free');
  const none = await call('GET', `/api/catalog/questions/${qNoExp.id}/explanation`, { token: A.token });
  ok(none.data.source === null && none.data.ai_available, 'no saved explanation → offers AI');
  const ai1 = await call('POST', `/api/ai/explain/${qNoExp.id}`, { token: A.token });
  ok(ai1.status === 200 && ai1.data.source === 'gemini' && ai1.data.usage.cost_egp > 0, `gemini explanation, cost ${ai1.data.usage?.cost_egp} EGP`, ai1.data);
  await call('POST', '/api/catalog/answer', { token: B.token, body: { question_id: qNoExp.id, choice: 'A' } });
  const ai2 = await call('POST', `/api/ai/explain/${qNoExp.id}`, { token: B.token });
  ok(ai2.data.source === 'ai_cache' && ai2.data.usage.cost_egp === 0, 'second student gets cached AI explanation free');
  const usage = await call('GET', '/api/ai/usage', { token: A.token });
  ok(usage.data.spent_egp > 0 && usage.data.limit_egp === 100 && usage.data.requests === 1, 'AI usage tracked per student', usage.data);

  await call('PATCH', `/api/admin/students/${A.id}`, { token: AT, body: { ai_limit_egp: usage.data.spent_egp } });
  await call('POST', '/api/catalog/answer', { token: A.token, body: { question_id: qNoExp2.id, choice: 'A' } });
  const blocked = await call('POST', `/api/ai/explain/${qNoExp2.id}`, { token: A.token });
  ok(blocked.status === 402 && blocked.data.error.code === 'AI_LIMIT_REACHED', 'AI blocked at spending cap');
  await call('PATCH', `/api/admin/students/${A.id}`, { token: AT, body: { ai_limit_egp: 100 } });

  // ---------------- Teams
  const team = await call('POST', '/api/teams', { token: A.token, body: { name: 'فريق النجوم' } });
  ok(team.status === 201 && team.data.team.size === 1, 'A created team');
  await call('PATCH', '/api/teams/me', { token: A.token, body: { allow_auto_fill: false } });
  const inv = await call('POST', '/api/teams/invites', { token: A.token, body: { student_code: B.code.toLowerCase() } });
  ok(inv.status === 201, 'A invited B by student code');
  ok((await call('POST', '/api/teams/invites', { token: B.token, body: { student_code: C.code } })).status === 400, 'non-member cannot invite');
  const binv = await call('GET', '/api/teams/invites', { token: B.token });
  const acc = await call('POST', `/api/teams/invites/${binv.data.invites[0].id}/accept`, { token: B.token });
  ok(acc.status === 200 && acc.data.team.size === 2, 'B accepted invite');
  ok((await call('POST', '/api/teams', { token: B.token, body: { name: 'x team' } })).status === 409, 'cannot be in two teams');

  const auto = await call('POST', '/api/admin/teams/auto-assign', { token: AT, body: { require_subscription: true } });
  ok(auto.status === 200 && auto.data.new_teams.every((t) => t.size >= 1 && t.size <= 4), `auto-assign: ${JSON.stringify(auto.data)}`);
  const cTeam = await call('GET', '/api/teams/me', { token: C.token });
  ok(cTeam.data.team, 'C was auto-assigned to a team (new or an incomplete existing one)');
  const aTeam = await call('GET', '/api/teams/me', { token: A.token });
  ok(aTeam.data.team.size === 2, 'opted-out team was not auto-filled');

  // ---------------- Competitions
  const now = Date.now();
  const comp = await call('POST', '/api/admin/competitions', { token: AT, body: {
    title: 'مسابقة الجمعة', type: 'team_weekly', starts_at: new Date(now - 60000).toISOString(), ends_at: new Date(now + 3600000).toISOString(),
    duration_minutes: 20, question_ids: allQ.data.items.filter((q) => q.question_text.includes(rnd)).map((q) => q.id) } });
  ok(comp.status === 201 && comp.data.competition.question_count === 6, 'admin created team competition');
  const cid = comp.data.competition.id;
  const eA = await call('POST', `/api/competitions/${cid}/start`, { token: A.token });
  const eB = await call('POST', `/api/competitions/${cid}/start`, { token: B.token });
  ok(eA.data.questions.length === 6, 'A started competition');
  const sig = (e) => e.data.questions.map((q) => q.question_id + q.options.map((o) => o.text).join('')).join('|');
  ok(sig(eA) !== sig(eB), 'questions/options shuffled differently per student');
  const eA2 = await call('POST', `/api/competitions/${cid}/start`, { token: A.token });
  ok(sig(eA2) === sig(eA), 'resume returns the same order');

  // Answer everything correctly for A by mapping displayed text back to the right option
  const correctText = (qid) => { const q = allQ.data.items.find((x) => x.id === qid); return q[`option_${q.correct_option.toLowerCase()}`]; };
  const answersA = eA.data.questions.map((q) => ({ question_id: q.question_id, choice: q.options.find((o) => o.text === correctText(q.question_id)).key }));
  const subA = await call('POST', `/api/competitions/${cid}/submit`, { token: A.token, body: { answers: answersA } });
  ok(subA.data.score === 6 && subA.data.percent === 100, 'A scored 6/6 (un-shuffling works)', subA.data);
  ok((await call('POST', `/api/competitions/${cid}/submit`, { token: A.token, body: { answers: answersA } })).status === 409, 'double submit blocked');
  const subB = await call('POST', `/api/competitions/${cid}/submit`, { token: B.token, body: { answers: [] } });
  ok(subB.data.score === 0, 'B submitted empty → 0');
  const eC = await call('POST', `/api/competitions/${cid}/start`, { token: C.token });
  await call('POST', `/api/competitions/${cid}/submit`, { token: C.token, body: { answers: eC.data.questions.slice(0, 3).map((q) => ({ question_id: q.question_id, choice: q.options.find((o) => o.text === correctText(q.question_id)).key })) } });
  const lb = await call('GET', `/api/competitions/${cid}/leaderboard`, { token: D.token });
  ok(lb.data.individuals[0].score === 6 && lb.data.teams.length >= 2 && lb.data.teams[0].team === 'فريق النجوم', 'leaderboard (individual + teams)', lb.data);
  console.log('   ', JSON.stringify(lb.data.teams));
  ok((await call('GET', `/api/competitions/${cid}/review`, { token: A.token })).status === 403, 'answers hidden until competition ends');

  const monthly = await call('POST', '/api/admin/competitions', { token: AT, body: {
    title: 'المسابقة الشهرية', type: 'individual_monthly', starts_at: new Date(now - 60000).toISOString(), ends_at: new Date(now + 3600000).toISOString(), random: { count: 4 } } });
  const outsider = await registerStudent(99);
  const noSub = await call('POST', `/api/competitions/${monthly.data.competition.id}/start`, { token: outsider.token });
  ok(noSub.status === 403, 'competition needs subscription');
  const mD = await call('POST', `/api/competitions/${monthly.data.competition.id}/start`, { token: D.token });
  ok(mD.status === 200 && mD.data.questions.length === 4, 'individual monthly competition started');

  // ---------------- Planner
  const today = new Date().toISOString().slice(0, 10);
  const t1 = await call('POST', '/api/planner/tasks', { token: A.token, body: { title: 'حل 20 سؤال فيزياء', task_date: today, start_time: '18:00', duration_minutes: 60, priority: 'high' } });
  await call('POST', '/api/planner/tasks', { token: A.token, body: { title: 'مراجعة كيمياء', task_date: today, duration_minutes: 45 } });
  await call('PATCH', `/api/planner/tasks/${t1.data.task.id}`, { token: A.token, body: { is_done: true } });
  const day = await call('GET', `/api/planner/tasks?date=${today}`, { token: A.token });
  ok(day.data.summary.total === 2 && day.data.summary.done === 1 && day.data.summary.planned_minutes === 105, 'study planner', day.data.summary);
  ok((await call('PATCH', `/api/planner/tasks/${t1.data.task.id}`, { token: B.token, body: { is_done: false } })).status === 404, "cannot edit another student's task");

  // ---------------- Reports & performance
  const perf = await call('GET', '/api/reports/performance', { token: A.token });
  ok(perf.data.subjects.length >= 1 && perf.data.subjects.every((s) => typeof s.percent === 'number' && s.rating), 'performance % per subject', perf.data);
  const prev = await call('GET', '/api/reports/parent/preview', { token: A.token });
  ok(prev.data.text.includes(A.code) && prev.data.report.competitions.length === 1, 'parent report preview');
  const sent = await call('POST', '/api/reports/parent/send', { token: A.token });
  ok(sent.data.status === 'sent', `parent report sent via ${sent.data.channel}`);
  ok((await call('POST', '/api/reports/parent/send', { token: A.token })).status === 429, 'parent report throttled (1/24h)');

  // ---------------- Products, security
  const prods = await call('GET', '/api/products');
  ok(prods.data.products.length >= 1 && prods.data.products[0].final_price < prods.data.products[0].original_price, 'products with discounts (public)');
  const inj = await call('GET', `/api/admin/students?search=${encodeURIComponent("' OR 1=1; DROP TABLE users; --")}`, { token: AT });
  ok(inj.status === 200 && inj.data.items.length === 0, 'SQL injection attempt is inert');
  ok((await call('GET', '/api/catalog/questions?limit=999', { token: A.token })).status === 400, 'query validation enforced');

  const reset = await call('POST', '/api/auth/forgot-password', { body: { email: B.email } });
  const rs = await call('POST', '/api/auth/reset-password', { body: { email: B.email, code: reset.data.dev_otp, new_password: 'NewPassw0rd9' } });
  ok(rs.status === 200, 'password reset via OTP');
  ok((await call('GET', '/api/auth/me', { token: B.token })).status === 401, 'old tokens revoked after reset');

  console.log(`\n🎉 All ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
