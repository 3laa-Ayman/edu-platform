const db = require('../config/db');
const { sendEmail, sendSms } = require('./notify.service');
const { subjectPerformance, overall } = require('./stats.service');

const toDate = (d) => d.toISOString().slice(0, 10);

/** Builds a weekly (default 7 days) progress report for a student's parent. */
async function buildReport(userId, days = 7) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  const { rows: [student] } = await db.query(
    `SELECT id, full_name, student_code, parent_phone, parent_email FROM users WHERE id = $1`, [userId]);

  const subjects = await subjectPerformance(userId, { from, to });
  const { rows: competitions } = await db.query(
    `SELECT c.title, e.score, e.total_questions,
            (SELECT COUNT(*) + 1 FROM competition_entries e2
              WHERE e2.competition_id = e.competition_id AND e2.submitted_at IS NOT NULL
                AND (e2.score > e.score OR (e2.score = e.score AND e2.duration_seconds < e.duration_seconds)))::int AS rank
       FROM competition_entries e JOIN competitions c ON c.id = e.competition_id
      WHERE e.user_id = $1 AND e.submitted_at BETWEEN $2 AND $3`,
    [userId, from, to],
  );
  const { rows: [tasks] } = await db.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_done)::int AS done
       FROM study_tasks WHERE user_id = $1 AND task_date BETWEEN $2::date AND $3::date`,
    [userId, from, to],
  );
  const { rows: [mist] } = await db.query(`SELECT COUNT(*)::int AS open FROM mistakes WHERE user_id = $1`, [userId]);

  return {
    student: { name: student.full_name, code: student.student_code },
    contact: { parent_phone: student.parent_phone, parent_email: student.parent_email },
    period: { from: toDate(from), to: toDate(to) },
    overall: overall(subjects),
    subjects,
    competitions,
    study_tasks: { ...tasks, completion_percent: tasks.total ? Math.round((tasks.done / tasks.total) * 100) : null },
    open_mistakes: mist.open,
  };
}

function formatReportText(r) {
  const lines = [
    `تقرير متابعة الطالب: ${r.student.name} (${r.student.code})`,
    `الفترة: ${r.period.from} إلى ${r.period.to}`,
    `الأداء العام: ${r.overall.percent ?? '-'}% (${r.overall.rating}) — ${r.overall.correct}/${r.overall.attempts} إجابة صحيحة`,
    '',
    'الأداء حسب المادة:',
    ...(r.subjects.length ? r.subjects.map((s) => `• ${s.subject}: ${s.percent}% (${s.rating})`) : ['• لا يوجد حل أسئلة في هذه الفترة']),
    '',
    `مهام المذاكرة: ${r.study_tasks.done}/${r.study_tasks.total} مكتملة`,
    `أسئلة في بنك الأخطاء لم تُحل بعد: ${r.open_mistakes}`,
  ];
  if (r.competitions.length) {
    lines.push('', 'المسابقات:');
    for (const c of r.competitions) lines.push(`• ${c.title}: ${c.score}/${c.total_questions} — الترتيب ${c.rank}`);
  }
  return lines.join('\n');
}

/** Sends the report by email (if the parent email exists) otherwise by SMS, and stores it. */
async function sendParentReport(userId, days = 7) {
  const report = await buildReport(userId, days);
  const text = formatReportText(report);
  let channel = 'log';
  let status = 'sent';
  let error = null;
  try {
    const out = report.contact.parent_email
      ? await sendEmail({ to: report.contact.parent_email, subject: `تقرير الطالب ${report.student.name}`, text, html: `<pre dir="rtl" style="font-family:inherit">${escapeHtml(text)}</pre>` })
      : await sendSms(report.contact.parent_phone, text);
    channel = out.channel;
  } catch (e) {
    status = 'failed';
    error = e.message;
  }
  await db.query(
    `INSERT INTO parent_reports (user_id, period_start, period_end, summary, channel, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, report.period.from, report.period.to, JSON.stringify(report), channel, status, error],
  );
  return { status, channel, report };
}

async function sendWeeklyReportsToAll() {
  const { rows } = await db.query(`SELECT id FROM users WHERE role = 'student' AND is_verified AND is_active`);
  let sent = 0;
  let failed = 0;
  for (const { id } of rows) {
    const r = await sendParentReport(id).catch(() => ({ status: 'failed' }));
    if (r.status === 'sent') sent++;
    else failed++;
  }
  return { students: rows.length, sent, failed };
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

module.exports = { buildReport, formatReportText, sendParentReport, sendWeeklyReportsToAll };
