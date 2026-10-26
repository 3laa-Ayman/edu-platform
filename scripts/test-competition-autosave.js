/**
 * Competition autosave / auto-submit scenarios (needs the API running locally + DATABASE_URL of the same DB).
 *   node scripts/test-competition-autosave.js
 */
const db = require('../src/config/db');

const API = process.env.API_URL || 'http://localhost:4000';
let failed = 0;
const ok = (c, m, extra) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) { failed++; if (extra !== undefined) console.log(JSON.stringify(extra, null, 2)); } };
const call = async (method, url, body, token) => {
  const res = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const expire = (entryId) => db.query(`UPDATE competition_entries SET deadline_at = now() - interval '2 minutes', started_at = now() - interval '20 minutes' WHERE id = $1`, [entryId]);

async function student(tag) {
  const email = `auto-${tag}-${Date.now()}@t.com`;
  const r = await call('POST', '/api/auth/register', { full_name: `طالب ${tag}`, email, phone: '01055500011', parent_phone: '01155500011' });
  const v = await call('POST', '/api/auth/verify-otp', { email, code: r.data.dev_otp });
  const p = await call('POST', '/api/auth/set-password', { setup_token: v.data.setup_token, password: 'Passw0rd123' });
  const co = await call('POST', '/api/payments/checkout', { plan_code: 'premium', provider: 'paymob' }, p.data.token);
  await call('POST', `/api/payments/${co.data.payment.reference}/dev-simulate-paid`, {}, p.data.token);
  return p.data.token;
}

(async () => {
  const admin = (await call('POST', '/api/auth/login', { identifier: 'admin@example.com', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' })).data.token;
  const now = Date.now();
  const comp = (await call('POST', '/api/admin/competitions', {
    title: 'اختبار الحفظ التلقائي', type: 'individual_monthly', starts_at: new Date(now - 60000).toISOString(),
    ends_at: new Date(now + 3600000).toISOString(), duration_minutes: 15, random: { count: 4 } }, admin)).data.competition;
  const cid = comp.id;

  // 1) Autosave + resume on "another device"
  const s1 = await student('a');
  const e1 = (await call('POST', `/api/competitions/${cid}/start`, null, s1)).data;
  const pick = e1.questions.slice(0, 2).map((q) => ({ question_id: q.question_id, choice: 'B' }));
  const saved = await call('PUT', `/api/competitions/${cid}/answers`, { answers: pick }, s1);
  ok(saved.status === 200 && saved.data.saved === 2, 'autosave stores answers on the server');
  const resumed = (await call('POST', `/api/competitions/${cid}/start`, null, s1)).data;
  ok(Object.keys(resumed.saved_answers).length === 2 && resumed.saved_answers[pick[0].question_id] === 'B', 'resume returns the saved answers (e.g. another device)');
  await call('PUT', `/api/competitions/${cid}/answers`, { answers: [{ question_id: pick[1].question_id, choice: null }] }, s1);
  ok(Object.keys((await call('POST', `/api/competitions/${cid}/start`, null, s1)).data.saved_answers).length === 1, 'clearing an answer removes it from the draft');

  // 2) Tab closed → time runs out → auto-submitted with the saved answers
  await expire(e1.entry_id);
  const list = (await call('GET', '/api/competitions', null, s1)).data.competitions.find((c) => c.id === cid);
  ok(list.my_submitted_at && list.my_score !== null, `closed tab: auto-submitted when time ran out (score ${list.my_score})`, list);
  const { rows: [answersCount] } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE selected_option IS NOT NULL)::int AS answered, COUNT(*)::int AS total
       FROM competition_answers WHERE entry_id = $1`, [e1.entry_id]);
  ok(answersCount.answered === 1 && answersCount.total === 4, 'graded exactly the saved answer, the rest counted as skipped', answersCount);

  // 3) Comes back after the deadline → start reports TIME_UP (already submitted)
  const s2 = await student('b');
  const e2 = (await call('POST', `/api/competitions/${cid}/start`, null, s2)).data;
  await call('PUT', `/api/competitions/${cid}/answers`, { answers: [{ question_id: e2.questions[0].question_id, choice: 'A' }] }, s2);
  await expire(e2.entry_id);
  const back = await call('POST', `/api/competitions/${cid}/start`, null, s2);
  ok(back.status === 409 && back.data.error.code === 'TIME_UP', 'coming back after the deadline: auto-submitted, told TIME_UP', back.data);
  ok((await call('POST', `/api/competitions/${cid}/start`, null, s2)).status === 409, 'cannot start again after auto-submit');

  // 4) Late submit (connection came back after the deadline) → saved answers count, new ones ignored
  const s3 = await student('c');
  const e3 = (await call('POST', `/api/competitions/${cid}/start`, null, s3)).data;
  await call('PUT', `/api/competitions/${cid}/answers`, { answers: [{ question_id: e3.questions[0].question_id, choice: 'C' }] }, s3);
  await expire(e3.entry_id);
  const late = await call('POST', `/api/competitions/${cid}/submit`, { answers: e3.questions.map((q) => ({ question_id: q.question_id, choice: 'A' })) }, s3);
  ok(late.status === 200 && late.data.late === true && late.data.skipped === 3, 'late submit: graded with the answers saved before the deadline', late.data);

  // 5) Leaderboard closes any remaining expired entries
  const s4 = await student('d');
  const e4 = (await call('POST', `/api/competitions/${cid}/start`, null, s4)).data;
  await expire(e4.entry_id);
  const lb = (await call('GET', `/api/competitions/${cid}/leaderboard`, null, s4)).data;
  ok(lb.individuals.length === 4, `leaderboard includes auto-submitted entries (${lb.individuals.length})`);
  const { rows: [open] } = await db.query(`SELECT COUNT(*)::int AS n FROM competition_entries WHERE competition_id = $1 AND submitted_at IS NULL`, [cid]);
  ok(open.n === 0, 'no expired entry left open');

  await call('DELETE', `/api/admin/competitions/${cid}`, null, admin);
  await db.pool.end();
  console.log(failed ? `\n${failed} failed` : '\n🎉 all competition autosave checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
