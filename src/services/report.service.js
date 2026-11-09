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

/** Parent report rating: 85+ ممتاز · 75+ جيد جداً · 70+ جيد · 60+ يحتاج تحسين · below 60 ضعيف. */
function reportGrade(percent) {
  if (percent === null || percent === undefined) return 'لا توجد إجابات';
  if (percent >= 85) return 'ممتاز';
  if (percent >= 75) return 'جيد جداً';
  if (percent >= 70) return 'جيد';
  if (percent >= 60) return 'يحتاج تحسين';
  return 'ضعيف';
}

/** The text the parent receives (WhatsApp / email), in the format chosen by the platform owner. */
function formatReportText(r) {
  const block = (percent, correct, attempts) => [
    percent === null || percent === undefined ? 'لا توجد إجابات في هذه الفترة' : `${percent}% (${reportGrade(percent)})`,
    `عدد الإجابات الصحيحة: ${correct} من ${attempts}`,
  ];
  const [overallLine, overallCount] = block(r.overall.percent, r.overall.correct, r.overall.attempts);
  const lines = [
    `تقرير متابعة الطالب: ${r.student.name} (${r.student.code})`,
    `الفترة: ${r.period.from} إلى ${r.period.to}`,
    '',
    `الأداء العام: ${overallLine}`,
    overallCount,
    '',
    'الأداء في المواد الدراسية:',
  ];
  if (r.subjects.length) {
    for (const s of r.subjects) {
      const [line, count] = block(s.percent, s.correct, s.attempts);
      lines.push(`• ${s.subject}: ${line}`, `   ${count}`);
    }
  } else {
    lines.push('• لم يحل الطالب أسئلة في هذه الفترة');
  }
  lines.push('', 'مع تمنياتنا لكم بالتوفيق والنجاح');
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

/*
 * Weekly reports for every student, in batches: one serverless call is limited to ~60 s, and sending thousands of
 * emails takes much longer. A "run" (job_runs.started_at) makes every student due once; each batch sends to due
 * students for a time budget (several at a time), and the caller starts the next batch until none are left.
 * A lease (locked_until) keeps two batches from sending to the same students.
 */
const RUN = 'parent-reports';
const BATCH_MS = Number(process.env.REPORT_BATCH_MS) || 40_000;
const CONCURRENCY = 8;
const DUE = `
  FROM users u
 WHERE u.role = 'student' AND u.is_verified AND u.is_active AND u.student_code IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM parent_reports r WHERE r.user_id = u.id AND r.sent_at >= $1)`;

/** Starts a new run: every student gets a report (again). */
async function startWeeklyReports() {
  await db.query(
    `INSERT INTO job_runs (name, started_at) VALUES ($1, now())
     ON CONFLICT (name) DO UPDATE SET started_at = now(), updated_at = now()`, [RUN]);
}

async function countDue() {
  const { rows: [r] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM job_runs j CROSS JOIN LATERAL (SELECT u.id ${DUE.replaceAll('$1', 'j.started_at')}) d WHERE j.name = $1`, [RUN]);
  return r.n;
}

/** One batch of the current run. Returns { sent, failed, remaining } (busy: another batch is running). */
async function sendDueReports({ budgetMs = BATCH_MS } = {}) {
  const deadline = Date.now() + budgetMs;
  const { rows: [lease] } = await db.query(
    `UPDATE job_runs SET locked_until = now() + make_interval(secs => $2), updated_at = now()
      WHERE name = $1 AND started_at IS NOT NULL AND (locked_until IS NULL OR locked_until < now())
      RETURNING started_at`, [RUN, Math.ceil(budgetMs / 1000) + 30]);
  if (!lease) return { busy: true, sent: 0, failed: 0, remaining: await countDue() };
  let sent = 0;
  let failed = 0;
  try {
    while (Date.now() < deadline) {
      const { rows } = await db.query(`SELECT u.id ${DUE} ORDER BY u.id LIMIT 200`, [lease.started_at]);
      if (!rows.length) break;
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
        while (next < rows.length && Date.now() < deadline) {
          const { id } = rows[next++];
          const r = await sendParentReport(id).catch((e) => recordFailure(id, e));
          if (r.status === 'sent') sent++;
          else failed++;
        }
      }));
    }
  } finally {
    await db.query(`UPDATE job_runs SET locked_until = NULL WHERE name = $1`, [RUN]);
  }
  return { sent, failed, remaining: await countDue() };
}

/** A report that could not even be built still counts as done for this run (so it is not retried forever). */
async function recordFailure(userId, err) {
  const day = toDate(new Date());
  await db.query(
    `INSERT INTO parent_reports (user_id, period_start, period_end, summary, channel, status, error)
     VALUES ($1, $2, $2, '{}', 'log', 'failed', $3)`, [userId, day, String(err?.message || err).slice(0, 500)]).catch(() => {});
  return { status: 'failed' };
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

module.exports = { buildReport, formatReportText, reportGrade, sendParentReport, startWeeklyReports, sendDueReports, countDue };
