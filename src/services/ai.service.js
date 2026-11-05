const env = require('../config/env');
const db = require('../config/db');
const { AppError } = require('../utils/errors');
const { getSettings, toPoints } = require('./settings.service');
const { mediaForAi } = require('./media.service');
const { passageForAi } = require('./passage.service');

const { maxOutputTokens } = env.gemini;

/** notUnderstood: the saved explanation the student read and did not understand → explain it another, simpler way. */
function buildPrompt(q, passage = null, notUnderstood = null) {
  const correctText = q[`option_${q.correct_option.toLowerCase()}`];
  return [
    'أنت مدرس خبير لطلاب الثانوية العامة في مصر. اشرح بالعربية الفصحى المبسطة وباختصار (لا يزيد عن 180 كلمة):',
    '1) لماذا الإجابة الصحيحة صحيحة، 2) لماذا كل اختيار آخر خاطئ باختصار، 3) القانون أو القاعدة المستخدمة إن وجدت.',
    'اكتب الأُسس بالصيغة 10^8 أو 10^{-19} والأرقام السفلية بالصيغة H_2O (المنصة تعرضها كأُسس حقيقية)، ولا تستخدم LaTeX.',
    '',
    passage?.passage_text ? `القطعة/النص المرتبط بالسؤال:\n${passage.passage_text}\n` : '',
    `السؤال: ${q.question_text}`,
    `أ) ${q.option_a}`,
    `ب) ${q.option_b}`,
    `ج) ${q.option_c}`,
    `د) ${q.option_d}`,
    `الإجابة الصحيحة: (${q.correct_option}) ${correctText}`,
    q.law_note ? `ملحوظة/قانون مرتبط: ${q.law_note}` : '',
    notUnderstood ? `\nالطالب قرأ الشرح ده ومفهمهوش:\n${notUnderstood}\nاشرح بطريقة مختلفة وأبسط، خطوة بخطوة وبمثال قريب من الطالب لو ينفع، من غير ما تكرر نفس الكلام.` : '',
  ].join('\n');
}

/** s: settings (model prices per 1M tokens + USD→EGP), chosen by the admin. */
const costEgp = (inputTokens, outputTokens, s) =>
  ((inputTokens * s.ai_input_usd_per_m + outputTokens * s.ai_output_usd_per_m) / 1e6) * s.usd_to_egp;

/** Conservative worst-case cost reserved BEFORE calling the model (Arabic ≈ 1 token per 1–2 chars). */
// Each image costs a few hundred input tokens (Gemini bills ~258 tokens per image tile).
const IMAGE_TOKEN_ALLOWANCE = 1100;
const reserveFor = (prompt, s, imageCount = 0) =>
  costEgp(Math.ceil(prompt.length / 1.5) + 50 + imageCount * IMAGE_TOKEN_ALLOWANCE, maxOutputTokens, s);

/**
 * Keep "thinking" short (cheaper, faster): Gemini 2.x turns it off with thinkingBudget 0, Gemini 3+ uses
 * thinkingLevel. If a model rejects the setting, the call is retried without it.
 */
const thinkingFor = (model) => (/^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' });

const SLOT_NAME = { passage: 'الرسمة/صورة القطعة المرتبطة بالسؤال', question: 'صورة السؤال', option_a: 'صورة الاختيار أ', option_b: 'صورة الاختيار ب', option_c: 'صورة الاختيار ج', option_d: 'صورة الاختيار د' };

async function callGemini(prompt, images = [], model) {
  if (!env.gemini.apiKey) {
    if (!env.allowMocks) throw new AppError(503, 'خدمة الذكاء الاصطناعي غير مهيأة', 'AI_NOT_CONFIGURED');
    // Development mock — mirrors the real response shape so the cost pipeline is exercised end to end.
    return {
      text: '[شرح تجريبي — أضف GEMINI_API_KEY للحصول على شرح حقيقي] الإجابة الصحيحة تعتمد على تطبيق القاعدة المذكورة في السؤال.',
      usage: { input: Math.ceil(prompt.length / 3), output: 120 },
      mock: true,
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const request = (thinkingConfig) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.gemini.apiKey },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          // Label each figure so the model knows which one belongs to the question vs an option.
          ...images.flatMap((m) => [{ text: `${SLOT_NAME[m.slot]}:` }, { inline_data: { mime_type: m.mime, data: m.data.toString('base64') } }]),
        ],
      }],
      generationConfig: { maxOutputTokens, temperature: 0.3, ...(thinkingConfig ? { thinkingConfig } : {}) },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  let res = await request(thinkingFor(model));
  let data = await res.json().catch(() => ({}));
  if (res.status === 400 && /thinking/i.test(data?.error?.message || '')) {
    res = await request(null);
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw Object.assign(new Error(`Gemini HTTP ${res.status}: ${data?.error?.message || 'unknown error'}`), { status: res.status });

  const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error(`Gemini returned an empty response (${data.candidates?.[0]?.finishReason || 'no candidates'})`);
  const u = data.usageMetadata || {};
  return {
    text,
    // Thinking tokens (if any) are billed as output tokens.
    usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
  };
}

/**
 * Main model, then the fallback one when Google answers "overloaded / unavailable / not found" (or times out),
 * so students don't get an error during demand spikes. Returns the result + the model that answered.
 */
const RETRY_WITH_FALLBACK = new Set([404, 429, 500, 502, 503, 504]);
async function callWithFallback(prompt, images, settings) {
  const fallback = settings.ai_fallback_model;
  try {
    return { ...await callGemini(prompt, images, settings.ai_model), model: settings.ai_model };
  } catch (err) {
    const retryable = RETRY_WITH_FALLBACK.has(err.status) || err.name === 'TimeoutError' || err.name === 'AbortError';
    if (!fallback || fallback === settings.ai_model || !retryable || err instanceof AppError) throw err;
    console.warn(`[ai] ${settings.ai_model} failed (${err.message.slice(0, 120)}), using ${fallback}`);
    return { ...await callGemini(prompt, images, fallback), model: fallback, fallback_reason: err.message.slice(0, 200) };
  }
}

async function logUsage(row) {
  const model = row.model || (await getSettings()).ai_model;
  await db.query(
    `INSERT INTO ai_usage_logs (user_id, question_id, model, input_tokens, output_tokens, total_tokens, cost_usd, cost_egp, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [row.userId, row.questionId, model, row.input || 0, row.output || 0, (row.input || 0) + (row.output || 0),
      row.costUsd || 0, row.costEgp || 0, row.status, row.error || null],
  );
}

/**
 * Generates an AI explanation while enforcing the per-student spending cap.
 *
 * Budget safety under concurrency: the worst-case cost is reserved atomically
 * (UPDATE ... WHERE spent + reserve <= limit) before the API call, then settled to the real cost
 * from usageMetadata — or refunded if the call fails. So parallel requests can never push a
 * student past their limit.
 */
async function explainWithBudget(userId, question, { notUnderstood = null } = {}) {
  // GIF is not accepted by Gemini; other formats are sent so the model can read diagrams/figures.
  const passage = await passageForAi(question.passage_id);
  const images = [
    ...(passage?.image_data ? [{ slot: 'passage', mime: passage.image_mime, data: passage.image_data }] : []),
    ...await mediaForAi(question.id),
  ].filter((m) => m.mime !== 'image/gif');
  const prompt = buildPrompt(question, passage, notUnderstood) + (images.length ? '\nملحوظة: السؤال يحتوي على صور مرفقة، اعتمد عليها في الشرح.' : '');
  const settings = await getSettings();
  const { usd_to_egp: usdToEgp, ai_points_per_egp: rate } = settings;
  const reserve = reserveFor(prompt, settings, images.length);

  const reserved = await db.query(
    `UPDATE users SET ai_spent_egp = ai_spent_egp + $2
      WHERE id = $1 AND ai_spent_egp + $2 <= ai_limit_egp
      RETURNING ai_spent_egp`,
    [userId, reserve.toFixed(6)],
  );
  if (!reserved.rowCount) {
    await logUsage({ userId, questionId: question.id, status: 'blocked' });
    const { rows } = await db.query(`SELECT ai_spent_egp, ai_limit_egp FROM users WHERE id = $1`, [userId]);
    const left = toPoints(Math.max(rows[0].ai_limit_egp - rows[0].ai_spent_egp, 0), rate);
    throw new AppError(402, `رصيد نقاط الذكاء الاصطناعي خلص (متبقي ${left.toLocaleString('en')} من ${toPoints(rows[0].ai_limit_egp, rate).toLocaleString('en')} نقطة). تم إيقاف طلبات الشرح الإضافية.`,
      'AI_LIMIT_REACHED', {
        spent_points: toPoints(rows[0].ai_spent_egp, rate), limit_points: toPoints(rows[0].ai_limit_egp, rate),
        spent_egp: rows[0].ai_spent_egp, limit_egp: rows[0].ai_limit_egp,
      });
  }

  let result;
  try {
    result = await callWithFallback(prompt, images, settings);
  } catch (err) {
    await db.query(`UPDATE users SET ai_spent_egp = GREATEST(ai_spent_egp - $2, 0) WHERE id = $1`, [userId, reserve.toFixed(6)]);
    await logUsage({ userId, questionId: question.id, model: settings.ai_model, status: 'error', error: String(err.message).slice(0, 500) });
    if (err instanceof AppError) throw err;
    console.error('[ai] gemini call failed', err.message);
    throw new AppError(502, 'تعذر الحصول على الشرح حالياً، لم يتم خصم أي تكلفة. حاول مرة أخرى.', 'AI_UPSTREAM_ERROR');
  }

  const actualEgp = costEgp(result.usage.input, result.usage.output, settings);
  const { rows } = await db.query(
    `UPDATE users SET ai_spent_egp = GREATEST(ai_spent_egp - $2 + $3, 0) WHERE id = $1
     RETURNING ai_spent_egp, ai_limit_egp`,
    [userId, reserve.toFixed(6), actualEgp.toFixed(6)],
  );
  await logUsage({
    userId, questionId: question.id, model: result.model, status: 'success', input: result.usage.input, output: result.usage.output,
    costUsd: (actualEgp / usdToEgp).toFixed(8), costEgp: actualEgp.toFixed(6),
  });
  // Cache so every other student gets this explanation for free (never the mock, or it would hide the AI button for good).
  if (!result.mock) await db.query(
    `INSERT INTO ai_explanations (question_id, content, model, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (question_id) DO NOTHING`,
    [question.id, result.text, result.model, userId],
  );

  const { ai_spent_egp: spent, ai_limit_egp: limit } = rows[0];
  const remaining = Math.max(limit - spent, 0);
  return {
    source: 'gemini',
    explanation: result.text,
    law_note: question.law_note,
    usage: {
      input_tokens: result.usage.input,
      output_tokens: result.usage.output,
      cost_egp: Number(actualEgp.toFixed(4)),
      total_spent_egp: Number(spent.toFixed(4)),
      limit_egp: limit,
      remaining_egp: Number(remaining.toFixed(4)),
      cost_points: toPoints(actualEgp, rate),
      spent_points: toPoints(spent, rate),
      limit_points: toPoints(limit, rate),
      remaining_points: toPoints(remaining, rate),
    },
    warning: remaining / limit < 0.2 ? `تنبيه: متبقي ${toPoints(remaining, rate).toLocaleString('en')} نقطة فقط من رصيد الذكاء الاصطناعي` : null,
  };
}

/**
 * Admin "test the AI" button: one tiny request with the current key + model (no student budget used).
 * Returns what Google answered, or its error message, so a wrong key/model name is obvious.
 */
async function testModel() {
  const settings = await getSettings();
  const started = Date.now();
  try {
    const r = await callWithFallback('اكتب جملة واحدة قصيرة بالعربي تشجع طالب ثانوية عامة على المذاكرة.', [], settings);
    return {
      ok: !r.mock, mock: Boolean(r.mock), model: settings.ai_model, answered_by: r.model, fallback_reason: r.fallback_reason || null,
      reply: r.text, ms: Date.now() - started, tokens: r.usage, cost_egp: Number(costEgp(r.usage.input, r.usage.output, settings).toFixed(4)),
    };
  } catch (err) {
    return { ok: false, model: settings.ai_model, error: String(err.message).slice(0, 400), ms: Date.now() - started };
  }
}

module.exports = { explainWithBudget, buildPrompt, costEgp, testModel };
