const cron = require('node-cron');
const env = require('../config/env');
const db = require('../config/db');
const { autoAssignTeams } = require('../services/team.service');
const { sendWeeklyReportsToAll } = require('../services/report.service');

const run = (name, fn) => async () => {
  try {
    const out = await fn();
    console.log(`[job] ${name} done`, JSON.stringify(out));
  } catch (err) {
    console.error(`[job] ${name} failed`, err);
  }
};

function startJobs() {
  const opts = { timezone: env.tz };

  // Thursday 21:00 Cairo — group students without a team before the Friday competition.
  cron.schedule('0 21 * * 4', run('auto-assign-teams', () => autoAssignTeams()), opts);

  // Saturday 10:00 Cairo — weekly parent reports.
  cron.schedule('0 10 * * 6', run('weekly-parent-reports', sendWeeklyReportsToAll), opts);

  // Daily 03:00 — housekeeping.
  cron.schedule('0 3 * * *', run('cleanup', async () => {
    const invites = await db.query(
      `UPDATE team_invites SET status = 'expired', responded_at = now() WHERE status = 'pending' AND created_at < now() - interval '7 days'`);
    const otps = await db.query(`DELETE FROM otp_codes WHERE created_at < now() - interval '2 days'`);
    const payments = await db.query(
      `UPDATE payments SET status = 'failed', admin_note = 'expired', updated_at = now()
        WHERE status = 'pending' AND method_type = 'gateway' AND created_at < now() - interval '3 days'`);
    return { invites_expired: invites.rowCount, otps_deleted: otps.rowCount, payments_expired: payments.rowCount };
  }), opts);

  console.log(`[jobs] scheduled (timezone ${env.tz})`);
}

module.exports = { startJobs };
