const cron = require('node-cron');
const env = require('../config/env');
const db = require('../config/db');
const { autoAssignTeams } = require('../services/team.service');
const { startWeeklyReports, sendDueReports } = require('../services/report.service');
const { finalizeExpired } = require('../services/competition.service');

/** Job registry — run by node-cron on a normal server, or by Vercel Cron via /api/cron/:job. */
const JOBS = {
  // Group students without a team before the Friday competition.
  'auto-assign-teams': () => autoAssignTeams(),
  // Weekly parent reports: starts the run, then batch after batch (see report.service).
  'parent-reports': async (ctx) => { await startWeeklyReports(); return continueReports(ctx); },
  'parent-reports-continue': (ctx) => continueReports(ctx),
  // Housekeeping.
  cleanup: async () => {
    const competitions = await finalizeExpired();
    // Safety net: finishes a report run whose batch chain stopped (e.g. a failed call).
    const reports = await sendDueReports({ budgetMs: 20_000 });
    await db.query(`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'`);
    await db.query(`DELETE FROM device_events WHERE created_at < now() - interval '1 year'`);
    const invites = await db.query(
      `UPDATE team_invites SET status = 'expired', responded_at = now() WHERE status = 'pending' AND created_at < now() - interval '7 days'`);
    const otps = await db.query(`DELETE FROM otp_codes WHERE created_at < now() - interval '2 days'`);
    // Registrations that never reached the "set password" step free their email after 7 days.
    const abandoned = await db.query(
      `DELETE FROM users WHERE role = 'student' AND password_hash IS NULL AND created_at < now() - interval '7 days'`);
    const payments = await db.query(
      `UPDATE payments SET status = 'failed', admin_note = 'expired', updated_at = now()
        WHERE status = 'pending' AND method_type = 'gateway' AND created_at < now() - interval '3 days'`);
    return { parent_reports: reports, competition_entries_finalized: competitions.finalized, invites_expired: invites.rowCount, otps_deleted: otps.rowCount, abandoned_registrations: abandoned.rowCount, payments_expired: payments.rowCount };
  },
};

/**
 * Sends one batch; if students are left: on Vercel the next batch is a new call to this same endpoint
 * (ctx.baseUrl, authorised by CRON_SECRET), on a normal server the loop just continues.
 */
async function continueReports(ctx = {}) {
  let r = await sendDueReports();
  if (r.remaining > 0 && !r.busy && ctx.baseUrl && process.env.CRON_SECRET) {
    await fetch(`${ctx.baseUrl}/api/cron/parent-reports-continue`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(3000), // only needs to start; that call runs on its own
    }).catch(() => {});
    return { ...r, continuing: true };
  }
  while (!ctx.baseUrl && r.remaining > 0 && !r.busy) {
    const more = await sendDueReports();
    if (!more.sent && !more.failed) break;
    r = { ...more, sent: r.sent + more.sent, failed: r.failed + more.failed };
  }
  return r;
}

async function runJob(name, ctx) {
  const out = await JOBS[name](ctx);
  console.log(`[job] ${name} done`, JSON.stringify(out));
  return out;
}

const safe = (name) => () => runJob(name).catch((err) => console.error(`[job] ${name} failed`, err));

function startJobs() {
  const opts = { timezone: env.tz };
  cron.schedule('0 21 * * 4', safe('auto-assign-teams'), opts); // Thursday 21:00 Cairo
  cron.schedule('0 10 * * 6', safe('parent-reports'), opts); // Saturday 10:00 Cairo
  cron.schedule('0 3 * * *', safe('cleanup'), opts); // daily 03:00
  console.log(`[jobs] scheduled (timezone ${env.tz})`);
}

module.exports = { JOBS, runJob, startJobs, continueReports };
