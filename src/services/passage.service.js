/**
 * Reading passages / shared figures: one text and/or picture shown above several questions
 * (the passage stays fixed while the student moves between its questions).
 * Picture URL: /api/media/p/<passageId>/<first 16 hex of sha256> — unguessable and cached forever, like question images.
 */
const crypto = require('crypto');
const db = require('../config/db');

const passageImageUrl = (id, hash) => `/api/media/p/${id}/${hash.slice(0, 16)}`;

/** Identity of a passage: its text (whitespace-insensitive) + its picture. */
const passageHash = (text, imageHash) =>
  crypto.createHash('sha256').update(`${String(text || '').replace(/\s+/g, ' ').trim()}|${imageHash || ''}`).digest('hex');

/** Stores a passage once (same text + picture → same row) and returns its id. */
async function upsertPassage(client, { text, image }) {
  const hash = passageHash(text, image?.hash);
  const { rows: [p] } = await client.query(
    `INSERT INTO passages (passage_text, image_mime, image_data, image_hash, content_hash) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (content_hash) DO UPDATE SET content_hash = EXCLUDED.content_hash RETURNING id`,
    [text || null, image?.mime || null, image?.buffer || null, image?.hash || null, hash]);
  return p.id;
}

/** { [passageId]: { id, text, image } } for the given ids (no image bytes loaded). */
async function passageMap(passageIds) {
  const ids = [...new Set(passageIds.filter(Boolean).map(Number))];
  if (!ids.length) return {};
  const { rows } = await db.query(`SELECT id, passage_text, image_hash FROM passages WHERE id = ANY($1::bigint[])`, [ids]);
  return Object.fromEntries(rows.map((p) => [p.id, {
    id: Number(p.id), text: p.passage_text, image: p.image_hash ? passageImageUrl(p.id, p.image_hash) : null,
  }]));
}

/** Keeps the questions of one passage next to each other (in the order the passage first appears). */
function groupByPassage(items, pidOf = (x) => x.passage_id) {
  const groups = new Map();
  items.forEach((x, i) => {
    const key = pidOf(x) ? `p${pidOf(x)}` : `q${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  });
  return [...groups.values()].flat();
}

/** Picture of a passage for Gemini, so the AI can "see" a shared figure. */
async function passageForAi(passageId) {
  if (!passageId) return null;
  const { rows: [p] } = await db.query(`SELECT passage_text, image_mime, image_data FROM passages WHERE id = $1`, [passageId]);
  return p || null;
}

module.exports = { passageImageUrl, passageHash, upsertPassage, passageMap, groupByPassage, passageForAi };
