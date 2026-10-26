const env = require('../config/env');
const db = require('../config/db');
const { AppError } = require('../utils/errors');
const { getSettings, toPoints } = require('./settings.service');
const { mediaForAi } = require('./media.service');

const { model, inputUsdPerM, outputUsdPerM, maxOutputTokens } = env.gemini;

function buildPrompt(q) {
  const correctText = q[`option_${q.correct_option.toLowerCase()}`];
  return [
    'أنت مدرس خبير لطلاب الثانوية العامة في مصر. اشرح بالعربية الفصحى المبسطة وباختصار (لا يزيد عن 180 كلمة):',
    '1) لماذا الإجابة الصحيحة صحيحة، 2) لماذا كل اختيار آخر خاطئ باختصار، 3) القانون أو القاعدة المستخدمة إن وجدت.',
    'اكتب الأُسس بالصيغة 10^8 أو 10^{-19} والأرقام السفلية بالصيغة H_2O (المنصة تعرضها كأُسس حقيقية)، ولا تستخدم LaTeX.',
    '',
    `السؤال: ${q.question_text}`,
    `أ) ${q.option_a}`,
    `ب) ${q.option_b}`,
    `ج) ${q.option_c}`,
    `د) ${q.option_d}`,
    `الإجابة الصحيحة: (${q.correct_option}) ${correctText}`,
    q.law_note ? `ملحوظة/قانون مرتبط: ${q.law_note}` : '',
  ].join('\n');
}

const costEgp = (inputTokens, outputTokens, usdToEgp) =>
  ((inputTokens * inputUsdPerM + outputTokens * outputUsdPerM) / 1e6) * usdToEgp;

/** Conservative worst-case cost reserved BEFORE calling the model (Arabic ≈ 1 token per 1–2 chars). */
// Each image costs a few hundred input tokens (Gemini bills ~258 tokens per image tile).
const IMAGE_TOKEN_ALLOWANCE = 1100;
const reserveFor = (prompt, usdToEgp, imageCount = 0) =>
  costEgp(Math.ceil(prompt.length / 1.5) + 50 + imageCount * IMAGE_TOKEN_ALLOWANCE, maxOutputTokens, usdToEgp);

const SLOT_NAME = { question: 'صورة السؤال', option_a: 'صورة الاختيار أ', option_b: 'صورة الاختيار ب', option_c: 'صورة الاختيار ج', option_d: 'صورة الاختيار د' };

async function callGemini(prompt, images = []) {
  if (!env.gemini.apiKey) {
    if (!env.allowMocks) throw new AppError(503, 'خدمة الذكاء الاصطناعي غير مهيأة', 'AI_NOT_CONFIGURED');
    // Development mock — mirrors the real response shape so the cost pipeline is exercised end to end.
    return {
      text: '[شرح تجريبي — أضف GEMINI_API_KEY للحصول على شرح حقيقي] الإجابة الصحيحة تعتمد على تطبيق القاعدة المذكورة في السؤال.',
      usage: { input: Math.ceil(prompt.length / 3), output: 120 },
      mock: true,
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
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
      generationConfig: { maxOutputTokens, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${data?.error?.message || 'unknown error'}`);

  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty response');
  const u = data.usageMetadata || {};
  return {
    text,
    // Thinking tokens (if any) are billed as output tokens.
    usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
  };
}

async function logUsage(row) {
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
async function explainWithBudget(userId, question) {
  // GIF is not accepted by Gemini; other formats are sent so the model can read diagrams/figures.
  const images = (await mediaForAi(question.id)).filter((m) => m.mime !== 'image/gif');
  const prompt = buildPrompt(question) + (images.length ? '\nملحوظة: السؤال يحتوي على صور مرفقة، اعتمد عليها في الشرح.' : '');
  const { usd_to_egp: usdToEgp, ai_points_per_egp: rate } = await getSettings();
  const reserve = reserveFor(prompt, usdToEgp, images.length);

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
    result = await callGemini(prompt, images);
  } catch (err) {
    await db.query(`UPDATE users SET ai_spent_egp = GREATEST(ai_spent_egp - $2, 0) WHERE id = $1`, [userId, reserve.toFixed(6)]);
    await logUsage({ userId, questionId: question.id, status: 'error', error: String(err.message).slice(0, 500) });
    if (err instanceof AppError) throw err;
    console.error('[ai] gemini call failed', err.message);
    throw new AppError(502, 'تعذر الحصول على الشرح حالياً، لم يتم خصم أي تكلفة. حاول مرة أخرى.', 'AI_UPSTREAM_ERROR');
  }

  const actualEgp = costEgp(result.usage.input, result.usage.output, usdToEgp);
  const { rows } = await db.query(
    `UPDATE users SET ai_spent_egp = GREATEST(ai_spent_egp - $2 + $3, 0) WHERE id = $1
     RETURNING ai_spent_egp, ai_limit_egp`,
    [userId, reserve.toFixed(6), actualEgp.toFixed(6)],
  );
  await logUsage({
    userId, questionId: question.id, status: 'success', input: result.usage.input, output: result.usage.output,
    costUsd: (actualEgp / usdToEgp).toFixed(8), costEgp: actualEgp.toFixed(6),
  });
  // Cache so every other student gets this explanation for free (never the mock, or it would hide the AI button for good).
  if (!result.mock) await db.query(
    `INSERT INTO ai_explanations (question_id, content, model, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (question_id) DO NOTHING`,
    [question.id, result.text, model, userId],
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

module.exports = { explainWithBudget, buildPrompt, costEgp };
