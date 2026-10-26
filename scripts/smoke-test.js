/**
 * End-to-end smoke test against a running server.
 *   API_URL=http://localhost:4000 PAYMOB_HMAC_SECRET=... node scripts/smoke-test.js
 * Requires: NODE_ENV != production, OTP_DEV_ECHO=true, AUTH_RATE_LIMIT high enough (~100).
 */
const fs = require('fs');
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

/** Registration: details → email OTP → set password → student code. */
async function registerStudent(i) {
  const email = `s${i}-${rnd}@test.com`;
  const r = await call('POST', '/api/auth/register', {
    body: { full_name: `طالب ${i} تجربة`, email, phone: phone(i), parent_phone: phone(i + 50), parent_email: i === 0 ? `p0-${rnd}@test.com` : undefined },
  });
  ok(r.status === 201 && r.data.dev_otp && !r.data.student_code, `register student ${i} (no password, no code yet)`, r.data);
  const v = await call('POST', '/api/auth/verify-otp', { body: { email, code: r.data.dev_otp } });
  ok(v.status === 200 && v.data.setup_token && !v.data.token, `verify OTP student ${i} → setup token only`, v.data);
  const p = await call('POST', '/api/auth/set-password', { body: { setup_token: v.data.setup_token, password: 'Passw0rd123' } });
  ok(p.status === 201 && /^STU-\d{4}-\d{4,}$/.test(p.data.student_code) && p.data.token, `set password student ${i} → ${p.data.student_code}`, p.data);
  return { email, code: p.data.student_code, token: p.data.token, id: p.data.user.id, setupToken: v.data.setup_token };
}

(async () => {
  ok((await call('GET', '/health')).status === 200, 'health');

  // ---------------- Auth
  const S = [];
  for (let i = 0; i < 7; i++) S.push(await registerStudent(i));
  const [A, B, C, D] = S;
  const codeNum = (c) => Number(c.split('-')[2]);
  ok(S.every((s, i) => i === 0 || codeNum(s.code) === codeNum(S[i - 1].code) + 1), 'student codes are sequential');

  const dup = await call('POST', '/api/auth/register', { body: { full_name: 'dup user', email: A.email, phone: '01011111111', parent_phone: '01022222222' } });
  ok(dup.status === 409, 'duplicate email rejected');
  const weak = await call('POST', '/api/auth/register', { body: { full_name: 'weak', email: `w-${rnd}@t.com`, phone: '123', parent_phone: '01022222222' } });
  ok(weak.status === 400 && weak.data.error.code === 'VALIDATION_ERROR', 'bad phone rejected');
  ok((await call('POST', '/api/auth/set-password', { body: { setup_token: A.setupToken, password: 'Another123' } })).status === 409, 'setup token is single-use');
  ok((await call('GET', '/api/auth/me', { token: A.setupToken })).status === 401, 'setup token cannot be used as login token');

  const pending = await call('POST', '/api/auth/register', { body: { full_name: 'otp user', email: `o-${rnd}@t.com`, phone: '01033333333', parent_phone: '01044444444' } });
  const wrong = await call('POST', '/api/auth/verify-otp', { body: { email: `o-${rnd}@t.com`, code: pending.data.dev_otp === '000000' ? '111111' : '000000' } });
  ok(wrong.status === 400, 'wrong OTP rejected');
  const noPassLogin = await call('POST', '/api/auth/login', { body: { identifier: `o-${rnd}@t.com`, password: 'Passw0rd123' } });
  ok(noPassLogin.status === 401, 'unfinished registration cannot log in');
  const ok2 = await call('POST', '/api/auth/verify-otp', { body: { email: `o-${rnd}@t.com`, code: pending.data.dev_otp } });
  const weakPass = await call('POST', '/api/auth/set-password', { body: { setup_token: ok2.data.setup_token, password: '123' } });
  ok(weakPass.status === 400, 'weak password rejected at set-password');
  // Abandoned after OTP: registering again with the same email restarts the flow (no 409)
  const again = await call('POST', '/api/auth/register', { body: { full_name: 'otp user 2', email: `o-${rnd}@t.com`, phone: '01033333334', parent_phone: '01044444445' } });
  ok(again.status === 201 || again.status === 429, 'unfinished registration can restart with same email');

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
  const N = wb.worksheets[0].actualRowCount - 1; // questions in the template
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  const form = () => { const f = new FormData(); f.append('file', new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'q.xlsx'); return f; };
  const dry = await call('POST', '/api/admin/questions/upload?dry_run=true', { token: AT, form: form() });
  ok(dry.status === 200 && dry.data.valid_rows === N && dry.data.images === 5, `excel dry run: ${N} valid rows, 5 images`, dry.data);
  const up = await call('POST', '/api/admin/questions/upload', { token: AT, form: form() });
  ok(up.status === 201 && up.data.inserted === N && up.data.images === 5, `excel import: ${N} inserted + 5 images`, up.data);
  const up2 = await call('POST', '/api/admin/questions/upload', { token: AT, form: form() });
  ok(up2.data.inserted === 0 && up2.data.duplicates === N, 're-upload → all duplicates skipped');
  const badFile = new FormData(); badFile.append('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  ok((await call('POST', '/api/admin/questions/upload', { token: AT, form: badFile })).status === 400, 'non-xlsx rejected');

  // ---------------- Subscriptions
  ok((await call('GET', '/api/catalog/questions', { token: A.token })).status === 403, 'practice requires subscription');
  const plans = await call('GET', '/api/payments/plans', { token: A.token });
  const price = Object.fromEntries(plans.data.plans.map((p) => [p.code, Number(p.price_egp)]));
  ok(price.standard > 0 && price.premium > price.standard, `plans ${price.standard} / ${price.premium}`, plans.data);

  const co = await call('POST', '/api/payments/checkout', { token: A.token, body: { plan_code: 'premium', provider: 'paymob' } });
  ok(co.status === 201 && co.data.mock, 'paymob checkout (dev mock)', co.data);
  const sim = await call('POST', `/api/payments/${co.data.payment.reference}/dev-simulate-paid`, { token: A.token });
  ok(sim.data.activated && sim.data.subscription.plan_code === 'premium', 'A premium activated');

  // Paymob webhook with a real HMAC
  if (process.env.PAYMOB_HMAC_SECRET) {
    const coD = await call('POST', '/api/payments/checkout', { token: D.token, body: { plan_code: 'standard', provider: 'paymob' } });
    const obj = {
      id: 990000 + Math.floor(Math.random() * 9999), amount_cents: Math.round(price.standard * 100), created_at: new Date().toISOString(), currency: 'EGP',
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
  ok((await call('GET', '/api/catalog/questions?limit=50', { token: A.token })).status === 400, 'practice requires choosing a subject (no "all subjects")');
  const physics = subjects.data.subjects.find((s) => s.name === 'فيزياء');
  const qs = await call('GET', `/api/catalog/questions?limit=50&subject_id=${physics.id}`, { token: A.token });
  ok(qs.data.questions.length >= 3 && qs.data.questions.every((q) => q.subject_id === physics.id && !('correct_option' in q) && !('explanation' in q)), 'questions of the chosen subject only, served without answers');
  // Past exams are part of the standard plan (admins can still change plan features).
  const stdPlan = (await call('GET', '/api/admin/plans', { token: AT })).data.plans.find((p) => p.code === 'standard');
  await call('PATCH', '/api/admin/plans/standard', { token: AT, body: { features: { ...stdPlan.features, past_exams: true } } });
  const pastStd = await call('GET', `/api/catalog/questions?category=past_exam&subject_id=${physics.id}`, { token: B.token });
  ok(pastStd.status === 200 && pastStd.data.questions.every((q) => q.category === 'past_exam'), 'past exams available on the standard plan (B is standard)');

  const allQ = await call('GET', '/api/admin/questions?limit=100', { token: AT });
  const byText = (t) => allQ.data.items.find((q) => q.question_text.includes(t) && q.question_text.includes(rnd));
  const qWithExp = byText('كتلته 2 كجم');
  const qNoExp = byText('سرعة الضوء');
  const qNoExp2 = byText('غاز نبيل');
  const wrongOf = (q) => ['A', 'B', 'C', 'D'].find((l) => l !== q.correct_option);

  // ---------------- Question images
  const triQ = byText('طول الوتر');
  const graphAdm = byText('علاقة طردية');
  ok(triQ.media.question && graphAdm.media.option_a && graphAdm.media.option_d && !graphAdm.media.question, 'images attached to question / options from Excel');
  const imgRes = await fetch(API + triQ.media.question);
  ok(imgRes.status === 200 && imgRes.headers.get('content-type') === 'image/png' && /immutable/.test(imgRes.headers.get('cache-control')), 'image served (png, cached)');
  ok((await fetch(API + triQ.media.question.replace(/[0-9a-f]{16}$/, '0000000000000000'))).status === 404, 'wrong image hash → 404');
  const practiceAll = await call('GET', `/api/catalog/questions?limit=50&subject_id=${triQ.subject_id}`, { token: A.token });
  const pTri = practiceAll.data.questions.find((q) => q.id === triQ.id);
  ok(pTri && pTri.image === triQ.media.question, 'students get question image in practice');
  const pinned = await (async () => {
    const fd = new FormData();
    fd.append('image', new Blob([fs.readFileSync(path.join(__dirname, '../templates/images/graph-b.png'))], { type: 'image/png' }), 'x.png');
    return call('PUT', `/api/admin/questions/${qWithExp.id}/media/explanation`, { token: AT, form: fd });
  })();
  ok(pinned.status === 200 && pinned.data.url.includes('/explanation/'), 'admin uploads explanation image');
  const fakeImg = new FormData(); fakeImg.append('image', new Blob(['not an image at all'], { type: 'image/png' }), 'x.png');
  ok((await call('PUT', `/api/admin/questions/${qWithExp.id}/media/question`, { token: AT, form: fakeImg })).status === 400, 'fake image rejected (content check)');
  ok((await call('PUT', `/api/admin/questions/${qWithExp.id}/media/question`, { token: A.token, form: fakeImg })).status === 403, 'students cannot upload images');

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
  ok(free.data.explanation_image && free.data.explanation_image.includes('/explanation/'), 'explanation image returned with the explanation');
  const none = await call('GET', `/api/catalog/questions/${qNoExp.id}/explanation`, { token: A.token });
  ok(none.data.source === null && none.data.ai_available, 'no saved explanation → offers AI');
  const ai1 = await call('POST', `/api/ai/explain/${qNoExp.id}`, { token: A.token });
  ok(ai1.status === 200 && ai1.data.source === 'gemini' && ai1.data.usage.cost_egp > 0, `gemini explanation, cost ${ai1.data.usage?.cost_egp} EGP`, ai1.data);
  // Plus (standard) shows the AI button, but using it needs Premium.
  await call('POST', '/api/catalog/answer', { token: B.token, body: { question_id: qNoExp.id, choice: 'A' } });
  ok((await call('GET', `/api/catalog/questions/${qNoExp.id}/explanation`, { token: B.token })).data.ai_available, 'Plus student is offered the AI button');
  const plusAi = await call('POST', `/api/ai/explain/${qNoExp.id}`, { token: B.token });
  ok(plusAi.status === 403 && plusAi.data.error.code === 'PLAN_UPGRADE_REQUIRED' && plusAi.data.error.message.includes(price.premium ? 'Premium' : '')
    && plusAi.data.error.details?.plan_code === 'premium', `Plus → "${plusAi.data.error?.message}"`, plusAi.data);
  const ai2 = await call('POST', `/api/ai/explain/${qNoExp.id}`, { token: AT });
  if (ai1.data.explanation.startsWith('[شرح تجريبي')) {
    // No GEMINI_API_KEY: the mock must never be cached, or it would hide the AI button from everyone.
    ok(ai2.data.source === 'gemini', 'mock AI explanation is not cached');
    ok((await call('GET', `/api/catalog/questions/${qNoExp.id}/explanation`, { token: A.token })).data.ai_available, 'AI button still offered after a mock explanation');
  } else {
    ok(ai2.data.source === 'ai_cache' && ai2.data.usage.cost_egp === 0, 'second student gets cached AI explanation free');
  }
  const usage = await call('GET', '/api/ai/usage', { token: A.token });
  ok(usage.data.spent_egp > 0 && usage.data.limit_egp === 100 && usage.data.requests === 1, 'AI usage tracked per student', usage.data);
  ok(usage.data.limit_points === 10000 && usage.data.points_per_egp === 100 && usage.data.remaining_points < 10000, `AI budget shown as points: ${usage.data.remaining_points} / ${usage.data.limit_points}`, usage.data);
  ok(ai1.data.usage.cost_points > 0 && ai1.data.usage.limit_points === 10000, 'explanation reports cost in points');

  await call('PATCH', `/api/admin/students/${A.id}`, { token: AT, body: { ai_limit_egp: usage.data.spent_egp } });
  await call('POST', '/api/catalog/answer', { token: A.token, body: { question_id: qNoExp2.id, choice: 'A' } });
  const blocked = await call('POST', `/api/ai/explain/${qNoExp2.id}`, { token: A.token });
  ok(blocked.status === 402 && blocked.data.error.code === 'AI_LIMIT_REACHED' && blocked.data.error.message.includes('نقطة'), 'AI blocked at spending cap (message in points)');
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
  ok(comp.status === 201 && comp.data.competition.question_count === N, 'admin created team competition');
  const cid = comp.data.competition.id;
  const eA = await call('POST', `/api/competitions/${cid}/start`, { token: A.token });
  const eB = await call('POST', `/api/competitions/${cid}/start`, { token: B.token });
  ok(eA.data.questions.length === N, 'A started competition');
  const graphQ = eA.data.questions.find((q) => q.question.includes('علاقة طردية'));
  ok(graphQ && graphQ.options.every((o) => o.image && !o.text), 'competition options can be images (shuffled with them)');
  const sig = (e) => e.data.questions.map((q) => q.question_id + q.options.map((o) => o.text).join('')).join('|');
  ok(sig(eA) !== sig(eB), 'questions/options shuffled differently per student');
  const eA2 = await call('POST', `/api/competitions/${cid}/start`, { token: A.token });
  ok(sig(eA2) === sig(eA), 'resume returns the same order');

  // Answer everything correctly for A by mapping displayed text back to the right option
  // Identify the correct displayed option by its text AND image (image-only options have empty text).
  const correctKey = (dq) => {
    const q = allQ.data.items.find((x) => x.id === dq.question_id);
    const slot = `option_${q.correct_option.toLowerCase()}`;
    return dq.options.find((o) => o.text === q[slot] && (o.image || null) === (q.media[slot] || null)).key;
  };
  const answersA = eA.data.questions.map((q) => ({ question_id: q.question_id, choice: correctKey(q) }));
  const subA = await call('POST', `/api/competitions/${cid}/submit`, { token: A.token, body: { answers: answersA } });
  ok(subA.data.score === N && subA.data.percent === 100, `A scored ${N}/${N} (un-shuffling works)`, subA.data);
  ok((await call('POST', `/api/competitions/${cid}/submit`, { token: A.token, body: { answers: answersA } })).status === 409, 'double submit blocked');
  const mistakesBefore = (await call('GET', '/api/mistakes/summary', { token: B.token })).data.total;
  const perfBefore = (await call('GET', '/api/reports/performance', { token: B.token })).data.overall;
  const subB = await call('POST', `/api/competitions/${cid}/submit`, { token: B.token, body: { answers: [] } });
  ok(subB.data.score === 0 && subB.data.skipped === N && subB.data.wrong === 0, `B submitted empty → 0 points, ${N} skipped, 0 wrong`, subB.data);
  ok((await call('GET', '/api/mistakes/summary', { token: B.token })).data.total === mistakesBefore, 'skipped questions NOT added to mistakes bank');
  const perfAfter = (await call('GET', '/api/reports/performance', { token: B.token })).data.overall;
  ok(perfAfter.attempts === perfBefore.attempts && perfAfter.percent === perfBefore.percent, 'skipped questions do not lower the performance %');
  const eC = await call('POST', `/api/competitions/${cid}/start`, { token: C.token });
  const subC = await call('POST', `/api/competitions/${cid}/submit`, { token: C.token, body: { answers: eC.data.questions.slice(0, 3).map((q) => ({ question_id: q.question_id, choice: correctKey(q) })) } });
  ok(subC.data.correct === 3 && subC.data.skipped === N - 3 && subC.data.wrong === 0, 'partial submit: correct / skipped split');
  const lb = await call('GET', `/api/competitions/${cid}/leaderboard`, { token: D.token });
  ok(lb.data.individuals[0].score === N && lb.data.teams.length >= 2 && lb.data.teams[0].team === 'فريق النجوم', 'leaderboard (individual + teams)', lb.data);
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

  // ---------------- Admin management (no developer needed)
  const subj = await call('POST', '/api/admin/subjects', { token: AT, body: { name: `أحياء ${rnd}` } });
  ok(subj.status === 201, 'admin adds a subject');
  const sid = subj.data.subject.id;
  ok((await call('PATCH', `/api/admin/subjects/${sid}`, { token: AT, body: { name: `الأحياء ${rnd}` } })).data.subject.name === `الأحياء ${rnd}`, 'admin renames subject');
  const les = await call('POST', `/api/admin/subjects/${sid}/lessons`, { token: AT, body: { name: 'الخلية', lesson_type: 'نظري' } });
  ok(les.status === 201, 'admin adds a lesson');
  const qBody = { subject_id: sid, lesson_id: les.data.lesson.id, question_text: `وحدة بناء الكائن الحي هي ${rnd}`, option_a: 'الخلية', option_b: 'النسيج', option_c: 'العضو', option_d: 'الجهاز', correct_option: 'A', explanation: 'الخلية هي الوحدة الأساسية' };
  const nq = await call('POST', '/api/admin/questions', { token: AT, body: qBody });
  ok(nq.status === 201 && nq.data.question.lesson_id === les.data.lesson.id, 'admin adds a single question');
  ok((await call('POST', '/api/admin/questions', { token: AT, body: qBody })).status === 409, 'duplicate single question rejected');
  const otherSubj = (await call('POST', '/api/admin/subjects', { token: AT, body: { name: `جيولوجيا ${rnd}` } })).data.subject;
  ok((await call('PATCH', `/api/admin/questions/${nq.data.question.id}`, { token: AT, body: { lesson_id: les.data.lesson.id, subject_id: otherSubj.id } })).status === 400, 'lesson must belong to subject');
  const moved = await call('PATCH', `/api/admin/questions/${nq.data.question.id}`, { token: AT, body: { subject_id: otherSubj.id, correct_option: 'A', exam_year: 2024, category: 'past_exam' } });
  ok(moved.data.question.subject_id === otherSubj.id && moved.data.question.lesson_id === null && moved.data.question.exam_year === 2024, 'admin moves question to another subject');
  ok((await call('DELETE', `/api/admin/subjects/${otherSubj.id}`, { token: AT })).status === 409, 'cannot delete subject that has questions');
  const delQ = await call('DELETE', `/api/admin/questions/${nq.data.question.id}`, { token: AT });
  ok(delQ.data.deleted === true, 'unused question deleted');
  const usedDel = await call('DELETE', `/api/admin/questions/${qWithExp.id}`, { token: AT });
  ok(usedDel.data.hidden === true, 'answered question hidden instead of deleted');
  await call('PATCH', `/api/admin/questions/${qWithExp.id}`, { token: AT, body: { is_active: true } });
  ok((await call('DELETE', `/api/admin/subjects/${otherSubj.id}`, { token: AT })).status === 204, 'empty subject deleted');
  ok((await call('DELETE', `/api/admin/lessons/${les.data.lesson.id}`, { token: AT })).status === 204, 'lesson deleted');

  // Plans: price change + feature toggle is enforced immediately
  const plansAdm = await call('GET', '/api/admin/plans', { token: AT });
  ok(plansAdm.data.plans.length >= 2 && plansAdm.data.features.includes('past_exams'), 'admin lists plans');
  await call('PATCH', '/api/admin/plans/standard', { token: AT, body: { price_egp: price.standard + 10, features: { ...plansAdm.data.plans.find((p) => p.code === 'standard').features, practice: false } } });
  ok((await call('GET', '/api/payments/plans', { token: D.token })).data.plans.find((p) => p.code === 'standard').price_egp === price.standard + 10, 'new plan price visible to students');
  const blockedPractice = await call('GET', '/api/catalog/questions', { token: D.token });
  ok(blockedPractice.status === 403 && blockedPractice.data.error.code === 'PLAN_UPGRADE_REQUIRED', 'disabled plan feature is enforced');
  await call('PATCH', '/api/admin/plans/standard', { token: AT, body: { price_egp: price.standard, features: plansAdm.data.plans.find((p) => p.code === 'standard').features } });
  ok((await call('GET', `/api/catalog/questions?subject_id=${physics.id}`, { token: D.token })).status === 200, 'feature re-enabled');
  const newPlan = await call('POST', '/api/admin/plans', { token: AT, body: { code: `p${rnd}`, name_ar: 'باقة الامتحانات', price_egp: 99, duration_days: 14, rank: 0, features: { practice: true }, is_active: false } });
  ok(newPlan.status === 201, 'admin creates a new plan');

  // Settings
  const set = await call('PATCH', '/api/admin/settings', { token: AT, body: { vodafone_cash_number: '01099998888', site_name: 'منصة التفوق', default_ai_limit_egp: 50 } });
  ok(set.data.settings.vodafone_cash_number === '01099998888', 'admin updates settings');
  ok((await call('GET', '/api/settings/public')).data.site_name === 'منصة التفوق', 'public site name updated');
  await call('PATCH', '/api/admin/settings', { token: AT, body: { ai_points_per_egp: 50 } });
  ok((await call('GET', '/api/ai/usage', { token: A.token })).data.limit_points === 5000, 'points rate is an admin setting (50/EGP → 5,000 points)');
  await call('PATCH', '/api/admin/settings', { token: AT, body: { ai_points_per_egp: 100 } });
  ok((await call('GET', '/api/payments/plans', { token: D.token })).data.manual_payment.vodafone_cash === '01099998888', 'students see new payment number');
  ok((await call('PATCH', '/api/admin/settings', { token: AT, body: { usd_to_egp: -5 } })).status === 400, 'invalid setting rejected');
  await call('PATCH', '/api/admin/settings', { token: AT, body: { site_name: 'منصة المذاكرة', default_ai_limit_egp: 100 } });

  // Students: create, edit, password, grant subscription, cancel
  const ns = await call('POST', '/api/admin/students', { token: AT, body: { full_name: 'طالب من الأدمن', email: `adm-${rnd}@t.com`, password: 'Passw0rd123', phone: '01023456789', parent_phone: '01123456789' } });
  ok(ns.status === 201 && /^STU-/.test(ns.data.student.student_code), 'admin adds a verified student');
  const nsId = ns.data.student.id;
  ok((await call('PATCH', `/api/admin/students/${nsId}`, { token: AT, body: { full_name: 'طالب معدّل', parent_email: `pp-${rnd}@t.com` } })).data.student.full_name === 'طالب معدّل', 'admin edits student');
  await call('POST', `/api/admin/students/${nsId}/password`, { token: AT, body: { new_password: 'NewPassw0rd1' } });
  const nsLogin = await call('POST', '/api/auth/login', { body: { identifier: `adm-${rnd}@t.com`, password: 'NewPassw0rd1' } });
  ok(nsLogin.status === 200, 'admin-set password works');
  const pendingStu = (await call('GET', `/api/admin/students?search=o-${rnd}`, { token: AT })).data.items[0];
  ok(pendingStu && pendingStu.student_code === null, 'admin sees unfinished registration (no code)');
  const fin = await call('POST', `/api/admin/students/${pendingStu.id}/password`, { token: AT, body: { new_password: 'Finish3dIt' } });
  ok(/^STU-/.test(fin.data.student_code), `admin completes registration → ${fin.data.student_code}`);
  ok((await call('POST', '/api/auth/login', { body: { identifier: fin.data.student_code, password: 'Finish3dIt' } })).status === 200, 'completed student can log in');
  const gift = await call('POST', `/api/admin/students/${nsId}/subscriptions`, { token: AT, body: { plan_code: 'premium', days: 7 } });
  ok(gift.status === 201, 'admin grants subscription');
  ok((await call('GET', '/api/auth/me', { token: nsLogin.data.token })).data.subscription?.plan_code === 'premium', 'granted subscription active');
  const det = await call('GET', `/api/admin/students/${nsId}`, { token: AT });
  ok(det.data.subscriptions.length === 1 && det.data.performance, 'admin student details');
  await call('POST', `/api/admin/subscriptions/${gift.data.subscription.id}/cancel`, { token: AT });
  ok((await call('GET', '/api/auth/me', { token: nsLogin.data.token })).data.subscription === null, 'admin cancels subscription');

  // Teams
  const tl = await call('GET', `/api/admin/teams?search=${encodeURIComponent('فريق النجوم')}`, { token: AT });
  const star = tl.data.teams[0];
  ok(star && star.members.length === 2, 'admin lists teams');
  ok((await call('POST', `/api/admin/teams/${star.id}/members`, { token: AT, body: { student_code: ns.data.student.student_code } })).status === 201, 'admin adds member to team');
  ok((await call('PATCH', `/api/admin/teams/${star.id}`, { token: AT, body: { name: 'النجوم المعدّل', captain_id: nsId } })).data.team.captain_id === nsId, 'admin renames team + changes captain');
  ok((await call('DELETE', `/api/admin/teams/${star.id}/members/${nsId}`, { token: AT })).status === 200, 'admin removes member (captain reassigned)');

  // Competitions
  ok((await call('PATCH', `/api/admin/competitions/${cid}`, { token: AT, body: { title: 'مسابقة الجمعة (معدلة)' } })).data.competition.title === 'مسابقة الجمعة (معدلة)', 'admin edits competition');
  ok((await call('DELETE', `/api/admin/competitions/${monthly.data.competition.id}`, { token: AT })).status === 204, 'admin deletes competition');

  // Announcements
  const ann = (body) => call('POST', '/api/admin/announcements', { token: AT, body });
  const aAll = await ann({ title: `إعلان للكل ${rnd}`, body: 'امتحان شامل يوم الجمعة' });
  ok(aAll.status === 201 && aAll.data.announcement.audience === 'all', 'admin posts announcement');
  const aSub = await ann({ title: `للمشتركين ${rnd}`, audience: 'subscribers', tone: 'success', pinned: true });
  const aFree = await ann({ title: `لغير المشتركين ${rnd}`, audience: 'free', link_url: 'https://example.com/offer' });
  const aLater = await ann({ title: `بعدين ${rnd}`, starts_at: new Date(Date.now() + 86400000).toISOString() });
  const aOld = await ann({ title: `قديم ${rnd}`, starts_at: new Date(Date.now() - 2 * 86400000).toISOString(), expires_at: new Date(Date.now() - 86400000).toISOString() });
  const aHidden = await ann({ title: `مخفي ${rnd}`, is_active: false });
  ok((await ann({ title: 'رابط', link_url: 'javascript:alert(1)' })).status === 400, 'announcement link must be http(s)');
  ok((await ann({ title: 'تواريخ', starts_at: new Date().toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() })).status === 400, 'announcement expiry after start');
  const titles = async (token) => (await call('GET', '/api/announcements', { token })).data.announcements.map((a) => a.title).filter((t) => t.includes(rnd));
  const subT = await titles(A.token);
  const freeT = await titles(outsider.token);
  ok(subT.length === 2 && subT[0] === aSub.data.announcement.title && subT.includes(aAll.data.announcement.title), 'subscriber sees all + subscribers (pinned first)', subT);
  ok(freeT.length === 2 && freeT.includes(aFree.data.announcement.title) && freeT.includes(aAll.data.announcement.title), 'free student sees all + free only', freeT);
  ok(![aLater, aOld, aHidden].some((x) => subT.includes(x.data.announcement.title) || freeT.includes(x.data.announcement.title)), 'scheduled / expired / hidden announcements not shown');
  const before = (await call('GET', '/api/announcements', { token: A.token })).data.unread;
  ok((await call('POST', `/api/announcements/${aAll.data.announcement.id}/read`, { token: A.token })).status === 204, 'student marks announcement read');
  const afterRead = await call('GET', '/api/announcements', { token: A.token });
  ok(afterRead.data.unread === before - 1 && afterRead.data.announcements.find((a) => a.id === aAll.data.announcement.id).is_read, 'unread count drops');
  ok((await call('POST', `/api/announcements/${aFree.data.announcement.id}/read`, { token: A.token })).status === 404, 'cannot read an announcement not meant for you');
  ok((await call('POST', `/api/announcements/${aHidden.data.announcement.id}/read`, { token: A.token })).status === 404, 'cannot read a hidden announcement');
  await call('POST', '/api/announcements/read-all', { token: A.token });
  ok((await call('GET', '/api/announcements', { token: A.token })).data.unread === 0, 'read all');
  const edited = await call('PUT', `/api/admin/announcements/${aHidden.data.announcement.id}`, { token: AT, body: { title: `مخفي ${rnd}`, is_active: true } });
  ok(edited.data.announcement.is_active && (await titles(outsider.token)).includes(`مخفي ${rnd}`), 'admin shows a hidden announcement');
  const adminList = await call('GET', '/api/admin/announcements', { token: AT });
  ok(adminList.data.announcements.find((a) => a.id === aAll.data.announcement.id).reads === 1, 'admin sees read count');
  ok((await call('GET', '/api/admin/announcements', { token: A.token })).status === 403, 'students cannot manage announcements');
  ok((await call('DELETE', `/api/admin/announcements/${aOld.data.announcement.id}`, { token: AT })).status === 204, 'admin deletes announcement');

  // Admin accounts
  const na = await call('POST', '/api/admin/admins', { token: AT, body: { full_name: 'مساعد', email: `admin2-${rnd}@t.com`, password: 'Assist4nt99' } });
  ok(na.status === 201, 'admin adds another admin');
  const a2 = await call('POST', '/api/auth/login', { body: { identifier: `admin2-${rnd}@t.com`, password: 'Assist4nt99' } });
  ok(a2.data.user.role === 'admin', 'new admin can log in');
  ok((await call('PATCH', `/api/admin/admins/${admin.data.user.id}`, { token: AT, body: { is_active: false } })).status === 403, 'admin cannot disable self');
  ok((await call('POST', '/api/admin/me/password', { token: a2.data.token, body: { current_password: 'wrong', new_password: 'Another99x' } })).status === 400, 'change password needs current password');
  ok((await call('PATCH', `/api/admin/admins/${na.data.admin.id}`, { token: AT, body: { is_active: false } })).data.admin.is_active === false, 'admin disables another admin');
  ok((await call('GET', '/api/admin/dashboard', { token: a2.data.token })).status === 401, 'disabled admin logged out');

  console.log(`\n🎉 All ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
