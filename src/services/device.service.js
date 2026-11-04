const crypto = require('crypto');
const env = require('../config/env');
const db = require('../config/db');
const { AppError } = require('../utils/errors');

/**
 * Account sharing protection for students:
 *   - at most MAX_DEVICES registered devices per account;
 *   - a new device needs a code sent to the student's email;
 *   - one active session at a time: a new login signs the other device out;
 *   - students can remove a device themselves only REMOVALS_PER_MONTH times per 30 days (the admin can always).
 * A device is recognised by a random id kept in an HttpOnly cookie (with a localStorage copy as fallback).
 */
const MAX_DEVICES = 2;
const REMOVALS_PER_MONTH = 2;
const COOKIE = 'edu_did';
const COOKIE_MAX_AGE = 400 * 24 * 3600 * 1000; // browsers cap cookies at 400 days

const hashKey = (key) => crypto.createHash('sha256').update(`device:${key}`).digest('hex');
const validKey = (k) => typeof k === 'string' && /^[A-Za-z0-9-]{16,100}$/.test(k);

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The browser's device id: cookie first, then the copy the page sends; a new one when neither exists. Re-sets the cookie. */
function deviceKey(req, res) {
  const fromCookie = readCookie(req, COOKIE);
  const fromBody = req.body?.device_id;
  const key = validKey(fromCookie) ? fromCookie : validKey(fromBody) ? fromBody : crypto.randomUUID();
  res.cookie(COOKIE, key, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: '/api', maxAge: COOKIE_MAX_AGE });
  return key;
}

/** "iPhone · Safari", "Windows · Chrome"… from the user agent. */
function deviceName(req) {
  const ua = String(req.headers['user-agent'] || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'موبايل Android' : 'تابلت Android')
    : /Windows/.test(ua) ? 'كمبيوتر Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'جهاز';
  const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return (browser ? `${os} · ${browser}` : os).slice(0, 80);
}

const clientIp = (req) => String(req.ip || '').slice(0, 64) || null;

async function logEvent(client, userId, type, deviceNameText, ip) {
  await client.query(
    `INSERT INTO device_events (user_id, type, device_name, ip) VALUES ($1, $2, $3, $4)`,
    [userId, type, deviceNameText || null, ip || null]);
}

async function findDevice(client, userId, keyHash) {
  const { rows: [d] } = await client.query(`SELECT * FROM user_devices WHERE user_id = $1 AND key_hash = $2`, [userId, keyHash]);
  return d || null;
}

async function listDevices(client, userId) {
  const { rows } = await client.query(
    `SELECT id, name, created_at, last_seen_at, first_ip, last_ip FROM user_devices WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return rows;
}

/** Refused when the account already has MAX_DEVICES devices (the attempt is logged for the admin). */
async function assertRoom(client, user, req) {
  const devices = await listDevices(client, user.id);
  if (devices.length < MAX_DEVICES) return;
  await logEvent(db, user.id, 'blocked_limit', deviceName(req), clientIp(req)); // outside the transaction: kept even though we throw
  throw new AppError(403,
    `حسابك مسجّل بالفعل على ${MAX_DEVICES} أجهزة (${devices.map((d) => d.name).join(' و ')}). ادخل من جهاز منهم واشيل جهاز من صفحة «أجهزتي»، أو كلّم الإدارة.`,
    'DEVICE_LIMIT', { devices: devices.map((d) => d.name), max: MAX_DEVICES });
}

/** Registers the device (if new) inside the caller's transaction. */
async function addDevice(client, user, keyHash, req) {
  const existing = await findDevice(client, user.id, keyHash);
  if (existing) return existing;
  await assertRoom(client, user, req);
  const { rows: [d] } = await client.query(
    `INSERT INTO user_devices (user_id, key_hash, name, first_ip, last_ip) VALUES ($1, $2, $3, $4, $4) RETURNING *`,
    [user.id, keyHash, deviceName(req), clientIp(req)]);
  await logEvent(client, user.id, 'added', d.name, clientIp(req));
  return d;
}

/** Starts THE session of this account on this device; any other session is signed out. Returns the new session id. */
async function startSession(client, userId, device, req) {
  const sid = crypto.randomUUID();
  await client.query(`UPDATE users SET active_session = $2, active_device_id = $3 WHERE id = $1`, [userId, sid, device.id]);
  await client.query(`UPDATE user_devices SET last_seen_at = now(), last_ip = $2 WHERE id = $1`, [device.id, clientIp(req)]);
  return sid;
}

/** Student removing a device: limited per 30 days so an account can't be passed around by swapping devices. */
async function removeByStudent(userId, deviceId, currentDeviceId) {
  return db.withTransaction(async (c) => {
    await c.query(`SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE`, [userId]);
    const { rows: [d] } = await c.query(`SELECT * FROM user_devices WHERE id = $1 AND user_id = $2`, [deviceId, userId]);
    if (!d) throw new AppError(404, 'الجهاز غير موجود', 'NOT_FOUND');
    if (d.id === currentDeviceId) throw new AppError(400, 'ده الجهاز اللي انت فاتح منه دلوقتي — تقدر تشيل الجهاز التاني بس', 'BAD_REQUEST');
    const left = await removalsLeft(c, userId);
    if (left <= 0) {
      throw new AppError(403, `شلت ${REMOVALS_PER_MONTH} أجهزة في آخر 30 يوم — للتغيير كلّم الإدارة`, 'DEVICE_REMOVAL_LIMIT');
    }
    await c.query(`DELETE FROM user_devices WHERE id = $1`, [d.id]);
    await logEvent(c, userId, 'removed_by_student', d.name, null);
    return { removed: d.name, removals_left: left - 1 };
  });
}

async function removalsLeft(client, userId) {
  const { rows: [r] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM device_events
      WHERE user_id = $1 AND type = 'removed_by_student' AND created_at > now() - interval '30 days'`, [userId]);
  return Math.max(REMOVALS_PER_MONTH - r.n, 0);
}

/** Admin: remove one device (signing it out if it holds the session), or all of them. */
async function removeByAdmin(userId, deviceId = null) {
  return db.withTransaction(async (c) => {
    const { rows: [u] } = await c.query(`SELECT id FROM users WHERE id = $1 AND role = 'student' FOR NO KEY UPDATE`, [userId]);
    if (!u) throw new AppError(404, 'الطالب غير موجود', 'NOT_FOUND');
    const { rows } = await c.query(
      `DELETE FROM user_devices WHERE user_id = $1 AND ($2::bigint IS NULL OR id = $2) RETURNING id, name`, [userId, deviceId]);
    if (deviceId && !rows.length) throw new AppError(404, 'الجهاز غير موجود', 'NOT_FOUND');
    // active_device_id is cleared by ON DELETE SET NULL; the session goes with its device.
    await c.query(`UPDATE users SET active_session = NULL WHERE id = $1 AND active_device_id IS NULL`, [userId]);
    if (deviceId) await logEvent(c, userId, 'removed_by_admin', rows[0].name, null);
    else await logEvent(c, userId, 'reset_by_admin', null, null);
    return { removed: rows.length };
  });
}

module.exports = {
  MAX_DEVICES, REMOVALS_PER_MONTH, hashKey, deviceKey, deviceName, clientIp,
  findDevice, listDevices, assertRoom, addDevice, startSession, removeByStudent, removalsLeft, removeByAdmin,
};
