const cron = require('node-cron');
const env = require('../config/env');
const db = require('../config/db');
const { autoAssignTeams } = require('../services/team.service');
const { sendWeeklyReportsToAll } = require('../services/report.service');

/** Job registry — run by node-cron on a normal server, or by Vercel Cron via /api/cron/:job. */
const JOBS = {
  // Group students without a team before the Friday competition.
  'auto-assign-teams': () => autoAssignTeams(),
  // Weekly parent reports.
  'parent-reports': sendWeeklyReportsToAll,
  // Housekeeping.
  cleanup: async () => {
    const invites = await db.query(
      `UPDATE team_invites SET status = 'expired', responded_at = now() WHERE status = 'pending' AND created_at < now() - interval '7 days'`);
    const otps = await db.query(`DELETE FROM otp_codes WHERE created_at < now() - interval '2 days'`);
    // Registrations that never reached the "set password" step free their email after 7 days.
    const abandoned = await db.query(
      `DELETE FROM users WHERE role = 'student' AND password_hash IS NULL AND created_at < now() - interval '7 days'`);
    const payments = await db.query(
      `UPDATE payments SET status = 'failed', admin_note = 'expired', updated_at = now()
        WHERE status = 'pending' AND method_type = 'gateway' AND created_at < now() - interval '3 days'`);
    return { invites_expired: invites.rowCount, otps_deleted: otps.rowCount, abandoned_registrations: abandoned.rowCount, payments_expired: payments.rowCount };
  },
};

async function runJob(name) {
  const out = await JOBS[name]();
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

module.exports = { JOBS, runJob, startJobs };
