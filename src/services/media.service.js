/**
 * Question images, stored in Postgres (works on serverless hosts without a file store).
 * Public URL: /api/media/q/<questionId>/<slot>/<first 16 hex of sha256> — the content hash makes URLs
 * unguessable and lets browsers cache them forever (a new image gets a new URL).
 */
const crypto = require('crypto');
const db = require('../config/db');

const SLOTS = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'explanation'];
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXT));
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mediaUrl = (qid, slot, hash) => `/api/media/q/${qid}/${slot}/${hash.slice(0, 16)}`;

/** Detects the real image type from the file signature (never trust the extension/client mime). */
function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function saveMedia(client, questionId, slot, buffer) {
  const mime = sniffMime(buffer);
  if (!mime || !ALLOWED_MIME.has(mime)) throw Object.assign(new Error('صيغة الصورة غير مدعومة (PNG / JPG / WEBP / GIF)'), { status: 400 });
  if (buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('حجم الصورة أكبر من 2MB'), { status: 400 });
  const hash = sha256(buffer);
  await client.query(
    `INSERT INTO question_media (question_id, slot, mime, data, hash) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (question_id, slot) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, hash = EXCLUDED.hash, created_at = now()`,
    [questionId, slot, mime, buffer, hash],
  );
  return mediaUrl(questionId, slot, hash);
}

/** { [questionId]: { question: url, option_a: url, ... } } for the given ids (no image bytes loaded). */
async function mediaMap(questionIds) {
  const ids = [...new Set(questionIds.filter(Boolean))];
  if (!ids.length) return {};
  const { rows } = await db.query(
    `SELECT question_id, slot, hash FROM question_media WHERE question_id = ANY($1::bigint[])`, [ids]);
  const out = {};
  for (const r of rows) (out[r.question_id] ??= {})[r.slot] = mediaUrl(r.question_id, r.slot, r.hash);
  return out;
}

/** Image parts for Gemini (question + options), so the AI can actually "see" the figure. */
async function mediaForAi(questionId) {
  const { rows } = await db.query(
    `SELECT slot, mime, data FROM question_media WHERE question_id = $1 AND slot <> 'explanation' ORDER BY slot`, [questionId]);
  return rows;
}

module.exports = { SLOTS, MIME_BY_EXT, MAX_IMAGE_BYTES, sha256, sniffMime, saveMedia, mediaMap, mediaForAi, mediaUrl };
