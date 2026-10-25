const router = require('express').Router();
const db = require('../config/db');
const { validate, idParam, z } = require('../middleware/validate');
const { TEAM_SIZE, getTeamOf } = require('../services/team.service');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');

async function teamDetails(teamId) {
  const { rows: [team] } = await db.query(`SELECT id, name, captain_id, is_auto_generated, allow_auto_fill, created_at FROM teams WHERE id = $1`, [teamId]);
  const { rows: members } = await db.query(
    `SELECT u.id, u.student_code, u.full_name, tm.joined_at, (u.id = t.captain_id) AS is_captain
       FROM team_members tm JOIN users u ON u.id = tm.user_id JOIN teams t ON t.id = tm.team_id
      WHERE tm.team_id = $1 ORDER BY tm.joined_at`,
    [teamId],
  );
  const { rows: invites } = await db.query(
    `SELECT i.id, u.student_code, u.full_name, i.created_at FROM team_invites i JOIN users u ON u.id = i.invitee_id
      WHERE i.team_id = $1 AND i.status = 'pending' ORDER BY i.created_at`,
    [teamId],
  );
  return { ...team, size: members.length, max_size: TEAM_SIZE, members, pending_invites: invites };
}

router.get('/me', async (req, res) => {
  const team = await getTeamOf(req.user.id);
  res.json({ team: team ? await teamDetails(team.id) : null });
});

router.post('/', validate({ body: z.object({ name: z.string().trim().min(2).max(80) }) }), async (req, res) => {
  const team = await db.withTransaction(async (c) => {
    if (await getTeamOf(req.user.id, c)) throw conflict('أنت بالفعل عضو في تيم');
    const { rows: [t] } = await c.query(`INSERT INTO teams (name, captain_id) VALUES ($1, $2) RETURNING id`, [req.body.name, req.user.id]);
    await c.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, [t.id, req.user.id]);
    return t;
  });
  res.status(201).json({ team: await teamDetails(team.id) });
});

router.patch('/me', validate({
  body: z.object({ name: z.string().trim().min(2).max(80).optional(), allow_auto_fill: z.boolean().optional() }),
}), async (req, res) => {
  const team = await getTeamOf(req.user.id);
  if (!team) throw notFound('لست عضواً في أي تيم');
  if (team.captain_id !== req.user.id) throw forbidden('قائد التيم فقط يمكنه التعديل');
  await db.query(
    `UPDATE teams SET name = COALESCE($2, name), allow_auto_fill = COALESCE($3, allow_auto_fill) WHERE id = $1`,
    [team.id, req.body.name ?? null, req.body.allow_auto_fill ?? null],
  );
  res.json({ team: await teamDetails(team.id) });
});

/** Invite by student ID (e.g. STU-2026-0007). Captain only. */
router.post('/invites', validate({ body: z.object({ student_code: z.string().trim().toUpperCase().regex(/^STU-\d{4}-\d{4,}$/, 'كود الطالب غير صحيح') }) }), async (req, res) => {
  const team = await getTeamOf(req.user.id);
  if (!team) throw badRequest('أنشئ تيم أولاً');
  if (team.captain_id !== req.user.id) throw forbidden('قائد التيم فقط يمكنه إرسال الدعوات');

  const { rows: [invitee] } = await db.query(
    `SELECT id, full_name FROM users WHERE student_code = $1 AND role = 'student' AND is_active AND is_verified`, [req.body.student_code]);
  if (!invitee) throw notFound('لا يوجد طالب بهذا الكود');
  if (invitee.id === req.user.id) throw badRequest('لا يمكنك دعوة نفسك');
  if (await getTeamOf(invitee.id)) throw conflict('هذا الطالب منضم لتيم آخر بالفعل');

  const { rows: [{ members, pending }] } = await db.query(
    `SELECT (SELECT COUNT(*) FROM team_members WHERE team_id = $1)::int AS members,
            (SELECT COUNT(*) FROM team_invites WHERE team_id = $1 AND status = 'pending')::int AS pending`,
    [team.id],
  );
  if (members >= TEAM_SIZE) throw conflict(`التيم مكتمل (${TEAM_SIZE} طلاب)`);
  if (members + pending >= TEAM_SIZE) throw conflict('عدد الدعوات المعلقة يكفي لإكمال التيم، ألغِ دعوة أولاً');

  const { rows: [invite] } = await db.query(
    `INSERT INTO team_invites (team_id, inviter_id, invitee_id) VALUES ($1, $2, $3) RETURNING id, created_at`,
    [team.id, req.user.id, invitee.id],
  );
  res.status(201).json({ message: `تم إرسال الدعوة إلى ${invitee.full_name}`, invite });
});

/** Invitations I received. */
router.get('/invites', async (req, res) => {
  const { rows } = await db.query(
    `SELECT i.id, t.id AS team_id, t.name AS team, u.full_name AS invited_by, u.student_code AS invited_by_code,
            (SELECT COUNT(*) FROM team_members WHERE team_id = t.id)::int AS team_size, i.created_at
       FROM team_invites i JOIN teams t ON t.id = i.team_id JOIN users u ON u.id = i.inviter_id
      WHERE i.invitee_id = $1 AND i.status = 'pending' ORDER BY i.created_at DESC`,
    [req.user.id],
  );
  res.json({ invites: rows });
});

router.post('/invites/:id/accept', validate({ params: idParam }), async (req, res) => {
  const teamId = await db.withTransaction(async (c) => {
    const { rows: [inv] } = await c.query(`SELECT * FROM team_invites WHERE id = $1 FOR UPDATE`, [req.p.id]);
    if (!inv || inv.invitee_id !== req.user.id) throw notFound('الدعوة غير موجودة');
    if (inv.status !== 'pending') throw conflict('هذه الدعوة لم تعد صالحة');
    if (await getTeamOf(req.user.id, c)) throw conflict('أنت بالفعل عضو في تيم، اخرج منه أولاً');

    await c.query(`SELECT id FROM teams WHERE id = $1 FOR UPDATE`, [inv.team_id]); // serialize joins for this team
    const { rows: [{ n }] } = await c.query(`SELECT COUNT(*)::int AS n FROM team_members WHERE team_id = $1`, [inv.team_id]);
    if (n >= TEAM_SIZE) {
      await c.query(`UPDATE team_invites SET status = 'expired', responded_at = now() WHERE id = $1`, [inv.id]);
      throw conflict('التيم اكتمل بالفعل');
    }
    await c.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, [inv.team_id, req.user.id]);
    await c.query(`UPDATE team_invites SET status = 'accepted', responded_at = now() WHERE id = $1`, [inv.id]);
    await c.query(
      `UPDATE team_invites SET status = 'expired', responded_at = now() WHERE invitee_id = $1 AND status = 'pending'`,
      [req.user.id]);
    return inv.team_id;
  });
  res.json({ message: 'تم الانضمام للتيم', team: await teamDetails(teamId) });
});

router.post('/invites/:id/decline', validate({ params: idParam }), async (req, res) => {
  const r = await db.query(
    `UPDATE team_invites SET status = 'declined', responded_at = now() WHERE id = $1 AND invitee_id = $2 AND status = 'pending'`,
    [req.p.id, req.user.id]);
  if (!r.rowCount) throw notFound('الدعوة غير موجودة');
  res.json({ message: 'تم رفض الدعوة' });
});

router.delete('/invites/:id', validate({ params: idParam }), async (req, res) => {
  const r = await db.query(
    `UPDATE team_invites i SET status = 'cancelled', responded_at = now()
       FROM teams t WHERE i.id = $1 AND t.id = i.team_id AND t.captain_id = $2 AND i.status = 'pending'`,
    [req.p.id, req.user.id]);
  if (!r.rowCount) throw notFound('الدعوة غير موجودة');
  res.json({ message: 'تم إلغاء الدعوة' });
});

/** Leave the team. Captaincy passes to the longest-standing member; an empty team is deleted. */
router.post('/leave', async (req, res) => {
  await db.withTransaction(async (c) => {
    const team = await getTeamOf(req.user.id, c);
    if (!team) throw notFound('لست عضواً في أي تيم');
    await c.query(`SELECT id FROM teams WHERE id = $1 FOR UPDATE`, [team.id]);
    await c.query(`DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, [team.id, req.user.id]);
    const { rows: [next] } = await c.query(`SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at LIMIT 1`, [team.id]);
    if (!next) await c.query(`DELETE FROM teams WHERE id = $1`, [team.id]);
    else if (team.captain_id === req.user.id) await c.query(`UPDATE teams SET captain_id = $2 WHERE id = $1`, [team.id, next.user_id]);
  });
  res.json({ message: 'تم الخروج من التيم' });
});

router.delete('/members/:id', validate({ params: idParam }), async (req, res) => {
  const team = await getTeamOf(req.user.id);
  if (!team || team.captain_id !== req.user.id) throw forbidden('قائد التيم فقط يمكنه إزالة الأعضاء');
  if (req.p.id === req.user.id) throw badRequest('استخدم الخروج من التيم بدلاً من ذلك');
  const r = await db.query(`DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, [team.id, req.p.id]);
  if (!r.rowCount) throw notFound('العضو غير موجود في التيم');
  res.json({ team: await teamDetails(team.id) });
});

module.exports = router;
